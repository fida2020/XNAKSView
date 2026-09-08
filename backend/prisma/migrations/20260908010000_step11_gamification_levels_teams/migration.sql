-- CreateEnum
CREATE TYPE "XPLedger" AS ENUM ('USER', 'CREATOR', 'FAN');

-- CreateEnum
CREATE TYPE "XPSourceType" AS ENUM ('FOLLOW_CREATED', 'CONTENT_PUBLISHED', 'LIVE_HOSTED_SESSION', 'LIVE_WATCH_SESSION', 'GIFT_SENT', 'GIFT_RECEIVED', 'FAN_CLUB_JOIN', 'FAN_CLUB_ENGAGEMENT', 'ACHIEVEMENT_UNLOCKED', 'STREAK_MILESTONE', 'TEAM_ACTIVITY', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "FanClubStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "FanClubMembershipStatus" AS ENUM ('ACTIVE', 'LEFT', 'REMOVED');

-- CreateEnum
CREATE TYPE "StreakType" AS ENUM ('LIVE_ATTENDANCE', 'FAN_CLUB_ENGAGEMENT', 'CREATOR_ACTIVITY');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'DISBANDED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "TeamMemberStatus" AS ENUM ('ACTIVE', 'LEFT', 'REMOVED');

-- CreateEnum
CREATE TYPE "TeamInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TeamTargetMetric" AS ENUM ('LIVE_HOURS', 'LIVE_SESSIONS', 'GIFTS_RECEIVED_COINS', 'TEAM_ENGAGEMENT_POINTS');

-- CreateEnum
CREATE TYPE "TeamTargetStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TeamActivityType" AS ENUM ('LIVE_HOURS_LOGGED', 'GIFT_RECEIVED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'TARGET_CREATED', 'TARGET_COMPLETED');

-- CreateEnum
CREATE TYPE "BadgeCategory" AS ENUM ('MILESTONE', 'LIVE', 'TEAM', 'CONSISTENCY', 'CREATOR', 'FAN');

-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('CONTENT', 'SOCIAL', 'LIVE', 'GIFTING', 'TEAM');

-- CreateEnum
CREATE TYPE "LeaderboardType" AS ENUM ('CREATOR_DIAMONDS', 'LIVE_HOURS', 'GIFT_SENDERS', 'FAN_CLUB_XP', 'TEAM_PERFORMANCE');

-- CreateEnum
CREATE TYPE "LeaderboardPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'ALL_TIME');

-- CreateEnum
CREATE TYPE "GamificationConfigKey" AS ENUM ('USER_LEVEL_THRESHOLDS', 'CREATOR_LEVEL_THRESHOLDS', 'FAN_LEVEL_THRESHOLDS', 'XP_AWARD_RULES', 'STREAK_RULES', 'LEADERBOARD_SETTINGS', 'ANTI_ABUSE_SETTINGS');

-- CreateEnum
CREATE TYPE "GamificationNotificationType" AS ENUM ('USER_LEVEL_UP', 'CREATOR_LEVEL_UP', 'FAN_LEVEL_UP', 'BADGE_AWARDED', 'ACHIEVEMENT_UNLOCKED', 'STREAK_MILESTONE', 'TEAM_INVITE_RECEIVED', 'TEAM_TARGET_COMPLETED', 'TEAM_ROLE_CHANGED', 'FAN_CLUB_JOINED');

-- CreateTable
CREATE TABLE "xp_events" (
    "id" TEXT NOT NULL,
    "ledger" "XPLedger" NOT NULL,
    "userId" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "sourceType" "XPSourceType" NOT NULL,
    "sourceRefId" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "excludedAsFraud" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "xp_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_up_events" (
    "id" TEXT NOT NULL,
    "ledger" "XPLedger" NOT NULL,
    "userId" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "fromLevel" INTEGER NOT NULL,
    "toLevel" INTEGER NOT NULL,
    "xpAtLevelUp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "level_up_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_levels" (
    "userId" TEXT NOT NULL,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "currentXP" INTEGER NOT NULL DEFAULT 0,
    "lifetimeXP" INTEGER NOT NULL DEFAULT 0,
    "nextLevelXP" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_levels_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "creator_levels" (
    "userId" TEXT NOT NULL,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "currentXP" INTEGER NOT NULL DEFAULT 0,
    "lifetimeXP" INTEGER NOT NULL DEFAULT 0,
    "nextLevelXP" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_levels_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "fan_clubs" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "badgeEmoji" TEXT NOT NULL DEFAULT '🎗️',
    "status" "FanClubStatus" NOT NULL DEFAULT 'ACTIVE',
    "minAccountAgeDays" INTEGER NOT NULL DEFAULT 0,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fan_clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fan_club_memberships" (
    "id" TEXT NOT NULL,
    "fanClubId" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "status" "FanClubMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "fanLevel" INTEGER NOT NULL DEFAULT 1,
    "fanXP" INTEGER NOT NULL DEFAULT 0,
    "lifetimeFanXP" INTEGER NOT NULL DEFAULT 0,
    "nextLevelXP" INTEGER NOT NULL DEFAULT 50,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "fan_club_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streaks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "StreakType" NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "longestCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "streaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatarKey" TEXT,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disbandedAt" TIMESTAMP(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "status" "TeamMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedById" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_invites" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "TeamInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "team_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_targets" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "metric" "TeamTargetMetric" NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "TeamTargetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "team_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_activity_entries" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "TeamActivityType" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "excludedAsFraud" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_activity_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconKey" TEXT,
    "category" "BadgeCategory" NOT NULL,
    "criteriaKey" TEXT NOT NULL,
    "criteriaParams" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "sourceEventRefId" TEXT,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "AchievementCategory" NOT NULL,
    "criteriaKey" TEXT NOT NULL,
    "criteriaParams" JSONB,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "progressValue" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "sourceEventRefId" TEXT,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_snapshots" (
    "id" TEXT NOT NULL,
    "type" "LeaderboardType" NOT NULL,
    "period" "LeaderboardPeriod" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_entries" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" BIGINT NOT NULL,

    CONSTRAINT "leaderboard_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gamification_configs" (
    "id" TEXT NOT NULL,
    "key" "GamificationConfigKey" NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "gamification_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gamification_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gamification_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gamification_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "GamificationNotificationType" NOT NULL,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gamification_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "xp_events_userId_ledger_createdAt_idx" ON "xp_events"("userId", "ledger", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "xp_events_ledger_userId_scopeId_sourceType_sourceRefId_key" ON "xp_events"("ledger", "userId", "scopeId", "sourceType", "sourceRefId");

-- CreateIndex
CREATE INDEX "level_up_events_userId_ledger_createdAt_idx" ON "level_up_events"("userId", "ledger", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fan_clubs_creatorId_key" ON "fan_clubs"("creatorId");

-- CreateIndex
CREATE INDEX "fan_club_memberships_fanId_idx" ON "fan_club_memberships"("fanId");

-- CreateIndex
CREATE INDEX "fan_club_memberships_fanClubId_lifetimeFanXP_idx" ON "fan_club_memberships"("fanClubId", "lifetimeFanXP");

-- CreateIndex
CREATE UNIQUE INDEX "fan_club_memberships_fanClubId_fanId_key" ON "fan_club_memberships"("fanClubId", "fanId");

-- CreateIndex
CREATE UNIQUE INDEX "streaks_userId_type_scopeId_key" ON "streaks"("userId", "type", "scopeId");

-- CreateIndex
CREATE INDEX "teams_status_idx" ON "teams"("status");

-- CreateIndex
CREATE INDEX "team_members_userId_status_idx" ON "team_members"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");

-- CreateIndex
CREATE INDEX "team_invites_inviteeId_status_idx" ON "team_invites"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "team_invites_teamId_status_idx" ON "team_invites"("teamId", "status");

-- CreateIndex
CREATE INDEX "team_targets_teamId_status_idx" ON "team_targets"("teamId", "status");

-- CreateIndex
CREATE INDEX "team_activity_entries_teamId_createdAt_idx" ON "team_activity_entries"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "team_activity_entries_teamId_type_createdAt_idx" ON "team_activity_entries"("teamId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "badges_slug_key" ON "badges"("slug");

-- CreateIndex
CREATE INDEX "user_badges_userId_idx" ON "user_badges"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_badgeId_key" ON "user_badges"("userId", "badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_slug_key" ON "achievements"("slug");

-- CreateIndex
CREATE INDEX "user_achievements_userId_idx" ON "user_achievements"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_userId_achievementId_key" ON "user_achievements"("userId", "achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_snapshots_type_period_periodKey_scopeId_key" ON "leaderboard_snapshots"("type", "period", "periodKey", "scopeId");

-- CreateIndex
CREATE INDEX "leaderboard_entries_snapshotId_rank_idx" ON "leaderboard_entries"("snapshotId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_entries_snapshotId_subjectId_key" ON "leaderboard_entries"("snapshotId", "subjectId");

-- CreateIndex
CREATE INDEX "gamification_configs_key_createdAt_idx" ON "gamification_configs"("key", "createdAt");

-- CreateIndex
CREATE INDEX "gamification_audit_logs_entityType_entityId_idx" ON "gamification_audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "gamification_audit_logs_actorId_createdAt_idx" ON "gamification_audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "gamification_notifications_userId_createdAt_idx" ON "gamification_notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "gamification_notifications_userId_readAt_idx" ON "gamification_notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_up_events" ADD CONSTRAINT "level_up_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_levels" ADD CONSTRAINT "user_levels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_levels" ADD CONSTRAINT "creator_levels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fan_clubs" ADD CONSTRAINT "fan_clubs_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fan_club_memberships" ADD CONSTRAINT "fan_club_memberships_fanClubId_fkey" FOREIGN KEY ("fanClubId") REFERENCES "fan_clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fan_club_memberships" ADD CONSTRAINT "fan_club_memberships_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_targets" ADD CONSTRAINT "team_targets_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_activity_entries" ADD CONSTRAINT "team_activity_entries_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_activity_entries" ADD CONSTRAINT "team_activity_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "leaderboard_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gamification_configs" ADD CONSTRAINT "gamification_configs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gamification_audit_logs" ADD CONSTRAINT "gamification_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gamification_notifications" ADD CONSTRAINT "gamification_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

