-- AlterEnum
ALTER TYPE "PayoutProviderType" ADD VALUE 'PAYONEER';

-- AlterTable
ALTER TABLE "country_payout_capabilities" ADD COLUMN     "providerPriority" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Neither Payoneer nor Airwallex is an approved/credentialed provider for
-- XNAKView yet (Step 9 completion report). This ordering is only "which
-- real credentials to try first once configured" — an unconfigured
-- provider is skipped by lib/payout/payoutProvider.ts, never faked.
UPDATE "country_payout_capabilities" SET "providerPriority" = ARRAY['PAYONEER', 'AIRWALLEX'];
