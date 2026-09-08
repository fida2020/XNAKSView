import { Router } from 'express';

import { exchangeEarningsToCoins, previewExchangeEarningsToCoins, InsufficientEarningsError as InsufficientEarningsForExchangeError } from '@/lib/earningsExchangeService';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { cancelWithdrawal } from '@/lib/withdrawalService';
import { previewWithdrawal, runAutomaticWithdrawal } from '@/lib/withdrawalOrchestrator';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { exchangePreviewQuerySchema, exchangeToCoinsSchema, listLedgerQuerySchema } from '@/schemas/creator.schema';
import { createWithdrawalSchema, withdrawalPreviewQuerySchema } from '@/schemas/payoutMethod.schema';
import { AppError } from '@/utils/AppError';

/** Creator-side monetization surface — Diamonds ≠ Coins ≠ Earnings, three separate wallets/ledgers exposed here, never collapsed into one balance (brief §24). */
export const creatorRouter = Router();

const withdrawalLimiter = createAuthRateLimiter(60 * 1000, 10, 'withdrawal');
const exchangeLimiter = createAuthRateLimiter(60 * 1000, 10, 'earnings-exchange');

creatorRouter.get('/creator/diamonds', requireAuth, async (req, res, next) => {
  try {
    const wallet = await prisma.creatorDiamondWallet.findUnique({ where: { creatorId: req.user!.id } });
    res.status(200).json({ balance: wallet?.balance ?? 0 });
  } catch (error) {
    next(error);
  }
});

creatorRouter.get('/creator/diamonds/history', requireAuth, validate({ query: listLedgerQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const wallet = await prisma.creatorDiamondWallet.findUnique({ where: { creatorId: req.user!.id } });
    if (!wallet) {
      res.status(200).json({ history: [], nextCursor: null });
      return;
    }
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const entries = await prisma.creatorDiamondLedgerEntry.findMany({
      where: {
        walletId: wallet.id,
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    res.status(200).json({
      history: page.map((e) => ({
        id: e.id,
        direction: e.direction,
        sourceType: e.sourceType,
        diamonds: e.diamonds,
        beforeBalance: e.beforeBalance,
        afterBalance: e.afterBalance,
        giftTransactionId: e.giftTransactionId,
        createdAt: e.createdAt,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

creatorRouter.get('/creator/earnings', requireAuth, async (req, res, next) => {
  try {
    const wallet = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: req.user!.id } });
    res.status(200).json({ balanceMinorUnits: wallet?.balanceMinorUnits ?? 0, currency: wallet?.currency ?? 'USD' });
  } catch (error) {
    next(error);
  }
});

creatorRouter.get('/creator/earnings/history', requireAuth, validate({ query: listLedgerQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const wallet = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: req.user!.id } });
    if (!wallet) {
      res.status(200).json({ history: [], nextCursor: null });
      return;
    }
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const entries = await prisma.creatorEarningsLedgerEntry.findMany({
      where: {
        walletId: wallet.id,
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    res.status(200).json({
      history: page.map((e) => ({
        id: e.id,
        direction: e.direction,
        type: e.type,
        amountMinorUnits: e.amountMinorUnits,
        currency: e.currency,
        beforeBalance: e.beforeBalance,
        afterBalance: e.afterBalance,
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        createdAt: e.createdAt,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Preview-only — never persists anything. Backs both the LIVE Recharge
 * sheet's "From LIVE rewards: $X.XX (XXX Coins)" line (no `amountMinorUnits`
 * — defaults to the full current Earnings balance) and the Exchange
 * screen's live-recalculating "custom amount" field. The mobile client
 * never decides the final Coin amount — this is purely a display aid; the
 * real, authoritative calculation happens again server-side inside
 * `exchangeEarningsToCoins` at confirmation time.
 */
creatorRouter.get('/creator/earnings/exchange-preview', requireAuth, validate({ query: exchangePreviewQuerySchema }), async (req, res, next) => {
  try {
    const { amountMinorUnits } = req.query as unknown as { amountMinorUnits?: number };
    const preview = await previewExchangeEarningsToCoins(req.user!.id, amountMinorUnits);
    res.status(200).json(preview);
  } catch (error) {
    next(error);
  }
});

/**
 * Earnings → Coins (brief: "Exchange LIVE rewards balance for Coins") — the
 * creator-chosen alternative to Withdraw. See `earningsExchangeService.ts`
 * for the full atomic/idempotent/rate-snapshot mechanics.
 */
creatorRouter.post('/creator/earnings/exchange-to-coins', requireAuth, exchangeLimiter, validate({ body: exchangeToCoinsSchema }), async (req, res, next) => {
  try {
    const result = await exchangeEarningsToCoins({
      creatorId: req.user!.id,
      amountMinorUnits: req.body.amountMinorUnits,
      currency: req.body.currency,
      idempotencyKey: req.body.idempotencyKey,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof InsufficientEarningsForExchangeError) {
      next(new AppError('BAD_REQUEST', 'Insufficient available reward balance for this exchange amount'));
      return;
    }
    next(error);
  }
});

creatorRouter.get('/creator/withdrawals', requireAuth, validate({ query: listLedgerQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const withdrawals = await prisma.withdrawal.findMany({
      where: {
        creatorId: req.user!.id,
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = withdrawals.length > limit;
    const page = hasMore ? withdrawals.slice(0, limit) : withdrawals;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    res.status(200).json({
      withdrawals: page.map((w) => ({
        id: w.id,
        amountMinorUnits: w.amountMinorUnits,
        currency: w.currency,
        provider: w.provider,
        countryCode: w.countryCode,
        feeMinorUnits: w.feeMinorUnits,
        netAmountMinorUnits: w.netAmountMinorUnits,
        status: w.status,
        rejectionReason: w.rejectionReason,
        failureReason: w.failureReason,
        createdAt: w.createdAt,
        processedAt: w.processedAt,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

/** Fee/FX/net preview BEFORE submission — required by the brief ("creator ko withdrawal se pehle amount/currency/fee/final expected payout clear dikhao"). Never persists anything. */
creatorRouter.get('/creator/withdrawals/preview', requireAuth, validate({ query: withdrawalPreviewQuerySchema }), async (req, res, next) => {
  try {
    const { amountMinorUnits } = req.query as unknown as { amountMinorUnits: number };
    const preview = await previewWithdrawal(req.user!.id, amountMinorUnits);
    res.status(200).json(preview);
  } catch (error) {
    next(error);
  }
});

/**
 * Fully automatic (Step 9) — eligibility, KYC, fraud/risk, country/provider
 * routing, bank-detail verification, provider submission, and (via
 * `routes/v1/payoutWebhooks.ts`) the PAID/FAILED confirmation are ALL
 * driven by `lib/withdrawalOrchestrator.ts`. No admin step in this path —
 * see `routes/v1/adminEconomy.ts`'s withdrawal-review routes, which are
 * now an exception-only override, not part of this flow.
 */
creatorRouter.post('/creator/withdrawals', requireAuth, withdrawalLimiter, validate({ body: createWithdrawalSchema }), async (req, res, next) => {
  try {
    const withdrawal = await runAutomaticWithdrawal({
      userId: req.user!.id,
      ageVerified: req.user!.ageVerified,
      accountStatus: req.user!.status,
      amountMinorUnits: req.body.amountMinorUnits,
      currency: req.body.currency,
      idempotencyKey: req.body.idempotencyKey,
    });
    res.status(201).json({ id: withdrawal.id, status: withdrawal.status, rejectionReason: withdrawal.rejectionReason, failureReason: withdrawal.failureReason });
  } catch (error) {
    next(error);
  }
});

creatorRouter.post('/creator/withdrawals/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const withdrawal = await cancelWithdrawal(req.params.id!, req.user!.id);
    res.status(200).json({ id: withdrawal.id, status: withdrawal.status });
  } catch (error) {
    next(error);
  }
});
