-- CreateEnum
CREATE TYPE "LiveReplayStatus" AS ENUM ('NONE', 'NOT_AVAILABLE', 'PROCESSING', 'AVAILABLE', 'DELETED');

-- CreateEnum
CREATE TYPE "LiveEventStatus" AS ENUM ('SCHEDULED', 'STARTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LiveRestrictionType" AS ENUM ('MUTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "LiveGuestRole" AS ENUM ('CO_HOST', 'GUEST');

-- CreateEnum
CREATE TYPE "LiveGuestStatus" AS ENUM ('INVITED', 'ACTIVE', 'DECLINED', 'REMOVED', 'LEFT');

-- CreateEnum
CREATE TYPE "LiveMatchStatus" AS ENUM ('PENDING', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LiveSubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterTable
ALTER TABLE "live_sessions" ADD COLUMN     "maxGuestSlots" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "replayEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replayKey" TEXT,
ADD COLUMN     "replayStatus" "LiveReplayStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "subscriberOnlyChat" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "live_viewer_reports" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "VideoReportReason" NOT NULL,
    "description" TEXT,
    "status" "VideoReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_viewer_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_chat_message_reports" (
    "id" TEXT NOT NULL,
    "liveChatMessageId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "VideoReportReason" NOT NULL,
    "description" TEXT,
    "status" "VideoReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_chat_message_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_events" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "LiveEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "liveSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_event_reminders" (
    "id" TEXT NOT NULL,
    "liveEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_event_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_moderators" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_moderators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_viewer_restrictions" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LiveRestrictionType" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_viewer_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_blocked_words" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_blocked_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_guest_slots" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "LiveGuestRole" NOT NULL DEFAULT 'GUEST',
    "status" "LiveGuestStatus" NOT NULL DEFAULT 'INVITED',
    "invitedById" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_guest_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_matches" (
    "id" TEXT NOT NULL,
    "sessionAId" TEXT NOT NULL,
    "sessionBId" TEXT NOT NULL,
    "status" "LiveMatchStatus" NOT NULL DEFAULT 'PENDING',
    "scoreA" INTEGER NOT NULL DEFAULT 0,
    "scoreB" INTEGER NOT NULL DEFAULT 0,
    "winnerSessionId" TEXT,
    "durationSeconds" INTEGER NOT NULL DEFAULT 180,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_subscriptions" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "status" "LiveSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "live_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_viewer_reports_liveSessionId_idx" ON "live_viewer_reports"("liveSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "live_viewer_reports_liveSessionId_reportedUserId_reporterId_key" ON "live_viewer_reports"("liveSessionId", "reportedUserId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "live_chat_message_reports_liveChatMessageId_reporterId_key" ON "live_chat_message_reports"("liveChatMessageId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "live_events_liveSessionId_key" ON "live_events"("liveSessionId");

-- CreateIndex
CREATE INDEX "live_events_status_scheduledAt_idx" ON "live_events"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "live_events_hostId_idx" ON "live_events"("hostId");

-- CreateIndex
CREATE UNIQUE INDEX "live_event_reminders_liveEventId_userId_key" ON "live_event_reminders"("liveEventId", "userId");

-- CreateIndex
CREATE INDEX "live_moderators_liveSessionId_idx" ON "live_moderators"("liveSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "live_moderators_liveSessionId_userId_key" ON "live_moderators"("liveSessionId", "userId");

-- CreateIndex
CREATE INDEX "live_viewer_restrictions_liveSessionId_idx" ON "live_viewer_restrictions"("liveSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "live_viewer_restrictions_liveSessionId_userId_type_key" ON "live_viewer_restrictions"("liveSessionId", "userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "live_blocked_words_word_key" ON "live_blocked_words"("word");

-- CreateIndex
CREATE INDEX "live_guest_slots_liveSessionId_status_idx" ON "live_guest_slots"("liveSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "live_guest_slots_liveSessionId_userId_key" ON "live_guest_slots"("liveSessionId", "userId");

-- CreateIndex
CREATE INDEX "live_matches_status_idx" ON "live_matches"("status");

-- CreateIndex
CREATE INDEX "live_subscriptions_creatorId_idx" ON "live_subscriptions"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "live_subscriptions_creatorId_fanId_key" ON "live_subscriptions"("creatorId", "fanId");

-- AddForeignKey
ALTER TABLE "live_viewer_reports" ADD CONSTRAINT "live_viewer_reports_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_viewer_reports" ADD CONSTRAINT "live_viewer_reports_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_viewer_reports" ADD CONSTRAINT "live_viewer_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_chat_message_reports" ADD CONSTRAINT "live_chat_message_reports_liveChatMessageId_fkey" FOREIGN KEY ("liveChatMessageId") REFERENCES "live_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_chat_message_reports" ADD CONSTRAINT "live_chat_message_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_events" ADD CONSTRAINT "live_events_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_events" ADD CONSTRAINT "live_events_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_event_reminders" ADD CONSTRAINT "live_event_reminders_liveEventId_fkey" FOREIGN KEY ("liveEventId") REFERENCES "live_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_event_reminders" ADD CONSTRAINT "live_event_reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_moderators" ADD CONSTRAINT "live_moderators_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_moderators" ADD CONSTRAINT "live_moderators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_viewer_restrictions" ADD CONSTRAINT "live_viewer_restrictions_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_viewer_restrictions" ADD CONSTRAINT "live_viewer_restrictions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_guest_slots" ADD CONSTRAINT "live_guest_slots_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_guest_slots" ADD CONSTRAINT "live_guest_slots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_matches" ADD CONSTRAINT "live_matches_sessionAId_fkey" FOREIGN KEY ("sessionAId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_matches" ADD CONSTRAINT "live_matches_sessionBId_fkey" FOREIGN KEY ("sessionBId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_subscriptions" ADD CONSTRAINT "live_subscriptions_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_subscriptions" ADD CONSTRAINT "live_subscriptions_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
