import { Router } from 'express';

import { calculateCoinPricing, getCurrentExchangeRate, serializeCoinPackage } from '@/lib/coinEconomy';
import { creditCoins } from '@/lib/coinLedger';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { getPaymentProvider } from '@/lib/paymentProviders';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { createCoinPurchaseSchema, listCoinHistoryQuerySchema, listCoinPurchasesQuerySchema, setDailyGiftLimitSchema, verifyCoinPurchaseSchema } from '@/schemas/coins.schema';
import { AppError } from '@/utils/AppError';

/**
 * Coins — balance, packages, purchase, and the two distinct history views
 * the brief calls out: "Transaction History" (`CoinPurchase` rows — real-
 * money purchases) vs "Coin History" (`CoinLedgerEntry` rows — every
 * balance-affecting event, purchases AND Gift spending together).
 */
export const coinsRouter = Router();

const purchaseLimiter = createAuthRateLimiter(60 * 1000, 20, 'coin-purchase');

coinsRouter.get('/coins/balance', requireAuth, async (req, res, next) => {
  try {
    const wallet = await prisma.coinWallet.findUnique({ where: { userId: req.user!.id } });
    res.status(200).json({
      balance: wallet?.balance ?? 0,
      dailyGiftLimitCoins: wallet?.dailyGiftLimitCoins ?? null,
    });
  } catch (error) {
    next(error);
  }
});

coinsRouter.patch('/coins/wallet/daily-limit', requireAuth, validate({ body: setDailyGiftLimitSchema }), async (req, res, next) => {
  try {
    const { dailyGiftLimitCoins } = req.body as { dailyGiftLimitCoins: number | null };
    const wallet = await prisma.coinWallet.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, dailyGiftLimitCoins },
      update: { dailyGiftLimitCoins },
    });
    res.status(200).json({ dailyGiftLimitCoins: wallet.dailyGiftLimitCoins });
  } catch (error) {
    next(error);
  }
});

/** Every package's Coin amount/total price is computed against the CURRENT rate at read time — never a stale stored value (see lib/coinEconomy.ts). */
coinsRouter.get('/coins/packages', requireAuth, async (_req, res, next) => {
  try {
    const [packages, rate] = await Promise.all([
      prisma.coinPackage.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      getCurrentExchangeRate(),
    ]);
    res.status(200).json({ packages: packages.map((pkg) => serializeCoinPackage(pkg, rate.pkrPerUsd)) });
  } catch (error) {
    next(error);
  }
});

/** Coin History — every balance-affecting event (purchases credited, Gifts spent, refund reversals, admin adjustments), oldest-independent immutable ledger rows. */
coinsRouter.get('/coins/history', requireAuth, validate({ query: listCoinHistoryQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const wallet = await prisma.coinWallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) {
      res.status(200).json({ history: [], nextCursor: null });
      return;
    }

    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const entries = await prisma.coinLedgerEntry.findMany({
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
        amount: e.amount,
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

/** Transaction History — real-money purchase attempts only (brief's explicit separation from Coin History above). */
coinsRouter.get('/coins/purchases', requireAuth, validate({ query: listCoinPurchasesQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const purchases = await prisma.coinPurchase.findMany({
      where: {
        userId: req.user!.id,
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = purchases.length > limit;
    const page = hasMore ? purchases.slice(0, limit) : purchases;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    res.status(200).json({
      purchases: page.map((p) => ({
        id: p.id,
        packageId: p.packageId,
        baseUsdPrice: p.baseUsdPrice.toFixed(2),
        taxUsd: p.taxUsd.toFixed(2),
        feeUsd: p.feeUsd.toFixed(2),
        totalUsdPrice: p.totalUsdPrice.toFixed(2),
        exchangeRatePkrPerUsd: p.exchangeRatePkrPerUsd.toFixed(4),
        coinValuePkr: p.coinValuePkr.toFixed(4),
        coinAmount: p.coinAmount,
        provider: p.provider,
        status: p.status,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
        creditedAt: p.creditedAt,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Step 1 of the purchase flow — creates a CREATED purchase with its own
 * permanent pricing snapshot (brief: "every purchase permanently freezes
 * the rate/coin-value/coin-amount used"). No Coins are credited yet; that
 * only happens once `/coins/purchases/:id/verify` confirms real payment.
 */
coinsRouter.post('/coins/purchases', requireAuth, purchaseLimiter, validate({ body: createCoinPurchaseSchema }), async (req, res, next) => {
  try {
    const { packageId, provider, idempotencyKey } = req.body as { packageId: string; provider: 'APP_STORE' | 'GOOGLE_PLAY' | 'WEB'; idempotencyKey: string };

    const existing = await prisma.coinPurchase.findUnique({ where: { idempotencyKey } });
    if (existing) {
      res.status(200).json({ purchaseId: existing.id, status: existing.status });
      return;
    }

    const pkg = await prisma.coinPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.active) throw new AppError('NOT_FOUND', 'Coin package not found');

    const rate = await getCurrentExchangeRate();
    const pricing = calculateCoinPricing(pkg, rate.pkrPerUsd);

    const purchase = await prisma.coinPurchase.create({
      data: {
        userId: req.user!.id,
        packageId: pkg.id,
        baseUsdPrice: pricing.baseUsdPrice,
        taxUsd: pricing.taxUsd,
        feeUsd: pricing.feeUsd,
        totalUsdPrice: pricing.totalUsdPrice,
        exchangeRatePkrPerUsd: pricing.exchangeRatePkrPerUsd,
        coinValuePkr: pricing.coinValuePkr,
        coinAmount: pricing.coinAmount,
        provider,
        status: 'CREATED',
        idempotencyKey,
      },
    });

    res.status(201).json({
      purchaseId: purchase.id,
      status: purchase.status,
      baseUsdPrice: purchase.baseUsdPrice.toFixed(2),
      taxUsd: purchase.taxUsd.toFixed(2),
      feeUsd: purchase.feeUsd.toFixed(2),
      totalUsdPrice: purchase.totalUsdPrice.toFixed(2),
      exchangeRatePkrPerUsd: purchase.exchangeRatePkrPerUsd.toFixed(4),
      coinAmount: purchase.coinAmount,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Step 2 — verifies the provider receipt for a purchase this user created,
 * and ONLY on genuine verification success moves CREATED → PAID →
 * COINS_CREDITED, crediting the wallet via the idempotent ledger helper.
 * Never trusts a client-reported "payment succeeded" flag (brief §4/§B).
 */
coinsRouter.post('/coins/purchases/:id/verify', requireAuth, purchaseLimiter, validate({ body: verifyCoinPurchaseSchema }), async (req, res, next) => {
  try {
    const purchase = await prisma.coinPurchase.findUnique({ where: { id: req.params.id! } });
    if (!purchase || purchase.userId !== req.user!.id) throw new AppError('NOT_FOUND', 'Purchase not found');

    if (purchase.status === 'COINS_CREDITED') {
      const wallet = await prisma.coinWallet.findUnique({ where: { userId: req.user!.id } });
      res.status(200).json({ status: purchase.status, coinAmount: purchase.coinAmount, balance: wallet?.balance ?? 0 });
      return;
    }
    if (purchase.status !== 'CREATED' && purchase.status !== 'PENDING') {
      throw new AppError('CONFLICT', `Purchase is ${purchase.status} and cannot be verified again`);
    }

    const provider = getPaymentProvider(purchase.provider);
    const result = await provider.verifyPurchase(req.body.receipt);
    if (!result.verified) {
      await prisma.coinPurchase.update({ where: { id: purchase.id }, data: { status: 'FAILED' } });
      throw new AppError('BAD_REQUEST', result.reason ?? 'Payment could not be verified');
    }

    let paidPurchase;
    try {
      paidPurchase = await prisma.coinPurchase.update({
        where: { id: purchase.id },
        data: { status: 'PAID', providerTransactionId: result.providerTransactionId, paidAt: new Date() },
      });
    } catch (error) {
      // providerTransactionId is unique — the same real-world payment being
      // verified twice (a retried client call) lands here, not as a new credit.
      const errCode = (error as { code?: string }).code;
      if (errCode === 'P2002') {
        const already = await prisma.coinPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
        const wallet = await prisma.coinWallet.findUnique({ where: { userId: req.user!.id } });
        res.status(200).json({ status: already.status, coinAmount: already.coinAmount, balance: wallet?.balance ?? 0 });
        return;
      }
      throw error;
    }

    const { wallet } = await creditCoins({
      userId: req.user!.id,
      amount: paidPurchase.coinAmount,
      type: 'PURCHASE',
      referenceType: 'COIN_PURCHASE',
      referenceId: paidPurchase.id,
      idempotencyKey: `purchase:${paidPurchase.id}`,
    });

    await prisma.coinPurchase.update({ where: { id: paidPurchase.id }, data: { status: 'COINS_CREDITED', creditedAt: new Date() } });

    res.status(200).json({ status: 'COINS_CREDITED', coinAmount: paidPurchase.coinAmount, balance: wallet.balance });
  } catch (error) {
    next(error);
  }
});
