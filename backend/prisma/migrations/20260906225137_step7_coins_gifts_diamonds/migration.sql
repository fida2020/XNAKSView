-- CreateEnum
CREATE TYPE "PaymentProviderType" AS ENUM ('APP_STORE', 'GOOGLE_PLAY', 'WEB');

-- CreateEnum
CREATE TYPE "CoinPurchaseStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'COINS_CREDITED', 'FAILED', 'CANCELLED', 'REFUNDED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "CoinLedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "CoinLedgerEntryType" AS ENUM ('PURCHASE', 'GIFT_SENT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "GiftCategory" AS ENUM ('APPRECIATION', 'PREMIUM', 'CELEBRATION', 'LIVE', 'SPECIAL');

-- CreateEnum
CREATE TYPE "GiftContentType" AS ENUM ('LIVE', 'VIDEO', 'PHOTO_POST', 'TEXT_POST');

-- CreateEnum
CREATE TYPE "LiveGiftParticipantRole" AS ENUM ('HOST', 'CO_HOST', 'GUEST');

-- CreateEnum
CREATE TYPE "DiamondLedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "DiamondSourceType" AS ENUM ('LIVE_GIFT', 'VIDEO_GIFT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "EarningsLedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "EarningsLedgerEntryType" AS ENUM ('DIAMOND_REWARD', 'WITHDRAWAL_HOLD', 'WITHDRAWAL_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'REVIEWING', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutProviderType" AS ENUM ('BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA');

-- CreateEnum
CREATE TYPE "FraudHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "allowGifts" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "pkrPerUsd" DECIMAL(10,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_packages" (
    "id" TEXT NOT NULL,
    "baseUsdPrice" DECIMAL(10,2) NOT NULL,
    "taxUsd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "feeUsd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coin_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "dailyGiftLimitCoins" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coin_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_ledger_entries" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "direction" "CoinLedgerDirection" NOT NULL,
    "type" "CoinLedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "beforeBalance" INTEGER NOT NULL,
    "afterBalance" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_purchases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "baseUsdPrice" DECIMAL(10,2) NOT NULL,
    "taxUsd" DECIMAL(10,2) NOT NULL,
    "feeUsd" DECIMAL(10,2) NOT NULL,
    "totalUsdPrice" DECIMAL(10,2) NOT NULL,
    "exchangeRatePkrPerUsd" DECIMAL(10,4) NOT NULL,
    "coinValuePkr" DECIMAL(10,4) NOT NULL DEFAULT 1.50,
    "coinAmount" INTEGER NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "providerTransactionId" TEXT,
    "status" "CoinPurchaseStatus" NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),

    CONSTRAINT "coin_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gifts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "coinCost" INTEGER NOT NULL,
    "thumbnailKey" TEXT,
    "animationAssetKey" TEXT,
    "category" "GiftCategory" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxQuantityPerSend" INTEGER NOT NULL DEFAULT 99,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_transactions" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "coinCost" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalCoins" INTEGER NOT NULL,
    "contentType" "GiftContentType",
    "contentId" TEXT,
    "liveSessionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_gift_attribution_entries" (
    "id" TEXT NOT NULL,
    "giftTransactionId" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "attributedParticipantId" TEXT NOT NULL,
    "participantRole" "LiveGiftParticipantRole" NOT NULL,
    "liveGuestSlotId" TEXT,
    "liveMatchId" TEXT,
    "matchSide" TEXT,
    "scoreContribution" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_gift_attribution_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_revenue_rules" (
    "id" TEXT NOT NULL,
    "platformSharePercent" DECIMAL(5,2) NOT NULL,
    "creatorRewardDescription" TEXT,
    "applicableContext" TEXT NOT NULL DEFAULT 'GIFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "platform_revenue_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_revenue_ledger_entries" (
    "id" TEXT NOT NULL,
    "giftTransactionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "totalCoins" INTEGER NOT NULL,
    "platformShareCoins" INTEGER NOT NULL,
    "creatorShareCoins" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_revenue_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_diamond_wallets" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_diamond_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_diamond_ledger_entries" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "direction" "DiamondLedgerDirection" NOT NULL,
    "sourceType" "DiamondSourceType" NOT NULL,
    "giftTransactionId" TEXT,
    "diamonds" INTEGER NOT NULL,
    "beforeBalance" INTEGER NOT NULL,
    "afterBalance" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_diamond_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diamond_earn_rates" (
    "id" TEXT NOT NULL,
    "coinsPerDiamond" DECIMAL(10,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "diamond_earn_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diamond_reward_rates" (
    "id" TEXT NOT NULL,
    "diamondsRequired" INTEGER NOT NULL,
    "rewardCurrency" TEXT NOT NULL,
    "rewardAmount" DECIMAL(12,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "diamond_reward_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_earnings_wallets" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "balanceMinorUnits" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_earnings_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_earnings_ledger_entries" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "direction" "EarningsLedgerDirection" NOT NULL,
    "type" "EarningsLedgerEntryType" NOT NULL,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "beforeBalance" INTEGER NOT NULL,
    "afterBalance" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_earnings_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "earningsWalletId" TEXT NOT NULL,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" "PayoutProviderType" NOT NULL,
    "destinationReference" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" TEXT NOT NULL,
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_holds" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "FraudHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "fraud_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchange_rates_createdAt_idx" ON "exchange_rates"("createdAt");

-- CreateIndex
CREATE INDEX "coin_packages_active_sortOrder_idx" ON "coin_packages"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "coin_wallets_userId_key" ON "coin_wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "coin_ledger_entries_idempotencyKey_key" ON "coin_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "coin_ledger_entries_walletId_createdAt_idx" ON "coin_ledger_entries"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "coin_ledger_entries_referenceType_referenceId_idx" ON "coin_ledger_entries"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "coin_purchases_providerTransactionId_key" ON "coin_purchases"("providerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "coin_purchases_idempotencyKey_key" ON "coin_purchases"("idempotencyKey");

-- CreateIndex
CREATE INDEX "coin_purchases_userId_createdAt_idx" ON "coin_purchases"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "coin_purchases_status_idx" ON "coin_purchases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "gifts_slug_key" ON "gifts"("slug");

-- CreateIndex
CREATE INDEX "gifts_active_sortOrder_idx" ON "gifts"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "gift_transactions_idempotencyKey_key" ON "gift_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "gift_transactions_senderId_createdAt_idx" ON "gift_transactions"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "gift_transactions_recipientId_createdAt_idx" ON "gift_transactions"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "gift_transactions_liveSessionId_idx" ON "gift_transactions"("liveSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "live_gift_attribution_entries_giftTransactionId_key" ON "live_gift_attribution_entries"("giftTransactionId");

-- CreateIndex
CREATE INDEX "live_gift_attribution_entries_liveSessionId_createdAt_idx" ON "live_gift_attribution_entries"("liveSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "live_gift_attribution_entries_liveMatchId_idx" ON "live_gift_attribution_entries"("liveMatchId");

-- CreateIndex
CREATE INDEX "platform_revenue_rules_active_effectiveFrom_idx" ON "platform_revenue_rules"("active", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "platform_revenue_ledger_entries_giftTransactionId_key" ON "platform_revenue_ledger_entries"("giftTransactionId");

-- CreateIndex
CREATE INDEX "platform_revenue_ledger_entries_createdAt_idx" ON "platform_revenue_ledger_entries"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "creator_diamond_wallets_creatorId_key" ON "creator_diamond_wallets"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_diamond_ledger_entries_giftTransactionId_key" ON "creator_diamond_ledger_entries"("giftTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_diamond_ledger_entries_idempotencyKey_key" ON "creator_diamond_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "creator_diamond_ledger_entries_walletId_createdAt_idx" ON "creator_diamond_ledger_entries"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "diamond_earn_rates_createdAt_idx" ON "diamond_earn_rates"("createdAt");

-- CreateIndex
CREATE INDEX "diamond_reward_rates_active_effectiveFrom_idx" ON "diamond_reward_rates"("active", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "creator_earnings_wallets_creatorId_key" ON "creator_earnings_wallets"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_earnings_ledger_entries_idempotencyKey_key" ON "creator_earnings_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "creator_earnings_ledger_entries_walletId_createdAt_idx" ON "creator_earnings_ledger_entries"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "creator_earnings_ledger_entries_referenceType_referenceId_idx" ON "creator_earnings_ledger_entries"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_idempotencyKey_key" ON "withdrawals"("idempotencyKey");

-- CreateIndex
CREATE INDEX "withdrawals_creatorId_createdAt_idx" ON "withdrawals"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");

-- CreateIndex
CREATE INDEX "fraud_holds_userId_status_idx" ON "fraud_holds"("userId", "status");

-- CreateIndex
CREATE INDEX "financial_audit_logs_entityType_entityId_idx" ON "financial_audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "financial_audit_logs_actorId_createdAt_idx" ON "financial_audit_logs"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_wallets" ADD CONSTRAINT "coin_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_ledger_entries" ADD CONSTRAINT "coin_ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "coin_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_purchases" ADD CONSTRAINT "coin_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_purchases" ADD CONSTRAINT "coin_purchases_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "coin_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_gift_attribution_entries" ADD CONSTRAINT "live_gift_attribution_entries_giftTransactionId_fkey" FOREIGN KEY ("giftTransactionId") REFERENCES "gift_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_gift_attribution_entries" ADD CONSTRAINT "live_gift_attribution_entries_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_gift_attribution_entries" ADD CONSTRAINT "live_gift_attribution_entries_liveGuestSlotId_fkey" FOREIGN KEY ("liveGuestSlotId") REFERENCES "live_guest_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_gift_attribution_entries" ADD CONSTRAINT "live_gift_attribution_entries_liveMatchId_fkey" FOREIGN KEY ("liveMatchId") REFERENCES "live_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_revenue_rules" ADD CONSTRAINT "platform_revenue_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_revenue_ledger_entries" ADD CONSTRAINT "platform_revenue_ledger_entries_giftTransactionId_fkey" FOREIGN KEY ("giftTransactionId") REFERENCES "gift_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_revenue_ledger_entries" ADD CONSTRAINT "platform_revenue_ledger_entries_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "platform_revenue_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_diamond_wallets" ADD CONSTRAINT "creator_diamond_wallets_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_diamond_ledger_entries" ADD CONSTRAINT "creator_diamond_ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "creator_diamond_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_diamond_ledger_entries" ADD CONSTRAINT "creator_diamond_ledger_entries_giftTransactionId_fkey" FOREIGN KEY ("giftTransactionId") REFERENCES "gift_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diamond_earn_rates" ADD CONSTRAINT "diamond_earn_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diamond_reward_rates" ADD CONSTRAINT "diamond_reward_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_earnings_wallets" ADD CONSTRAINT "creator_earnings_wallets_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_earnings_ledger_entries" ADD CONSTRAINT "creator_earnings_ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "creator_earnings_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_earningsWalletId_fkey" FOREIGN KEY ("earningsWalletId") REFERENCES "creator_earnings_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_holds" ADD CONSTRAINT "fraud_holds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_holds" ADD CONSTRAINT "fraud_holds_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_holds" ADD CONSTRAINT "fraud_holds_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_audit_logs" ADD CONSTRAINT "financial_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

