-- Voice Chat LIVE mode — a real, persisted session-type flag.
ALTER TABLE "live_sessions" ADD COLUMN "isVoiceOnly" BOOLEAN NOT NULL DEFAULT false;
