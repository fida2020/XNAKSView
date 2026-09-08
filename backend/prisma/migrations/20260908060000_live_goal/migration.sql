-- LIVE Goal (Step 3/rebuild) — a real Coin-spend target the host can set
-- before going LIVE, incremented server-side by real Gift sends only.
ALTER TABLE "live_sessions" ADD COLUMN "goalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "live_sessions" ADD COLUMN "goalTitle" TEXT;
ALTER TABLE "live_sessions" ADD COLUMN "goalTargetCoins" INTEGER;
ALTER TABLE "live_sessions" ADD COLUMN "goalProgressCoins" INTEGER NOT NULL DEFAULT 0;
