-- Step 9 — Automated global creator withdrawal & payout system.

-- CreateEnum
CREATE TYPE "PayoutMethodStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'DISABLED');

-- AlterEnum
ALTER TYPE "PayoutProviderType" ADD VALUE 'AIRWALLEX';

-- DropForeignKey
ALTER TABLE "fraud_holds" DROP CONSTRAINT "fraud_holds_createdById_fkey";

-- AlterTable
ALTER TABLE "fraud_holds" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "verifications" ADD COLUMN     "country" TEXT,
ADD COLUMN     "hostedUrl" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerReferenceId" TEXT,
ADD COLUMN     "rawStatusPayload" JSONB,
ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "withdrawals" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "feeMinorUnits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fxRateSnapshot" JSONB,
ADD COLUMN     "netAmountMinorUnits" INTEGER,
ADD COLUMN     "payoutMethodId" TEXT,
ADD COLUMN     "providerPayoutId" TEXT,
ADD COLUMN     "providerStatus" TEXT;

-- CreateTable
CREATE TABLE "creator_payout_methods" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "providerBeneficiaryId" TEXT,
    "bankDetailsMasked" JSONB NOT NULL,
    "status" "PayoutMethodStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "rejectionReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_payout_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_payout_capabilities" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minPayoutMinorUnits" INTEGER NOT NULL,
    "maxPayoutMinorUnits" INTEGER NOT NULL,
    "feeFixedMinorUnits" INTEGER NOT NULL DEFAULT 0,
    "feePercentBps" INTEGER NOT NULL DEFAULT 0,
    "estimatedProcessingDays" INTEGER NOT NULL DEFAULT 3,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_payout_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_provider_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creator_payout_methods_creatorId_key" ON "creator_payout_methods"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_payout_methods_providerBeneficiaryId_key" ON "creator_payout_methods"("providerBeneficiaryId");

-- CreateIndex
CREATE INDEX "creator_payout_methods_creatorId_idx" ON "creator_payout_methods"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "country_payout_capabilities_countryCode_key" ON "country_payout_capabilities"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "payout_provider_webhook_events_provider_externalEventId_key" ON "payout_provider_webhook_events"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "verifications_providerReferenceId_idx" ON "verifications"("providerReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_providerPayoutId_key" ON "withdrawals"("providerPayoutId");

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_payoutMethodId_fkey" FOREIGN KEY ("payoutMethodId") REFERENCES "creator_payout_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_payout_methods" ADD CONSTRAINT "creator_payout_methods_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_holds" ADD CONSTRAINT "fraud_holds_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed XNAKView's own initial country payout capability defaults (not a
-- claim about TikTok's or Airwallex's real numbers) — admin-editable
-- afterwards via /admin/payout-capabilities.
INSERT INTO "country_payout_capabilities"
  ("id", "countryCode", "currency", "enabled", "minPayoutMinorUnits", "maxPayoutMinorUnits", "feeFixedMinorUnits", "feePercentBps", "estimatedProcessingDays", "notes", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'PK', 'PKR', true, 500000, 50000000, 0, 100, 3, 'XNAKView default — Pakistan local bank payout', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'IN', 'INR', true, 100000, 100000000, 0, 100, 3, 'XNAKView default — India local bank payout', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GB', 'GBP', true, 1000, 500000, 100, 50, 2, 'XNAKView default — UK local bank payout (Faster Payments)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'US', 'USD', true, 5000, 1000000, 0, 50, 2, 'XNAKView default — US ACH local bank payout', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'DE', 'EUR', true, 1000, 500000, 100, 50, 2, 'XNAKView default — Germany SEPA local bank payout', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
