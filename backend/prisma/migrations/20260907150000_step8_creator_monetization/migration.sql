-- CreateEnum
CREATE TYPE "MonetizationStatus" AS ENUM ('NOT_ELIGIBLE', 'ELIGIBLE', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AdRevenueEventType" AS ENUM ('REVENUE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "AdRevenueEventStatus" AS ENUM ('CONFIRMED', 'INVALID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EarningsLedgerEntryType" ADD VALUE 'AD_REVENUE';
ALTER TYPE "EarningsLedgerEntryType" ADD VALUE 'AD_REVENUE_REVERSAL';

-- CreateTable
CREATE TABLE "monetization_eligibility_rules" (
    "id" TEXT NOT NULL,
    "minFollowers" INTEGER NOT NULL DEFAULT 0,
    "minLifetimeVideoViews" INTEGER NOT NULL DEFAULT 0,
    "minAccountAgeDays" INTEGER NOT NULL DEFAULT 0,
    "requireGoodStanding" BOOLEAN NOT NULL DEFAULT true,
    "allowedRegions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "monetization_eligibility_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_revenue_share_rules" (
    "id" TEXT NOT NULL,
    "creatorSharePercent" DECIMAL(5,2) NOT NULL,
    "platformSharePercent" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ad_revenue_share_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_monetizations" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "status" "MonetizationStatus" NOT NULL DEFAULT 'NOT_ELIGIBLE',
    "activatedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusUpdatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_monetizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_revenue_events" (
    "id" TEXT NOT NULL,
    "type" "AdRevenueEventType" NOT NULL DEFAULT 'REVENUE',
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "validImpressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER,
    "grossRevenueMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "AdRevenueEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "monetizationStatusAtEvent" "MonetizationStatus" NOT NULL,
    "wasMonetizationActive" BOOLEAN NOT NULL,
    "revenueShareRuleId" TEXT,
    "creatorSharePercentSnapshot" DECIMAL(5,2),
    "platformSharePercentSnapshot" DECIMAL(5,2),
    "creatorShareMinorUnits" INTEGER NOT NULL DEFAULT 0,
    "platformShareMinorUnits" INTEGER NOT NULL DEFAULT 0,
    "reversalOfEventId" TEXT,
    "earningsLedgerEntryId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_revenue_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monetization_eligibility_rules_active_effectiveFrom_idx" ON "monetization_eligibility_rules"("active", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ad_revenue_share_rules_active_effectiveFrom_idx" ON "ad_revenue_share_rules"("active", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "creator_monetizations_creatorId_key" ON "creator_monetizations"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_revenue_events_idempotencyKey_key" ON "ad_revenue_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ad_revenue_events_creatorId_createdAt_idx" ON "ad_revenue_events"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "ad_revenue_events_videoId_createdAt_idx" ON "ad_revenue_events"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "ad_revenue_events_status_idx" ON "ad_revenue_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ad_revenue_events_provider_providerEventId_key" ON "ad_revenue_events"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "monetization_eligibility_rules" ADD CONSTRAINT "monetization_eligibility_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_revenue_share_rules" ADD CONSTRAINT "ad_revenue_share_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_monetizations" ADD CONSTRAINT "creator_monetizations_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_monetizations" ADD CONSTRAINT "creator_monetizations_statusUpdatedById_fkey" FOREIGN KEY ("statusUpdatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_revenue_events" ADD CONSTRAINT "ad_revenue_events_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_revenue_events" ADD CONSTRAINT "ad_revenue_events_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_revenue_events" ADD CONSTRAINT "ad_revenue_events_revenueShareRuleId_fkey" FOREIGN KEY ("revenueShareRuleId") REFERENCES "ad_revenue_share_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_revenue_events" ADD CONSTRAINT "ad_revenue_events_reversalOfEventId_fkey" FOREIGN KEY ("reversalOfEventId") REFERENCES "ad_revenue_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

