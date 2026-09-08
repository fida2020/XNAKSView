import type { LiveMatch, LiveMatchSide, LiveMatchTeamMember } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

/**
 * Resolves which side (if any) a LIVE session is currently scoring for —
 * covers BOTH a SOLO/TEAM match's two captains (`sessionA`/`sessionB`,
 * unchanged from the original 1v1 design) AND a TEAM match's additional
 * `LiveMatchTeamMember` rows. Used by `giftService.ts` so a Gift sent
 * during a Team Match contributes to the correct side regardless of
 * whether the recipient is a captain or a team member — the per-side
 * `scoreA`/`scoreB` counter on `LiveMatch` is the SAME single aggregate
 * either way, never tracked per-member.
 */
export async function resolveActiveMatchSide(liveSessionId: string): Promise<{ liveMatchId: string; matchSide: 'A' | 'B' } | null> {
  const asCaptain = await prisma.liveMatch.findFirst({
    where: { status: 'ACTIVE', OR: [{ sessionAId: liveSessionId }, { sessionBId: liveSessionId }] },
  });
  if (asCaptain) {
    return { liveMatchId: asCaptain.id, matchSide: asCaptain.sessionAId === liveSessionId ? 'A' : 'B' };
  }

  const asTeamMember = await prisma.liveMatchTeamMember.findFirst({
    where: { liveSessionId, status: 'ACTIVE', match: { status: 'ACTIVE' } },
  });
  if (asTeamMember) {
    return { liveMatchId: asTeamMember.matchId, matchSide: asTeamMember.side };
  }

  return null;
}

export async function loadTeamMemberOrThrow(id: string): Promise<LiveMatchTeamMember> {
  const member = await prisma.liveMatchTeamMember.findUnique({ where: { id } });
  if (!member) throw new AppError('NOT_FOUND', 'Team Match member not found');
  return member;
}

/** Every session, on either side, currently part of a match — captains plus ACTIVE/INVITED team members — used to validate a new invite doesn't collide with someone already involved. */
export async function isSessionInMatch(matchId: string, liveSessionId: string): Promise<boolean> {
  const match = await prisma.liveMatch.findUnique({ where: { id: matchId } });
  if (!match) return false;
  if (match.sessionAId === liveSessionId || match.sessionBId === liveSessionId) return true;
  const existing = await prisma.liveMatchTeamMember.findFirst({
    where: { matchId, liveSessionId, status: { in: ['INVITED', 'ACTIVE'] } },
  });
  return existing != null;
}

/**
 * A LIVE session can only ever be committed to ONE live Match at a time —
 * whether as a captain or a team member — so a session already tied up
 * elsewhere can't also be invited into this one (duplicate/concurrent-event
 * guard called out explicitly in the Team Match brief).
 */
export async function isSessionInAnyOtherMatch(liveSessionId: string, excludeMatchId: string): Promise<boolean> {
  const asCaptain = await prisma.liveMatch.findFirst({
    where: {
      status: { in: ['PENDING', 'ACTIVE'] },
      id: { not: excludeMatchId },
      OR: [{ sessionAId: liveSessionId }, { sessionBId: liveSessionId }],
    },
    select: { id: true },
  });
  if (asCaptain) return true;

  const asMember = await prisma.liveMatchTeamMember.findFirst({
    where: {
      liveSessionId,
      status: { in: ['INVITED', 'ACTIVE'] },
      matchId: { not: excludeMatchId },
      match: { status: { in: ['PENDING', 'ACTIVE'] } },
    },
    select: { id: true },
  });
  return asMember != null;
}

/**
 * Only a captain or an ACTIVE team member of the given side may invite a
 * new session to join that same side — never the opposing side, never an
 * uninvolved account (brief: "anti-spoof authorization").
 */
export async function assertCanManageSide(match: LiveMatch, side: LiveMatchSide, userId: string): Promise<void> {
  const captainSessionId = side === 'A' ? match.sessionAId : match.sessionBId;
  const captainSession = await prisma.liveSession.findUnique({ where: { id: captainSessionId }, select: { hostId: true } });
  if (captainSession?.hostId === userId) return;

  const activeMember = await prisma.liveMatchTeamMember.findFirst({
    where: { matchId: match.id, side, status: 'ACTIVE', liveSession: { hostId: userId } },
  });
  if (activeMember) return;

  throw new AppError('FORBIDDEN', 'Only a host already on this side of the Team Match can do this');
}
