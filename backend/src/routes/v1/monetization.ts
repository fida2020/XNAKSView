import { createHmac, timingSafeEqual } from 'crypto';

import { Router } from 'express';
import type { Prisma } from '@prisma/client';

import { DEFAULT_CREATOR_SHARE_PERCENT, recordAdRevenueEvent } from '@/lib/adRevenueService';
import { env } from '@/config/env';
import { evaluateEligibility, refreshMonetizationStatus } from '@/lib/monetizationEligibility';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { listCreatorRevenueQuerySchema, recordAdRevenueEventSchema } from '@/schemas/monetization.schema';
import { AppError } from '@/utils/AppError';

export const monetizationRouter = Router();

const webhookLimiter = createAuthRateLimiter(60 * 1000, 120, 'ad-revenue-webhook');

function serializeAdRevenueEvent(e: {
  id: string;
  type: string;
  provider: string;
  videoId: string;
  impressions: number;
  validImpressions: number;
  clicks: number | null;
  grossRevenueMinorUnits: number;
  currency: string;
  status: string;
  wasMonetizationActive: boolean;
  creatorSharePercentSnapshot: Prisma.Decimal | null;
  creatorShareMinorUnits: number;
  platformShareMinorUnits: number;
  reversalOfEventId: string | null;
  createdAt: Date;
}) {
  return {
    id: e.id,
    type: e.type,
    provider: e.provider,
    videoId: e.videoId,
    impressions: e.impressions,
    validImpressions: e.validImpressions,
    clicks: e.clicks,
    grossRevenueMinorUnits: e.grossRevenueMinorUnits,
    currency: e.currency,
    status: e.status,
    wasMonetizationActive: e.wasMonetizationActive,
    creatorSharePercent: e.creatorSharePercentSnapshot ? e.creatorSharePercentSnapshot.toFixed(2) : null,
    creatorShareMinorUnits: e.creatorShareMinorUnits,
    platformShareMinorUnits: e.platformShareMinorUnits,
    reversalOfEventId: e.reversalOfEventId,
    createdAt: e.createdAt,
  };
}

/**
 * Creator-facing Monetization dashboard (brief §5/§6/§16) — status,
 * eligibility progress against the CURRENT admin-configured rule, the
 * active ad-revenue share, and monetization activation date. Every number
 * here is server-computed; the mobile client never decides eligibility.
 */
monetizationRouter.get('/creator/monetization/status', requireAuth, async (req, res, next) => {
  try {
    const creatorId = req.user!.id;
    await refreshMonetizationStatus(creatorId);

    const [monetization, eligibility] = await Promise.all([
      prisma.creatorMonetization.findUniqueOrThrow({ where: { creatorId } }),
      evaluateEligibility(creatorId),
    ]);

    const shareRule = await prisma.adRevenueShareRule.findFirst({
      where: { active: true, effectiveFrom: { lte: new Date() }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }] },
      orderBy: { effectiveFrom: 'desc' },
    });

    res.status(200).json({
      status: monetization.status,
      activatedAt: monetization.activatedAt,
      statusReason: monetization.statusReason,
      eligible: eligibility.eligible,
      requirements: eligibility.requirements,
      creatorSharePercent: shareRule ? shareRule.creatorSharePercent.toFixed(2) : DEFAULT_CREATOR_SHARE_PERCENT.toFixed(2),
    });
  } catch (error) {
    next(error);
  }
});

/** Paginated ad-revenue history for the signed-in creator — REVENUE and REVERSAL rows both included, distinguishable by `type`. */
monetizationRouter.get('/creator/monetization/revenue', requireAuth, validate({ query: listCreatorRevenueQuerySchema }), async (req, res, next) => {
  try {
    const creatorId = req.user!.id;
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const events = await prisma.adRevenueEvent.findMany({
      where: {
        creatorId,
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    res.status(200).json({ history: page.map(serializeAdRevenueEvent), nextCursor });
  } catch (error) {
    next(error);
  }
});

/**
 * The real ad-provider revenue webhook — a provider-agnostic HMAC-SHA256
 * signature check (brief names no specific ad network to integrate),
 * exactly the same "genuinely real, fully controllable in tests, honest
 * refusal when unconfigured" pattern as `paymentProviders.ts`'s
 * WebPaymentProvider. Body: the raw JSON matches
 * `recordAdRevenueEventSchema` plus a `signature` field —
 * `signature = HMAC-SHA256(AD_REVENUE_WEBHOOK_SECRET, JSON.stringify(payload-without-signature))`.
 * Never a fake/assumed revenue number — this is the ONLY way actual ad
 * revenue enters the system.
 */
monetizationRouter.post('/ad-revenue/webhook', webhookLimiter, async (req, res, next) => {
  try {
    if (!env.AD_REVENUE_WEBHOOK_SECRET) {
      throw new AppError('SERVICE_UNAVAILABLE', 'The ad-revenue webhook is not configured on this server (set AD_REVENUE_WEBHOOK_SECRET)');
    }

    const { signature, ...payload } = req.body as Record<string, unknown>;
    if (typeof signature !== 'string') {
      throw new AppError('BAD_REQUEST', 'Missing signature');
    }

    const serialized = JSON.stringify(payload);
    const expected = createHmac('sha256', env.AD_REVENUE_WEBHOOK_SECRET).update(serialized).digest('hex');
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
      throw new AppError('UNAUTHORIZED', 'Invalid webhook signature');
    }

    const parsed = recordAdRevenueEventSchema.parse(payload);
    const result = await recordAdRevenueEvent(parsed);
    res.status(201).json(serializeAdRevenueEvent(result.event));
  } catch (error) {
    next(error);
  }
});
