-- AlterEnum
ALTER TYPE "CoinLedgerEntryType" ADD VALUE 'EARNINGS_EXCHANGE';

-- AlterEnum
ALTER TYPE "EarningsLedgerEntryType" ADD VALUE 'EXCHANGE_TO_COINS';

-- CreateTable
CREATE TABLE "earnings_coin_exchanges" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRateId" TEXT NOT NULL,
    "pkrPerUsdSnapshot" DECIMAL(10,4) NOT NULL,
    "coinValuePkrSnapshot" DECIMAL(10,2) NOT NULL,
    "coinsCredited" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earnings_coin_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "earnings_coin_exchanges_idempotencyKey_key" ON "earnings_coin_exchanges"("idempotencyKey");

-- CreateIndex
CREATE INDEX "earnings_coin_exchanges_creatorId_createdAt_idx" ON "earnings_coin_exchanges"("creatorId", "createdAt");

-- AddForeignKey
ALTER TABLE "earnings_coin_exchanges" ADD CONSTRAINT "earnings_coin_exchanges_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_coin_exchanges" ADD CONSTRAINT "earnings_coin_exchanges_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

