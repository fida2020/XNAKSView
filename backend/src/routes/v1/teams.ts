import type { LeaderboardPeriod } from '@prisma/client';
import { Router } from 'express';

import { getLeaderboard } from '@/lib/gamification/leaderboards';
import {
  cancelInvite,
  cancelTeamTarget,
  changeMemberRole,
  createTeam,
  createTeamTarget,
  disbandTeam,
  inviteMember,
  leaveTeam,
  removeMember,
  respondToInvite,
  transferOwnership,
  updateTeam,
} from '@/lib/gamification/teams';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { fetchAuthorSummaries } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { listQuerySchema, teamLeaderboardQuerySchema } from '@/schemas/gamification.schema';
import {
  changeTeamMemberRoleSchema,
  createTeamSchema,
  createTeamTargetSchema,
  inviteTeamMemberSchema,
  respondToTeamInviteSchema,
  transferTeamOwnershipSchema,
  updateTeamSchema,
} from '@/schemas/gamification.schema';
import { AppError } from '@/utils/AppError';

/** LIVE Teams (brief §5-9) — an XNAKView-original creator/host team feature; see teams.ts's own doc comment. */
export const teamsRouter = Router();

const teamActionLimiter = createAuthRateLimiter(60 * 1000, 20, 'team-action');
const teamCreateLimiter = createAuthRateLimiter(60 * 60 * 1000, 3, 'team-create');

function cursorWhere(cursor: string | undefined) {
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');
  return decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {};
}

function paginate<T extends { id: string; createdAt: Date }>(items: T[], limit: number) {
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { page, nextCursor };
}

async function loadTeamOrThrow(id: string) {
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) throw new AppError('NOT_FOUND', 'Team not found');
  return team;
}

teamsRouter.post('/teams', requireAuth, teamCreateLimiter, validate({ body: createTeamSchema }), async (req, res, next) => {
  try {
    const team = await createTeam(req.user!.id, req.body);
    res.status(201).json(team);
  } catch (error) {
    next(error);
  }
});

/** Teams the caller currently belongs to (any role) — never a full public directory (brief doesn't ask for open team discovery, and unmoderated open discovery would invite spam invites). */
teamsRouter.get('/teams/me', requireAuth, async (req, res, next) => {
  try {
    const memberships = await prisma.teamMember.findMany({
      where: { userId: req.user!.id, status: 'ACTIVE' },
      include: { team: true },
    });
    res.status(200).json({ teams: memberships.map((m) => ({ ...m.team, myRole: m.role })) });
  } catch (error) {
    next(error);
  }
});

// Registered before `/teams/:id` — otherwise that route's `:id` param would
// greedily match the literal "leaderboard" segment first (same Express
// route-ordering gotcha documented in routes/v1/index.ts).
teamsRouter.get('/teams/leaderboard', requireAuth, validate({ query: teamLeaderboardQuerySchema }), async (req, res, next) => {
  try {
    const { period } = req.query as unknown as { period: LeaderboardPeriod };
    const { snapshot, entries } = await getLeaderboard('TEAM_PERFORMANCE', period);
    const teams = await prisma.team.findMany({ where: { id: { in: entries.map((e) => e.subjectId) } } });
    const teamById = new Map(teams.map((t) => [t.id, t]));
    res.status(200).json({
      period: snapshot.period,
      periodKey: snapshot.periodKey,
      computedAt: snapshot.computedAt,
      entries: entries.map((e) => ({ rank: e.rank, score: e.score.toString(), team: teamById.get(e.subjectId) ?? null })),
    });
  } catch (error) {
    next(error);
  }
});

teamsRouter.get('/teams/:id', requireAuth, async (req, res, next) => {
  try {
    const team = await loadTeamOrThrow(req.params.id!);
    const members = await prisma.teamMember.findMany({ where: { teamId: team.id, status: 'ACTIVE' }, orderBy: { joinedAt: 'asc' } });
    const authors = await fetchAuthorSummaries(members.map((m) => m.userId));
    res.status(200).json({
      ...team,
      members: members.map((m) => ({ userId: m.userId, role: m.role, joinedAt: m.joinedAt, author: authors.get(m.userId) })),
    });
  } catch (error) {
    next(error);
  }
});

teamsRouter.patch('/teams/:id', requireAuth, teamActionLimiter, validate({ body: updateTeamSchema }), async (req, res, next) => {
  try {
    const team = await updateTeam(req.params.id!, req.user!.id, req.body);
    res.status(200).json(team);
  } catch (error) {
    next(error);
  }
});

teamsRouter.delete('/teams/:id', requireAuth, teamActionLimiter, async (req, res, next) => {
  try {
    await disbandTeam(req.params.id!, req.user!.id);
    res.status(200).json({ disbanded: true });
  } catch (error) {
    next(error);
  }
});

teamsRouter.post('/teams/:id/leave', requireAuth, teamActionLimiter, async (req, res, next) => {
  try {
    await leaveTeam(req.params.id!, req.user!.id);
    res.status(200).json({ left: true });
  } catch (error) {
    next(error);
  }
});

teamsRouter.post('/teams/:id/transfer-ownership', requireAuth, teamActionLimiter, validate({ body: transferTeamOwnershipSchema }), async (req, res, next) => {
  try {
    await transferOwnership(req.params.id!, req.user!.id, req.body.newOwnerId);
    res.status(200).json({ transferred: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Membership: invite / respond / remove / role
// ---------------------------------------------------------------------------

teamsRouter.post('/teams/:id/invites', requireAuth, teamActionLimiter, validate({ body: inviteTeamMemberSchema }), async (req, res, next) => {
  try {
    const invite = await inviteMember(req.params.id!, req.user!.id, req.body.userId);
    res.status(201).json(invite);
  } catch (error) {
    next(error);
  }
});

teamsRouter.delete('/teams/:id/invites/:inviteId', requireAuth, teamActionLimiter, async (req, res, next) => {
  try {
    await cancelInvite(req.params.inviteId!, req.user!.id);
    res.status(200).json({ cancelled: true });
  } catch (error) {
    next(error);
  }
});

/** Invites addressed to the caller across every team — the mobile "Team invites" inbox. */
teamsRouter.get('/teams/invites/received', requireAuth, async (req, res, next) => {
  try {
    const invites = await prisma.teamInvite.findMany({
      where: { inviteeId: req.user!.id, status: 'PENDING' },
      include: { team: true },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ invites });
  } catch (error) {
    next(error);
  }
});

teamsRouter.post('/teams/invites/:inviteId/respond', requireAuth, teamActionLimiter, validate({ body: respondToTeamInviteSchema }), async (req, res, next) => {
  try {
    await respondToInvite(req.params.inviteId!, req.user!.id, req.body.accept);
    res.status(200).json({ accepted: req.body.accept });
  } catch (error) {
    next(error);
  }
});

teamsRouter.delete('/teams/:id/members/:userId', requireAuth, teamActionLimiter, async (req, res, next) => {
  try {
    await removeMember(req.params.id!, req.user!.id, req.params.userId!);
    res.status(200).json({ removed: true });
  } catch (error) {
    next(error);
  }
});

teamsRouter.patch('/teams/:id/members/:userId/role', requireAuth, teamActionLimiter, validate({ body: changeTeamMemberRoleSchema }), async (req, res, next) => {
  try {
    await changeMemberRole(req.params.id!, req.user!.id, req.params.userId!, req.body.role);
    res.status(200).json({ role: req.body.role });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

teamsRouter.get('/teams/:id/targets', requireAuth, async (req, res, next) => {
  try {
    await loadTeamOrThrow(req.params.id!);
    const targets = await prisma.teamTarget.findMany({ where: { teamId: req.params.id! }, orderBy: { createdAt: 'desc' } });
    res.status(200).json({ targets });
  } catch (error) {
    next(error);
  }
});

teamsRouter.post('/teams/:id/targets', requireAuth, teamActionLimiter, validate({ body: createTeamTargetSchema }), async (req, res, next) => {
  try {
    const target = await createTeamTarget(req.params.id!, req.user!.id, req.body);
    res.status(201).json(target);
  } catch (error) {
    next(error);
  }
});

teamsRouter.delete('/teams/:id/targets/:targetId', requireAuth, teamActionLimiter, async (req, res, next) => {
  try {
    await cancelTeamTarget(req.params.targetId!, req.user!.id);
    res.status(200).json({ cancelled: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Activity & leaderboard
// ---------------------------------------------------------------------------

teamsRouter.get('/teams/:id/activity', requireAuth, validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    await loadTeamOrThrow(req.params.id!);
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const entries = await prisma.teamActivityEntry.findMany({
      where: { teamId: req.params.id!, excludedAsFraud: false, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(entries, limit);
    res.status(200).json({ activity: page, nextCursor });
  } catch (error) {
    next(error);
  }
});
