import { Prisma, type GiftContentType, type GiftTransaction, type LiveGiftParticipantRole } from '@prisma/client';

import { creditDiamonds, calculateDiamonds, getCurrentDiamondEarnRate } from '@/lib/diamondLedger';
import { debitCoins, InsufficientCoinsError } from '@/lib/coinLedger';
import { assessGiftingRisk } from '@/lib/fraudRiskEngine';
import { onGiftTransaction } from '@/lib/gamification/events';
import { isBlockedEitherDirection } from '@/lib/messagingAccess';
import { getCurrentPlatformRevenueRule, splitCoins } from '@/lib/platformRevenue';
import { resolveActiveMatchSide } from '@/lib/liveMatchTeams';
import { prisma } from '@/lib/prisma';
import { emitToLiveSession } from '@/lib/realtime';
import { AppError } from '@/utils/AppError';

/**
 * The one place a Gift is actually sent — every route that lets a user send
 * a Gift (LIVE, video, a later content type) calls this, never touches
 * `CoinWallet`/`CreatorDiamondWallet` directly. A viewer never "transfers
 * Coins to the host/guest" — see the model comment on `GiftTransaction` —
 * they spend Coins to activate a Gift, the platform attributes it to a
 * server-validated recipient, and that recipient earns a Diamond credit
 * computed from the current `DiamondEarnRate`, entirely separate from the
 * Coin the sender spent.
 */

export type GiftTarget =
  | { type: 'LIVE'; liveSessionId: string; targetParticipantId?: string }
  | { type: 'VIDEO'; videoId: string }
  | { type: 'PHOTO_POST'; photoPostId: string }
  | { type: 'TEXT_POST'; textPostId: string };

export interface SendGiftParams {
  senderId: string;
  giftSlug: string;
  quantity: number;
  target: GiftTarget;
  idempotencyKey: string;
}

export interface SendGiftResult {
  transaction: GiftTransaction;
  recipientId: string;
  participantRole: LiveGiftParticipantRole | null;
  diamondsCredited: number;
  platformSharePercent: string;
  senderBalance: number;
  alreadyProcessed: boolean;
}

interface ResolvedTarget {
  recipientId: string;
  contentType: GiftContentType;
  contentId: string | null;
  liveSessionId: string | null;
  participantRole: LiveGiftParticipantRole | null;
  liveGuestSlotId: string | null;
  liveMatchId: string | null;
  matchSide: 'A' | 'B' | null;
}

/**
 * Resolves who a Gift actually belongs to — the mobile client may express
 * intent (e.g. "I'm gifting this specific guest"), but the server
 * independently re-derives the real recipient from current LIVE/content
 * state every time. A `targetParticipantId` that isn't the session's real
 * host and isn't currently holding an ACTIVE `LiveGuestSlot` in that exact
 * session is rejected outright, never silently defaulted to the host.
 */
async function resolveTarget(target: GiftTarget): Promise<ResolvedTarget> {
  if (target.type === 'LIVE') {
    const session = await prisma.liveSession.findUnique({ where: { id: target.liveSessionId } });
    if (!session || session.status !== 'LIVE') {
      throw new AppError('CONFLICT', 'This LIVE session is not currently live');
    }

    let recipientId: string;
    let participantRole: LiveGiftParticipantRole;
    let liveGuestSlotId: string | null = null;

    if (!target.targetParticipantId || target.targetParticipantId === session.hostId) {
      recipientId = session.hostId;
      participantRole = 'HOST';
    } else {
      const guestSlot = await prisma.liveGuestSlot.findFirst({
        where: { liveSessionId: session.id, userId: target.targetParticipantId, status: 'ACTIVE' },
      });
      if (!guestSlot) {
        throw new AppError('BAD_REQUEST', 'The requested Gift recipient is not currently an active participant in this LIVE session');
      }
      recipientId = guestSlot.userId;
      participantRole = guestSlot.role === 'CO_HOST' ? 'CO_HOST' : 'GUEST';
      liveGuestSlotId = guestSlot.id;
    }

    // Mid-Battle: this session's side (whether it's a SOLO/TEAM captain or
    // an ACTIVE Team Match member) gets the score contribution, kept
    // entirely separate from the Coin/Diamond ledgers below.
    const activeMatchSide = await resolveActiveMatchSide(session.id);

    return {
      recipientId,
      contentType: 'LIVE',
      contentId: null,
      liveSessionId: session.id,
      participantRole,
      liveGuestSlotId,
      liveMatchId: activeMatchSide?.liveMatchId ?? null,
      matchSide: activeMatchSide?.matchSide ?? null,
    };
  }

  if (target.type === 'VIDEO') {
    const video = await prisma.video.findUnique({ where: { id: target.videoId } });
    if (!video || video.status !== 'READY' || video.visibility !== 'PUBLIC') {
      throw new AppError('NOT_FOUND', 'Video not found');
    }
    if (!video.allowGifts) {
      throw new AppError('FORBIDDEN', 'The creator has disabled Gifts for this video');
    }
    return { recipientId: video.userId, contentType: 'VIDEO', contentId: video.id, liveSessionId: null, participantRole: null, liveGuestSlotId: null, liveMatchId: null, matchSide: null };
  }

  if (target.type === 'PHOTO_POST') {
    const post = await prisma.photoPost.findUnique({ where: { id: target.photoPostId } });
    if (!post || post.deletedAt || post.visibility !== 'PUBLIC') {
      throw new AppError('NOT_FOUND', 'Photo post not found');
    }
    return { recipientId: post.userId, contentType: 'PHOTO_POST', contentId: post.id, liveSessionId: null, participantRole: null, liveGuestSlotId: null, liveMatchId: null, matchSide: null };
  }

  const post = await prisma.textPost.findUnique({ where: { id: target.textPostId } });
  if (!post || post.deletedAt || post.visibility !== 'PUBLIC') {
    throw new AppError('NOT_FOUND', 'Text post not found');
  }
  return { recipientId: post.userId, contentType: 'TEXT_POST', contentId: post.id, liveSessionId: null, participantRole: null, liveGuestSlotId: null, liveMatchId: null, matchSide: null };
}

/** How many Coins one point of LIVE Match/Battle score is worth — an explicit, disclosed XNAKView rule, never presented as TikTok's real (undisclosed) scoring algorithm. */
const SCORE_COINS_PER_POINT = 1;

/**
 * Given a GiftTransaction that already exists in the database — whether
 * because this call found it up front, or because it just lost a create
 * race to a concurrent identical request — works out its LIVE attribution
 * state: already attributed (nothing to do), needs attributing (crash-
 * recovery/race-loss, reconstructed from the recipient this transaction
 * already permanently recorded, never re-resolved from scratch), or not a
 * LIVE Gift at all. Centralizing this is what makes the loser of a create
 * race behave identically to a plain idempotent replay, instead of
 * (incorrectly) re-running its own target resolution.
 */
async function loadOrRebuildAttribution(transaction: GiftTransaction): Promise<{ participantRole: LiveGiftParticipantRole | null; pending: ResolvedTarget | null }> {
  if (!transaction.liveSessionId) {
    return { participantRole: null, pending: null };
  }

  const existingEntry = await prisma.liveGiftAttributionEntry.findUnique({ where: { giftTransactionId: transaction.id } });
  if (existingEntry) {
    return { participantRole: existingEntry.participantRole, pending: null };
  }

  const session = await prisma.liveSession.findUnique({ where: { id: transaction.liveSessionId } });
  if (!session) {
    return { participantRole: null, pending: null };
  }

  let role: LiveGiftParticipantRole = 'HOST';
  let liveGuestSlotId: string | null = null;
  if (transaction.recipientId !== session.hostId) {
    const guestSlot = await prisma.liveGuestSlot.findFirst({ where: { liveSessionId: session.id, userId: transaction.recipientId } });
    role = guestSlot?.role === 'CO_HOST' ? 'CO_HOST' : 'GUEST';
    liveGuestSlotId = guestSlot?.id ?? null;
  }
  const activeMatchSide = await resolveActiveMatchSide(session.id);
  const pending: ResolvedTarget = {
    recipientId: transaction.recipientId,
    contentType: 'LIVE',
    contentId: null,
    liveSessionId: session.id,
    participantRole: role,
    liveGuestSlotId,
    liveMatchId: activeMatchSide?.liveMatchId ?? null,
    matchSide: activeMatchSide?.matchSide ?? null,
  };
  return { participantRole: role, pending };
}

export async function sendGift(params: SendGiftParams): Promise<SendGiftResult> {
  const existing = await prisma.giftTransaction.findUnique({ where: { idempotencyKey: params.idempotencyKey } });

  let transaction: GiftTransaction;
  let participantRole: LiveGiftParticipantRole | null = null;
  let freshlySent = false;
  let pendingLiveAttribution: ResolvedTarget | null = null;

  if (existing) {
    transaction = existing;
    ({ participantRole, pending: pendingLiveAttribution } = await loadOrRebuildAttribution(existing));
  } else {
    const gift = await prisma.gift.findUnique({ where: { slug: params.giftSlug } });
    if (!gift || !gift.active) {
      throw new AppError('NOT_FOUND', 'Gift not found');
    }
    if (!Number.isInteger(params.quantity) || params.quantity < 1 || params.quantity > gift.maxQuantityPerSend) {
      throw new AppError('BAD_REQUEST', `Quantity must be between 1 and ${gift.maxQuantityPerSend}`);
    }

    const resolved = await resolveTarget(params.target);
    participantRole = resolved.participantRole;

    if (resolved.recipientId === params.senderId) {
      throw new AppError('BAD_REQUEST', 'You cannot send a Gift to yourself');
    }
    if (await isBlockedEitherDirection(params.senderId, resolved.recipientId)) {
      throw new AppError('FORBIDDEN', 'You cannot send a Gift to this user');
    }
    const recipient = await prisma.user.findUnique({ where: { id: resolved.recipientId }, select: { status: true } });
    if (!recipient || recipient.status !== 'ACTIVE') {
      throw new AppError('BAD_REQUEST', 'This account cannot receive Gifts right now');
    }

    // Step 10 fraud extension — gift velocity / coordinated-gifting risk
    // (see fraudRiskEngine.ts's doc comment; self-gifting is already
    // structurally impossible via the check above).
    const giftRisk = await assessGiftingRisk({ senderId: params.senderId, recipientId: resolved.recipientId });
    if (giftRisk.blocked) {
      throw new AppError('FORBIDDEN', 'Your account currently has a compliance hold that blocks sending Gifts');
    }

    const totalCoins = gift.coinCost * params.quantity;

    // Self-set daily budgeting cap (current TikTok's personal spending-limit
    // feature) — an opt-in user control, never a platform-mandated limit.
    const wallet = await prisma.coinWallet.findUnique({ where: { userId: params.senderId } });
    if (wallet?.dailyGiftLimitCoins != null) {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const spentToday = await prisma.coinLedgerEntry.aggregate({
        where: { walletId: wallet.id, type: 'GIFT_SENT', direction: 'DEBIT', createdAt: { gte: since } },
        _sum: { amount: true },
      });
      if ((spentToday._sum.amount ?? 0) + totalCoins > wallet.dailyGiftLimitCoins) {
        throw new AppError('BAD_REQUEST', 'This would exceed your self-set daily Gift spending limit');
      }
    }

    try {
      await debitCoins({
        userId: params.senderId,
        amount: totalCoins,
        type: 'GIFT_SENT',
        referenceType: 'GIFT',
        referenceId: params.idempotencyKey,
        idempotencyKey: `${params.idempotencyKey}:coin-debit`,
      });
    } catch (error) {
      if (error instanceof InsufficientCoinsError) {
        throw new AppError('INSUFFICIENT_COINS', 'Not enough Coins to send this Gift');
      }
      throw error;
    }

    try {
      transaction = await prisma.giftTransaction.create({
        data: {
          senderId: params.senderId,
          recipientId: resolved.recipientId,
          giftId: gift.id,
          coinCost: gift.coinCost,
          quantity: params.quantity,
          totalCoins,
          contentType: resolved.contentType,
          contentId: resolved.contentId,
          liveSessionId: resolved.liveSessionId,
          idempotencyKey: params.idempotencyKey,
        },
      });
      // Only the request whose OWN create() actually inserted the row is
      // "fresh" — it alone broadcasts the realtime event and returns 201.
      freshlySent = true;
      pendingLiveAttribution = resolved;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A concurrent identical request won the race to create the row —
        // the Coin debit above was already a safe no-op on their side via
        // the same idempotency key. Re-fetch the winner's row and treat
        // this call exactly like a plain idempotent replay (never trust
        // this call's own locally-resolved `resolved` — the winner's
        // stored recipient is the only one that matters).
        transaction = await prisma.giftTransaction.findUniqueOrThrow({ where: { idempotencyKey: params.idempotencyKey } });
        ({ participantRole, pending: pendingLiveAttribution } = await loadOrRebuildAttribution(transaction));
      } else {
        throw error;
      }
    }
  }

  const rule = await getCurrentPlatformRevenueRule('GIFT');
  const { platformShareCoins, creatorShareCoins } = splitCoins(transaction.totalCoins, rule.platformSharePercent);
  await prisma.platformRevenueLedgerEntry
    .create({
      data: { giftTransactionId: transaction.id, ruleId: rule.id, totalCoins: transaction.totalCoins, platformShareCoins, creatorShareCoins },
    })
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    });

  const diamondRate = await getCurrentDiamondEarnRate();
  const diamonds = calculateDiamonds(creatorShareCoins, diamondRate.coinsPerDiamond);
  const { entry: diamondEntry } = await creditDiamonds({
    creatorId: transaction.recipientId,
    diamonds,
    sourceType: transaction.liveSessionId ? 'LIVE_GIFT' : 'VIDEO_GIFT',
    giftTransactionId: transaction.id,
    idempotencyKey: `${transaction.idempotencyKey}:diamond-credit`,
  });

  if (transaction.liveSessionId && pendingLiveAttribution) {
    const resolved = pendingLiveAttribution;
    const scoreContribution = resolved.liveMatchId ? transaction.totalCoins * SCORE_COINS_PER_POINT : null;
    try {
      await prisma.liveGiftAttributionEntry.create({
        data: {
          giftTransactionId: transaction.id,
          liveSessionId: transaction.liveSessionId,
          attributedParticipantId: transaction.recipientId,
          participantRole: resolved.participantRole!,
          liveGuestSlotId: resolved.liveGuestSlotId,
          liveMatchId: resolved.liveMatchId,
          matchSide: resolved.matchSide,
          scoreContribution,
        },
      });
      if (resolved.liveMatchId && scoreContribution) {
        await prisma.liveMatch.update({
          where: { id: resolved.liveMatchId },
          data: resolved.matchSide === 'A' ? { scoreA: { increment: scoreContribution } } : { scoreB: { increment: scoreContribution } },
        });
      }
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
      // Attribution entry already exists (a resumed/raced retry) — the
      // score increment already happened on the attempt that created it.
    }
  }

  if (freshlySent && transaction.liveSessionId) {
    const gift = await prisma.gift.findUnique({ where: { id: transaction.giftId } });
    const sender = await prisma.user.findUnique({ where: { id: transaction.senderId }, select: { profile: { select: { username: true, displayName: true } } } });
    emitToLiveSession(transaction.liveSessionId, 'gift:sent', {
      giftTransactionId: transaction.id,
      senderId: transaction.senderId,
      senderUsername: sender?.profile?.username ?? null,
      senderDisplayName: sender?.profile?.displayName ?? null,
      giftId: transaction.giftId,
      giftName: gift?.name,
      giftSlug: gift?.slug,
      animationAssetKey: gift?.animationAssetKey,
      quantity: transaction.quantity,
      totalCoins: transaction.totalCoins,
      recipientId: transaction.recipientId,
      participantRole,
    });

    // LIVE Goal — a real, server-computed progress update driven by this
    // actual Gift's real totalCoins (never a client-reported or
    // timer-simulated value), gated on `freshlySent` the same way the
    // gift:sent broadcast above is so a raced duplicate never double-counts.
    const updatedSession = await prisma.liveSession.updateMany({
      where: { id: transaction.liveSessionId, goalEnabled: true },
      data: { goalProgressCoins: { increment: transaction.totalCoins } },
    });
    if (updatedSession.count > 0) {
      const session = await prisma.liveSession.findUnique({
        where: { id: transaction.liveSessionId },
        select: { goalTargetCoins: true, goalProgressCoins: true },
      });
      if (session) {
        emitToLiveSession(transaction.liveSessionId, 'live:goalProgress', {
          goalProgressCoins: session.goalProgressCoins,
          goalTargetCoins: session.goalTargetCoins,
        });
      }
    }
  }

  const senderWallet = await prisma.coinWallet.findUnique({ where: { userId: transaction.senderId } });

  // Step 11 gamification — fires only for the genuinely fresh send (never a
  // replayed/idempotent duplicate), and only after every Coin/Diamond/
  // platform-revenue write above has fully committed. Never blocks or fails
  // the Gift itself — see events.ts's own doc comment.
  if (freshlySent) {
    onGiftTransaction({
      senderId: transaction.senderId,
      recipientId: transaction.recipientId,
      giftTransactionId: transaction.id,
      totalCoins: transaction.totalCoins,
    });
  }

  return {
    transaction,
    recipientId: transaction.recipientId,
    participantRole,
    diamondsCredited: diamondEntry.diamonds,
    platformSharePercent: rule.platformSharePercent.toFixed(2),
    senderBalance: senderWallet?.balance ?? 0,
    alreadyProcessed: !freshlySent,
  };
}
