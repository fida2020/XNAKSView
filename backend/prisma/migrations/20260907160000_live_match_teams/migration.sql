-- CreateEnum
CREATE TYPE "LiveMatchType" AS ENUM ('SOLO', 'TEAM');

-- CreateEnum
CREATE TYPE "LiveMatchSide" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "LiveMatchTeamMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'DECLINED', 'REMOVED', 'LEFT');

-- AlterTable
ALTER TABLE "live_matches" ADD COLUMN     "matchType" "LiveMatchType" NOT NULL DEFAULT 'SOLO';

-- CreateTable
CREATE TABLE "live_match_team_members" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "side" "LiveMatchSide" NOT NULL,
    "status" "LiveMatchTeamMemberStatus" NOT NULL DEFAULT 'INVITED',
    "invitedById" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_match_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_match_team_members_matchId_side_status_idx" ON "live_match_team_members"("matchId", "side", "status");

-- CreateIndex
CREATE UNIQUE INDEX "live_match_team_members_matchId_liveSessionId_key" ON "live_match_team_members"("matchId", "liveSessionId");

-- AddForeignKey
ALTER TABLE "live_match_team_members" ADD CONSTRAINT "live_match_team_members_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "live_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_match_team_members" ADD CONSTRAINT "live_match_team_members_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

