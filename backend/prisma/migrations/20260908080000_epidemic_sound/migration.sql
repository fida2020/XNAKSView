-- Real licensed music catalog (Epidemic Sound Partner Content API).
CREATE TABLE "epidemic_sound_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "trackTitle" TEXT NOT NULL,
    "trackArtist" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "epidemic_sound_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "epidemic_sound_favorites_userId_trackId_key" ON "epidemic_sound_favorites"("userId", "trackId");

ALTER TABLE "epidemic_sound_favorites" ADD CONSTRAINT "epidemic_sound_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "epidemic_sound_recents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "trackTitle" TEXT NOT NULL,
    "trackArtist" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "epidemic_sound_recents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "epidemic_sound_recents_userId_trackId_key" ON "epidemic_sound_recents"("userId", "trackId");

ALTER TABLE "epidemic_sound_recents" ADD CONSTRAINT "epidemic_sound_recents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
