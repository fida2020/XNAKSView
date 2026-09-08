import type { Prisma, Team, TeamActivityType, TeamRole, TeamTargetMetric } from '@prisma/client';

import { checkAndUnlockAchievements } from '@/lib/gamification/achievementRules';
import { checkAndAwardBadges } from '@/lib/gamification/badgeRules';
import { sendGamificationNotification } from '@/lib/gamification/notifications';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

/**
 * XNAKView's own creator/host Team feature — TikTok has no in-app team/
 * guild system (LIVE "agencies" are an off-platform business relationship,
 * not an in-app feature — see the Step 11 completion report). Deliberately
 * NOT MLM-shaped: `inviteMember`/`acceptInvite` below award no XP, Coins, or
 * Diamonds for the act of recruiting — a team's activity/target progress
 * only ever moves from real platform events (`logTeamActivity`, called from
 * LIVE-end and Gift-receive hooks in `events.ts`), never from headcount.
 *
 * A user may hold at most one ACTIVE membership across all teams at a time
 * — an explicit, disclosed XNAKView rule (keeps a team's aggregate activity
 * meaningful; without it, one very active host could inflate many teams at
 * once with the exact same underlying activity).
 */

async function loadTeamOrThrow(teamId: string): Promise<Team> {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new AppError('NOT_FOUND', 'Team not found');
  return team;
}

async function requireActiveRole(teamId: string, userId: string, roles: TeamRole[]) {
  const member = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
  if (!member || member.status !== 'ACTIVE' || !roles.includes(member.role)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to perform this action on this team');
  }
  return member;
}

async function auditLog(actorId: string, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonValue) {
  await prisma.gamificationAuditLog.create({ data: { actorId, action, entityType, entityId, metadata } });
}

export async function hasActiveTeamMembership(userId: string): Promise<boolean> {
  return (await prisma.teamMember.count({ where: { userId, status: 'ACTIVE' } })) > 0;
}

export async function createTeam(ownerId: string, params: { name: string; description?: string; avatarKey?: string }): Promise<Team> {
  if (await hasActiveTeamMembership(ownerId)) {
    throw new AppError('CONFLICT', 'You must leave your current team before creating a new one');
  }

  const team = await prisma.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: { name: params.name, description: params.description, avatarKey: params.avatarKey, ownerId },
    });
    await tx.teamMember.create({ data: { teamId: created.id, userId: ownerId, role: 'OWNER' } });
    return created;
  });

  await auditLog(ownerId, 'TEAM_CREATED', 'Team', team.id);
  await checkAndAwardBadges(ownerId, ['TEAM_MEMBER', 'TEAM_LEADER']);
  await checkAndUnlockAchievements(ownerId, ['FIRST_TEAM_MEMBERSHIP']);
  return team;
}

export async function updateTeam(
  teamId: string,
  actorId: string,
  params: { name?: string; description?: string; avatarKey?: string },
): Promise<Team> {
  await loadTeamOrThrow(teamId);
  await requireActiveRole(teamId, actorId, ['OWNER', 'MANAGER']);
  const updated = await prisma.team.update({ where: { id: teamId }, data: params });
  await auditLog(actorId, 'TEAM_UPDATED', 'Team', teamId, params);
  return updated;
}

export async function disbandTeam(teamId: string, actorId: string): Promise<void> {
  const team = await loadTeamOrThrow(teamId);
  if (team.ownerId !== actorId) throw new AppError('FORBIDDEN', 'Only the team owner can disband the team');
  if (team.status === 'DISBANDED') return;

  await prisma.$transaction(async (tx) => {
    await tx.team.update({ where: { id: teamId }, data: { status: 'DISBANDED', disbandedAt: new Date() } });
    await tx.teamMember.updateMany({ where: { teamId, status: 'ACTIVE' }, data: { status: 'LEFT', leftAt: new Date() } });
    await tx.teamInvite.updateMany({ where: { teamId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
  });
  await auditLog(actorId, 'TEAM_DISBANDED', 'Team', teamId);
}

export async function inviteMember(teamId: string, actorId: string, inviteeId: string) {
  const team = await loadTeamOrThrow(teamId);
  if (team.status !== 'ACTIVE') throw new AppError('CONFLICT', 'This team is no longer active');
  await requireActiveRole(teamId, actorId, ['OWNER', 'MANAGER']);

  if (inviteeId === actorId) throw new AppError('BAD_REQUEST', 'You cannot invite yourself');
  const invitee = await prisma.user.findUnique({ where: { id: inviteeId }, select: { status: true } });
  if (!invitee || invitee.status !== 'ACTIVE') throw new AppError('NOT_FOUND', 'User not found');

  const existingMembership = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: inviteeId } } });
  if (existingMembership?.status === 'ACTIVE') throw new AppError('CONFLICT', 'This user is already a member of this team');

  const pendingInvite = await prisma.teamInvite.findFirst({ where: { teamId, inviteeId, status: 'PENDING' } });
  if (pendingInvite) throw new AppError('CONFLICT', 'This user already has a pending invite to this team');

  const invite = await prisma.teamInvite.create({ data: { teamId, inviteeId, invitedById: actorId } });
  await auditLog(actorId, 'MEMBER_INVITED', 'TeamInvite', invite.id, { teamId, inviteeId });
  await sendGamificationNotification(prisma, inviteeId, 'TEAM_INVITE_RECEIVED', { teamId, teamName: team.name, inviteId: invite.id });
  return invite;
}

export async function cancelInvite(inviteId: string, actorId: string): Promise<void> {
  const invite = await prisma.teamInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.status !== 'PENDING') throw new AppError('NOT_FOUND', 'Pending invite not found');
  if (invite.invitedById !== actorId) {
    await requireActiveRole(invite.teamId, actorId, ['OWNER', 'MANAGER']);
  }
  await prisma.teamInvite.update({ where: { id: inviteId }, data: { status: 'CANCELLED', respondedAt: new Date() } });
  await auditLog(actorId, 'INVITE_CANCELLED', 'TeamInvite', inviteId);
}

export async function respondToInvite(inviteId: string, userId: string, accept: boolean): Promise<void> {
  const invite = await prisma.teamInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.status !== 'PENDING') throw new AppError('NOT_FOUND', 'Pending invite not found');
  if (invite.inviteeId !== userId) throw new AppError('FORBIDDEN', 'This invite is not addressed to you');

  if (!accept) {
    await prisma.teamInvite.update({ where: { id: inviteId }, data: { status: 'DECLINED', respondedAt: new Date() } });
    return;
  }

  const team = await loadTeamOrThrow(invite.teamId);
  if (team.status !== 'ACTIVE') throw new AppError('CONFLICT', 'This team is no longer active');
  if (await hasActiveTeamMembership(userId)) {
    throw new AppError('CONFLICT', 'You must leave your current team before joining a new one');
  }

  await prisma.$transaction(async (tx) => {
    await tx.teamInvite.update({ where: { id: inviteId }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    const existingRow = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: team.id, userId } } });
    if (existingRow) {
      await tx.teamMember.update({ where: { id: existingRow.id }, data: { status: 'ACTIVE', role: 'MEMBER', invitedById: invite.invitedById, joinedAt: new Date(), leftAt: null } });
    } else {
      await tx.teamMember.create({ data: { teamId: team.id, userId, role: 'MEMBER', invitedById: invite.invitedById } });
    }
    await tx.team.update({ where: { id: team.id }, data: { memberCount: { increment: 1 } } });
    await tx.teamActivityEntry.create({ data: { teamId: team.id, userId, type: 'MEMBER_JOINED' } });
  });

  await checkAndAwardBadges(userId, ['TEAM_MEMBER']);
  await checkAndUnlockAchievements(userId, ['FIRST_TEAM_MEMBERSHIP']);
}

export async function removeMember(teamId: string, actorId: string, targetUserId: string): Promise<void> {
  const team = await loadTeamOrThrow(teamId);
  if (team.status !== 'ACTIVE') throw new AppError('CONFLICT', 'This team is no longer active');
  const actor = await requireActiveRole(teamId, actorId, ['OWNER', 'MANAGER']);
  const target = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: targetUserId } } });
  if (!target || target.status !== 'ACTIVE') throw new AppError('NOT_FOUND', 'This user is not an active member of this team');
  if (target.role === 'OWNER') throw new AppError('FORBIDDEN', 'The team owner cannot be removed');
  if (target.role === 'MANAGER' && actor.role !== 'OWNER') {
    throw new AppError('FORBIDDEN', 'Only the team owner can remove a manager');
  }

  await prisma.$transaction(async (tx) => {
    await tx.teamMember.update({ where: { id: target.id }, data: { status: 'REMOVED', leftAt: new Date() } });
    await tx.team.update({ where: { id: teamId }, data: { memberCount: { decrement: 1 } } });
    await tx.teamActivityEntry.create({ data: { teamId, userId: targetUserId, type: 'MEMBER_REMOVED' } });
  });
  await auditLog(actorId, 'MEMBER_REMOVED', 'TeamMember', target.id, { teamId, targetUserId });
}

export async function leaveTeam(teamId: string, userId: string): Promise<void> {
  const member = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
  if (!member || member.status !== 'ACTIVE') throw new AppError('NOT_FOUND', 'You are not an active member of this team');
  if (member.role === 'OWNER') {
    throw new AppError('CONFLICT', 'Transfer ownership or disband the team before leaving as owner');
  }

  await prisma.$transaction(async (tx) => {
    await tx.teamMember.update({ where: { id: member.id }, data: { status: 'LEFT', leftAt: new Date() } });
    await tx.team.update({ where: { id: teamId }, data: { memberCount: { decrement: 1 } } });
    await tx.teamActivityEntry.create({ data: { teamId, userId, type: 'MEMBER_LEFT' } });
  });
}

export async function changeMemberRole(teamId: string, actorId: string, targetUserId: string, newRole: 'MANAGER' | 'MEMBER'): Promise<void> {
  await loadTeamOrThrow(teamId);
  await requireActiveRole(teamId, actorId, ['OWNER']);
  const target = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: targetUserId } } });
  if (!target || target.status !== 'ACTIVE') throw new AppError('NOT_FOUND', 'This user is not an active member of this team');
  if (target.role === 'OWNER') throw new AppError('BAD_REQUEST', 'Use transferOwnership to change the owner');

  await prisma.teamMember.update({ where: { id: target.id }, data: { role: newRole } });
  await auditLog(actorId, 'MEMBER_ROLE_CHANGED', 'TeamMember', target.id, { teamId, targetUserId, newRole });
  await sendGamificationNotification(prisma, targetUserId, 'TEAM_ROLE_CHANGED', { teamId, newRole });
  if (newRole === 'MANAGER') await checkAndAwardBadges(targetUserId, ['TEAM_LEADER']);
}

export async function transferOwnership(teamId: string, currentOwnerId: string, newOwnerId: string): Promise<void> {
  const team = await loadTeamOrThrow(teamId);
  if (team.ownerId !== currentOwnerId) throw new AppError('FORBIDDEN', 'Only the current owner can transfer ownership');
  const target = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: newOwnerId } } });
  if (!target || target.status !== 'ACTIVE') throw new AppError('NOT_FOUND', 'This user is not an active member of this team');

  await prisma.$transaction(async (tx) => {
    await tx.team.update({ where: { id: teamId }, data: { ownerId: newOwnerId } });
    await tx.teamMember.update({ where: { teamId_userId: { teamId, userId: currentOwnerId } }, data: { role: 'MANAGER' } });
    await tx.teamMember.update({ where: { id: target.id }, data: { role: 'OWNER' } });
  });
  await auditLog(currentOwnerId, 'OWNERSHIP_TRANSFERRED', 'Team', teamId, { newOwnerId });
  await sendGamificationNotification(prisma, newOwnerId, 'TEAM_ROLE_CHANGED', { teamId, newRole: 'OWNER' });
  await checkAndAwardBadges(newOwnerId, ['TEAM_LEADER']);
}

export async function createTeamTarget(
  teamId: string,
  actorId: string,
  params: { metric: TeamTargetMetric; targetValue: number; periodStart: Date; periodEnd: Date },
) {
  await loadTeamOrThrow(teamId);
  await requireActiveRole(teamId, actorId, ['OWNER', 'MANAGER']);
  if (params.targetValue <= 0) throw new AppError('BAD_REQUEST', 'targetValue must be positive');
  if (params.periodEnd <= params.periodStart) throw new AppError('BAD_REQUEST', 'periodEnd must be after periodStart');

  const target = await prisma.teamTarget.create({
    data: { teamId, metric: params.metric, targetValue: params.targetValue, periodStart: params.periodStart, periodEnd: params.periodEnd, createdById: actorId },
  });
  await auditLog(actorId, 'TARGET_CREATED', 'TeamTarget', target.id, {
    teamId,
    metric: params.metric,
    targetValue: params.targetValue,
    periodStart: params.periodStart.toISOString(),
    periodEnd: params.periodEnd.toISOString(),
  });
  await prisma.teamActivityEntry.create({ data: { teamId, userId: actorId, type: 'TARGET_CREATED', metadata: { targetId: target.id } } });
  return target;
}

export async function cancelTeamTarget(targetId: string, actorId: string): Promise<void> {
  const target = await prisma.teamTarget.findUnique({ where: { id: targetId } });
  if (!target) throw new AppError('NOT_FOUND', 'Team target not found');
  await requireActiveRole(target.teamId, actorId, ['OWNER', 'MANAGER']);
  if (target.status !== 'ACTIVE') return;
  await prisma.teamTarget.update({ where: { id: targetId }, data: { status: 'CANCELLED' } });
  await auditLog(actorId, 'TARGET_CANCELLED', 'TeamTarget', targetId);
}

const METRIC_CONTRIBUTIONS: Partial<Record<TeamActivityType, Partial<Record<TeamTargetMetric, (value: number) => number>>>> = {
  LIVE_HOURS_LOGGED: {
    LIVE_HOURS: (minutes) => minutes,
    LIVE_SESSIONS: () => 1,
    TEAM_ENGAGEMENT_POINTS: (minutes) => minutes,
  },
  GIFT_RECEIVED: {
    GIFTS_RECEIVED_COINS: (coins) => coins,
    TEAM_ENGAGEMENT_POINTS: (coins) => Math.floor(coins / 10),
  },
};

/**
 * The one place a Team's activity feed / target progress / leaderboard
 * inputs are ever written — called only from real, already-committed
 * platform events (LIVE session end, a Gift actually received), never from
 * membership/recruitment actions. `excludedAsFraud` mirrors XPEvent's own
 * posture: a fraud-held contributor's activity is still recorded (for audit)
 * but never counted toward a target or a public leaderboard.
 */
export async function logTeamActivity(
  userId: string,
  type: TeamActivityType,
  value: number,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  const member = await prisma.teamMember.findFirst({ where: { userId, status: 'ACTIVE' }, include: { team: true } });
  if (!member || member.team.status !== 'ACTIVE') return;

  const fraudHeld = Boolean(await prisma.fraudHold.findFirst({ where: { userId, status: 'ACTIVE' }, select: { id: true } }));

  await prisma.teamActivityEntry.create({
    data: { teamId: member.teamId, userId, type, value, excludedAsFraud: fraudHeld, metadata },
  });
  if (fraudHeld) return;

  const contributions = METRIC_CONTRIBUTIONS[type];
  if (!contributions) return;

  const now = new Date();
  const activeTargets = await prisma.teamTarget.findMany({
    where: { teamId: member.teamId, status: 'ACTIVE', periodStart: { lte: now }, periodEnd: { gte: now } },
  });

  for (const target of activeTargets) {
    const contribute = contributions[target.metric];
    if (!contribute) continue;
    const increment = contribute(value);
    if (increment <= 0) continue;

    const updated = await prisma.teamTarget.update({
      where: { id: target.id },
      data: { currentValue: { increment } },
    });

    if (updated.currentValue >= updated.targetValue && updated.status === 'ACTIVE') {
      await prisma.teamTarget.update({ where: { id: target.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await prisma.teamActivityEntry.create({ data: { teamId: member.teamId, type: 'TARGET_COMPLETED', metadata: { targetId: target.id } } });
      const managers = await prisma.teamMember.findMany({ where: { teamId: member.teamId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } } });
      for (const manager of managers) {
        await sendGamificationNotification(prisma, manager.userId, 'TEAM_TARGET_COMPLETED', { teamId: member.teamId, targetId: target.id, metric: target.metric });
      }
    }
  }
}
