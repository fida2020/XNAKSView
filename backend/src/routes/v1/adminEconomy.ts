import { Router } from 'express';

import { debitDiamondsForAdjustment } from '@/lib/diamondLedger';
import { calculateEarningsMinorUnits, creditEarnings, getCurrentDiamondRewardRate } from '@/lib/earningsLedger';
import { recordFinancialAudit } from '@/lib/financialAudit';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { getAllIdentityVerificationProviders } from '@/lib/payout/identityVerificationProvider';
import { getAllPayoutProviders } from '@/lib/payout/payoutProvider';
import { prisma } from '@/lib/prisma';
import { approveWithdrawal, failWithdrawal, markPaid, markProcessing, markReviewing, rejectWithdrawal } from '@/lib/withdrawalService';
import { requireAuth } from '@/middleware/auth';
import { requireAdmin } from '@/middleware/requireAdmin';
import { validate } from '@/middleware/validate';
import {
  createCoinPackageSchema,
  createExchangeRateSchema,
  updateCoinPackageSchema,
} from '@/schemas/coins.schema';
import {
  adminListAuditLogsQuerySchema,
  adminListQuerySchema,
  adminListWithdrawalsQuerySchema,
  adminMarkProcessingSchema,
  convertDiamondsToEarningsSchema,
  createDiamondEarnRateSchema,
  createDiamondRewardRateSchema,
  createFraudHoldSchema,
  createGiftSchema,
  createPlatformRevenueRuleSchema,
  updateGiftSchema,
  withdrawalReviewActionSchema,
} from '@/schemas/gifts.schema';
import { createCountryPayoutCapabilitySchema, updateCountryPayoutCapabilitySchema } from '@/schemas/payoutMethod.schema';
import { AppError } from '@/utils/AppError';

/**
 * Admin management of the entire Step 7 virtual economy — Coin
 * packages/rate, Gift catalog, Diamond/reward/platform-revenue rules,
 * withdrawal review, fraud holds, and financial audit inspection. Every
 * mutation here either inserts a brand-new versioned/effective-dated row
 * (rates, rules — never edits an old one, so historical transactions never
 * change retroactively) or records a `FinancialAuditLog` entry alongside
 * the change (brief §20: "admin corrections create adjustment records").
 */
export const adminEconomyRouter = Router();

adminEconomyRouter.use(requireAuth, requireAdmin);

// -----------------------------------------------------------------------
// Exchange rate (PKR/USD) — append-only, "most recent row is current".
// -----------------------------------------------------------------------

adminEconomyRouter.get('/admin/exchange-rate', async (_req, res, next) => {
  try {
    const rate = await prisma.exchangeRate.findFirst({ orderBy: { createdAt: 'desc' } });
    res.status(200).json({ rate: rate ? { id: rate.id, pkrPerUsd: rate.pkrPerUsd.toFixed(4), createdAt: rate.createdAt } : null });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/exchange-rate', validate({ body: createExchangeRateSchema }), async (req, res, next) => {
  try {
    const rate = await prisma.exchangeRate.create({ data: { pkrPerUsd: req.body.pkrPerUsd, createdById: req.user!.id } });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'EXCHANGE_RATE_CREATED', entityType: 'ExchangeRate', entityId: rate.id, metadata: { pkrPerUsd: rate.pkrPerUsd.toString() } });
    res.status(201).json({ id: rate.id, pkrPerUsd: rate.pkrPerUsd.toFixed(4), createdAt: rate.createdAt });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Coin packages — mutable rows (price tiers), but never store a derived
// Coin amount/total on them (see lib/coinEconomy.ts).
// -----------------------------------------------------------------------

adminEconomyRouter.get('/admin/coin-packages', async (_req, res, next) => {
  try {
    const packages = await prisma.coinPackage.findMany({ orderBy: { sortOrder: 'asc' } });
    res.status(200).json({
      packages: packages.map((p) => ({ id: p.id, baseUsdPrice: p.baseUsdPrice.toFixed(2), taxUsd: p.taxUsd.toFixed(2), feeUsd: p.feeUsd.toFixed(2), active: p.active, sortOrder: p.sortOrder })),
    });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/coin-packages', validate({ body: createCoinPackageSchema }), async (req, res, next) => {
  try {
    const pkg = await prisma.coinPackage.create({ data: req.body });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'COIN_PACKAGE_CREATED', entityType: 'CoinPackage', entityId: pkg.id, metadata: req.body });
    res.status(201).json({ id: pkg.id });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.patch('/admin/coin-packages/:id', validate({ body: updateCoinPackageSchema }), async (req, res, next) => {
  try {
    const pkg = await prisma.coinPackage.update({ where: { id: req.params.id! }, data: req.body }).catch(() => null);
    if (!pkg) throw new AppError('NOT_FOUND', 'Coin package not found');
    await recordFinancialAudit({ actorId: req.user!.id, action: 'COIN_PACKAGE_UPDATED', entityType: 'CoinPackage', entityId: pkg.id, metadata: req.body });
    res.status(200).json({ id: pkg.id });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Gift catalog
// -----------------------------------------------------------------------

adminEconomyRouter.get('/admin/gifts', async (_req, res, next) => {
  try {
    const gifts = await prisma.gift.findMany({ orderBy: { sortOrder: 'asc' } });
    res.status(200).json({ gifts });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/gifts', validate({ body: createGiftSchema }), async (req, res, next) => {
  try {
    const gift = await prisma.gift.create({ data: req.body });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'GIFT_CREATED', entityType: 'Gift', entityId: gift.id, metadata: req.body });
    res.status(201).json({ id: gift.id });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.patch('/admin/gifts/:id', validate({ body: updateGiftSchema }), async (req, res, next) => {
  try {
    const gift = await prisma.gift.update({ where: { id: req.params.id! }, data: req.body }).catch(() => null);
    if (!gift) throw new AppError('NOT_FOUND', 'Gift not found');
    await recordFinancialAudit({ actorId: req.user!.id, action: 'GIFT_UPDATED', entityType: 'Gift', entityId: gift.id, metadata: req.body });
    res.status(200).json({ id: gift.id });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Diamond earn rate / Diamond reward rate / Platform revenue rule — all
// append-only or effective-dated, never edited in place.
// -----------------------------------------------------------------------

adminEconomyRouter.get('/admin/diamond-earn-rate', async (_req, res, next) => {
  try {
    const rate = await prisma.diamondEarnRate.findFirst({ orderBy: { createdAt: 'desc' } });
    res.status(200).json({ rate: rate ? { id: rate.id, coinsPerDiamond: rate.coinsPerDiamond.toFixed(4), createdAt: rate.createdAt } : null });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/diamond-earn-rate', validate({ body: createDiamondEarnRateSchema }), async (req, res, next) => {
  try {
    const rate = await prisma.diamondEarnRate.create({ data: { coinsPerDiamond: req.body.coinsPerDiamond, createdById: req.user!.id } });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'DIAMOND_EARN_RATE_CREATED', entityType: 'DiamondEarnRate', entityId: rate.id, metadata: { coinsPerDiamond: rate.coinsPerDiamond.toString() } });
    res.status(201).json({ id: rate.id });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.get('/admin/diamond-reward-rates', async (_req, res, next) => {
  try {
    const rates = await prisma.diamondRewardRate.findMany({ orderBy: { effectiveFrom: 'desc' } });
    res.status(200).json({ rates });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/diamond-reward-rates', validate({ body: createDiamondRewardRateSchema }), async (req, res, next) => {
  try {
    const rate = await prisma.diamondRewardRate.create({ data: { ...req.body, createdById: req.user!.id } });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'DIAMOND_REWARD_RATE_CREATED', entityType: 'DiamondRewardRate', entityId: rate.id, metadata: req.body });
    res.status(201).json({ id: rate.id });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.get('/admin/platform-revenue-rules', async (_req, res, next) => {
  try {
    const rules = await prisma.platformRevenueRule.findMany({ orderBy: { effectiveFrom: 'desc' } });
    res.status(200).json({ rules });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/platform-revenue-rules', validate({ body: createPlatformRevenueRuleSchema }), async (req, res, next) => {
  try {
    const rule = await prisma.platformRevenueRule.create({ data: { ...req.body, createdById: req.user!.id } });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'PLATFORM_REVENUE_RULE_CREATED', entityType: 'PlatformRevenueRule', entityId: rule.id, metadata: req.body });
    res.status(201).json({ id: rule.id });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Inspection — Coin purchases, Gift transactions, per-creator Diamond/
// earnings balances.
// -----------------------------------------------------------------------

adminEconomyRouter.get('/admin/coin-purchases', validate({ query: adminListQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const purchases = await prisma.coinPurchase.findMany({
      where: decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = purchases.length > limit;
    const page = hasMore ? purchases.slice(0, limit) : purchases;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    res.status(200).json({ purchases: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.get('/admin/gift-transactions', validate({ query: adminListQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const transactions = await prisma.giftTransaction.findMany({
      where: decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {},
      include: { platformRevenueEntry: true, liveAttributionEntry: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = transactions.length > limit;
    const page = hasMore ? transactions.slice(0, limit) : transactions;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    res.status(200).json({ transactions: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.get('/admin/creators/:id/diamonds', async (req, res, next) => {
  try {
    const wallet = await prisma.creatorDiamondWallet.findUnique({ where: { creatorId: req.params.id! } });
    res.status(200).json({ balance: wallet?.balance ?? 0 });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.get('/admin/creators/:id/earnings', async (req, res, next) => {
  try {
    const wallet = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: req.params.id! } });
    res.status(200).json({ balanceMinorUnits: wallet?.balanceMinorUnits ?? 0, currency: wallet?.currency ?? 'USD' });
  } catch (error) {
    next(error);
  }
});

/**
 * Diamond → Earnings is deliberately never automatic or creator-triggered
 * (brief §11/§24: "creator must never control this conversion from the
 * client") — an admin (or, later, a scheduled batch job calling these same
 * lib functions) converts a specific Diamond amount into the creator's
 * cash-equivalent earnings balance using the currently-active
 * `DiamondRewardRate`, debiting Diamonds and crediting Earnings atomically
 * enough that a retried request (same idempotencyKey) never double-applies.
 */
adminEconomyRouter.post('/admin/creators/:id/diamonds/convert', validate({ body: convertDiamondsToEarningsSchema }), async (req, res, next) => {
  try {
    const creatorId = req.params.id!;
    const { diamonds, idempotencyKey } = req.body as { diamonds: number; idempotencyKey: string };

    const rate = await getCurrentDiamondRewardRate();

    // Compute earnings from the amount ACTUALLY debited, never the raw
    // request — `debitDiamondsForAdjustment` caps the debit at the
    // creator's real balance, and crediting earnings off the requested
    // figure instead would invent USD out of nothing if the two ever diverge.
    const { entry: diamondDebit } = await debitDiamondsForAdjustment({ creatorId, diamonds, idempotencyKey: `${idempotencyKey}:diamond-debit`, notes: `Converted to ${rate.rewardCurrency} earnings by admin` });
    const amountMinorUnits = calculateEarningsMinorUnits(diamondDebit.diamonds, rate);

    const { wallet } = await creditEarnings({
      creatorId,
      amountMinorUnits,
      currency: rate.rewardCurrency,
      type: 'DIAMOND_REWARD',
      referenceType: 'DIAMOND_CONVERSION',
      referenceId: idempotencyKey,
      idempotencyKey: `${idempotencyKey}:earnings-credit`,
    });

    await recordFinancialAudit({ actorId: req.user!.id, action: 'DIAMONDS_CONVERTED_TO_EARNINGS', entityType: 'CreatorEarningsWallet', entityId: wallet.id, metadata: { creatorId, requestedDiamonds: diamonds, diamondsConverted: diamondDebit.diamonds, amountMinorUnits, currency: rate.rewardCurrency, rateId: rate.id } });

    res.status(200).json({ diamondsConverted: diamondDebit.diamonds, amountMinorUnits, currency: rate.rewardCurrency, earningsBalance: wallet.balanceMinorUnits });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Withdrawal review — Step 9: this is now an EXCEPTION-HANDLING override,
// not the normal path. Every routine withdrawal is driven automatically by
// `lib/withdrawalOrchestrator.ts` from `POST /creator/withdrawals` —
// REQUESTED → APPROVED → PROCESSING → PAID/FAILED with no admin in the
// loop. These endpoints stay only for a genuinely exceptional case: a
// disputed automatic fraud hold, a withdrawal stuck in PROCESSING because
// a provider webhook never arrived, or a manual compliance decision.
// -----------------------------------------------------------------------

adminEconomyRouter.get('/admin/withdrawals', validate({ query: adminListWithdrawalsQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const withdrawals = await prisma.withdrawal.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = withdrawals.length > limit;
    const page = hasMore ? withdrawals.slice(0, limit) : withdrawals;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    res.status(200).json({ withdrawals: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/withdrawals/:id/review', async (req, res, next) => {
  try {
    const withdrawal = await markReviewing(req.params.id!);
    await recordFinancialAudit({ actorId: req.user!.id, action: 'WITHDRAWAL_REVIEWING', entityType: 'Withdrawal', entityId: withdrawal.id });
    res.status(200).json({ id: withdrawal.id, status: withdrawal.status });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/withdrawals/:id/approve', async (req, res, next) => {
  try {
    const withdrawal = await approveWithdrawal(req.params.id!, req.user!.id);
    await recordFinancialAudit({ actorId: req.user!.id, action: 'WITHDRAWAL_APPROVED', entityType: 'Withdrawal', entityId: withdrawal.id });
    res.status(200).json({ id: withdrawal.id, status: withdrawal.status });
  } catch (error) {
    next(error);
  }
});

/** Manual override only — a real `providerPayoutId` must already exist (e.g. copied from the provider's own dashboard while investigating a stuck row); this never fabricates one. */
adminEconomyRouter.post('/admin/withdrawals/:id/processing', validate({ body: adminMarkProcessingSchema }), async (req, res, next) => {
  try {
    const withdrawal = await markProcessing(req.params.id!, req.body.providerPayoutId, req.body.providerStatus ?? 'MANUAL_OVERRIDE');
    await recordFinancialAudit({ actorId: req.user!.id, action: 'WITHDRAWAL_PROCESSING_MANUAL_OVERRIDE', entityType: 'Withdrawal', entityId: withdrawal.id });
    res.status(200).json({ id: withdrawal.id, status: withdrawal.status });
  } catch (error) {
    next(error);
  }
});

/** Manual override only — used when an admin has independently confirmed payment with the provider (e.g. a missed webhook), never a routine step. */
adminEconomyRouter.post('/admin/withdrawals/:id/paid', async (req, res, next) => {
  try {
    const withdrawal = await markPaid(req.params.id!);
    await recordFinancialAudit({ actorId: req.user!.id, action: 'WITHDRAWAL_PAID_MANUAL_OVERRIDE', entityType: 'Withdrawal', entityId: withdrawal.id });
    res.status(200).json({ id: withdrawal.id, status: withdrawal.status });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/withdrawals/:id/reject', validate({ body: withdrawalReviewActionSchema }), async (req, res, next) => {
  try {
    const withdrawal = await rejectWithdrawal(req.params.id!, req.body.reason ?? 'Rejected by admin');
    await recordFinancialAudit({ actorId: req.user!.id, action: 'WITHDRAWAL_REJECTED', entityType: 'Withdrawal', entityId: withdrawal.id, metadata: { reason: req.body.reason } });
    res.status(200).json({ id: withdrawal.id, status: withdrawal.status });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/withdrawals/:id/fail', validate({ body: withdrawalReviewActionSchema }), async (req, res, next) => {
  try {
    const withdrawal = await failWithdrawal(req.params.id!, req.body.reason ?? 'Marked failed by admin');
    await recordFinancialAudit({ actorId: req.user!.id, action: 'WITHDRAWAL_FAILED', entityType: 'Withdrawal', entityId: withdrawal.id, metadata: { reason: req.body.reason } });
    res.status(200).json({ id: withdrawal.id, status: withdrawal.status });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Fraud holds
// -----------------------------------------------------------------------

adminEconomyRouter.post('/admin/fraud-holds', validate({ body: createFraudHoldSchema }), async (req, res, next) => {
  try {
    const hold = await prisma.fraudHold.create({ data: { userId: req.body.userId, reason: req.body.reason, createdById: req.user!.id } });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'FRAUD_HOLD_CREATED', entityType: 'FraudHold', entityId: hold.id, metadata: { userId: req.body.userId, reason: req.body.reason } });
    res.status(201).json({ id: hold.id });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/fraud-holds/:id/release', async (req, res, next) => {
  try {
    const hold = await prisma.fraudHold
      .update({ where: { id: req.params.id! }, data: { status: 'RELEASED', releasedById: req.user!.id, releasedAt: new Date() } })
      .catch(() => null);
    if (!hold) throw new AppError('NOT_FOUND', 'Fraud hold not found');
    await recordFinancialAudit({ actorId: req.user!.id, action: 'FRAUD_HOLD_RELEASED', entityType: 'FraudHold', entityId: hold.id });
    res.status(200).json({ id: hold.id, status: hold.status });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Financial audit log inspection
// -----------------------------------------------------------------------

adminEconomyRouter.get('/admin/financial-audit-logs', validate({ query: adminListAuditLogsQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit, entityType, entityId } = req.query as unknown as { cursor?: string; limit: number; entityType?: string; entityId?: string };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const logs = await prisma.financialAuditLog.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = logs.length > limit;
    const page = hasMore ? logs.slice(0, limit) : logs;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    res.status(200).json({ logs: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Step 9 — Country payout capability (admin-configurable per-country
// enable/limits/fees/provider-priority), and read-only compliance
// visibility into payout methods / identity verifications. No approve
// action on either list — a creator's payout method / identity are
// verified automatically by the real provider, never by an admin click.
// -----------------------------------------------------------------------

adminEconomyRouter.get('/admin/payout-capabilities', async (_req, res, next) => {
  try {
    const capabilities = await prisma.countryPayoutCapability.findMany({ orderBy: { countryCode: 'asc' } });
    res.status(200).json({ capabilities });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.post('/admin/payout-capabilities', validate({ body: createCountryPayoutCapabilitySchema }), async (req, res, next) => {
  try {
    const capability = await prisma.countryPayoutCapability.create({ data: req.body });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'COUNTRY_PAYOUT_CAPABILITY_CREATED', entityType: 'CountryPayoutCapability', entityId: capability.id, metadata: req.body });
    res.status(201).json({ id: capability.id });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.patch('/admin/payout-capabilities/:countryCode', validate({ body: updateCountryPayoutCapabilitySchema }), async (req, res, next) => {
  try {
    const capability = await prisma.countryPayoutCapability.update({ where: { countryCode: req.params.countryCode!.toUpperCase() }, data: req.body });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'COUNTRY_PAYOUT_CAPABILITY_UPDATED', entityType: 'CountryPayoutCapability', entityId: capability.id, metadata: req.body });
    res.status(200).json({ id: capability.id });
  } catch (error) {
    next(error);
  }
});

/** Real-config-vs-approval status for every provider that exists in code — `configured` is a live check; `approvalStatus` is a disclosed constant, never a runtime claim of vendor approval (see the Step 9 completion report). */
adminEconomyRouter.get('/admin/payout-providers/status', async (_req, res, next) => {
  try {
    const payout = getAllPayoutProviders().map((p) => ({ name: p.name, configured: p.isConfigured(), approvalStatus: 'REQUIRES_APPROVAL' as const }));
    const kyc = getAllIdentityVerificationProviders().map((p) => ({ name: p.name, configured: p.isConfigured(), approvalStatus: 'REQUIRES_APPROVAL' as const }));
    res.status(200).json({ payoutProviders: payout, identityVerificationProviders: kyc });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.get('/admin/payout-methods', validate({ query: adminListQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');
    const methods = await prisma.creatorPayoutMethod.findMany({
      where: decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = methods.length > limit;
    const page = hasMore ? methods.slice(0, limit) : methods;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    res.status(200).json({ payoutMethods: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminEconomyRouter.get('/admin/identity-verifications', validate({ query: adminListQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');
    const verifications = await prisma.verification.findMany({
      where: { verificationType: 'IDENTITY_DOCUMENT', ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = verifications.length > limit;
    const page = hasMore ? verifications.slice(0, limit) : verifications;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    res.status(200).json({ identityVerifications: page, nextCursor });
  } catch (error) {
    next(error);
  }
});
