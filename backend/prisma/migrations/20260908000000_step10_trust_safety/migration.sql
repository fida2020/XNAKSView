-- CreateEnum
CREATE TYPE "ModerationContentType" AS ENUM ('VIDEO', 'VIDEO_COMMENT', 'PHOTO_POST', 'PHOTO_POST_COMMENT', 'TEXT_POST', 'TEXT_POST_COMMENT', 'STORY', 'MESSAGE', 'LIVE_CHAT_MESSAGE', 'LIVE_SESSION', 'USER_PROFILE', 'USERNAME', 'BIO', 'AVATAR');

-- CreateEnum
CREATE TYPE "ModerationCategory" AS ENUM ('SEXUAL_NUDITY', 'EXPLOITATION', 'VIOLENCE', 'GRAPHIC_CONTENT', 'THREATS', 'HATE_HARASSMENT', 'BULLYING', 'ABUSIVE_PROFANE_LANGUAGE', 'DANGEROUS_BEHAVIOR', 'SCAM_FRAUD', 'SPAM', 'IMPERSONATION', 'ILLEGAL_REGULATED', 'HARMFUL_CONTENT', 'COPYRIGHT', 'OTHER_POLICY_VIOLATION');

-- CreateEnum
CREATE TYPE "ModerationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'SEVERE');

-- CreateEnum
CREATE TYPE "ModerationDecision" AS ENUM ('ALLOW', 'LIMIT', 'NOT_RECOMMENDED', 'AGE_RESTRICT', 'REMOVE', 'FEATURE_RESTRICT', 'TEMPORARY_ACCOUNT_RESTRICT', 'PERMANENT_BAN');

-- CreateEnum
CREATE TYPE "EnforcementActionType" AS ENUM ('WARN', 'CONTENT_REMOVED', 'LIMIT_DISTRIBUTION', 'AGE_RESTRICT', 'FEATURE_RESTRICT', 'TEMPORARY_ACCOUNT_RESTRICT', 'PERMANENT_BAN');

-- CreateEnum
CREATE TYPE "EnforcementStatus" AS ENUM ('ACTIVE', 'REVERSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EnforcementSourceType" AS ENUM ('MODERATION_EVENT', 'SAFETY_REPORT', 'RISK_ASSESSMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SafetyReportTargetType" AS ENUM ('USER_ACCOUNT', 'VIDEO', 'VIDEO_COMMENT', 'PHOTO_POST', 'PHOTO_POST_COMMENT', 'TEXT_POST', 'TEXT_POST_COMMENT', 'STORY', 'MESSAGE', 'CONVERSATION', 'LIVE_SESSION', 'LIVE_CHAT_MESSAGE', 'CREATOR_PAYMENT');

-- CreateEnum
CREATE TYPE "SafetyReportReasonCategory" AS ENUM ('SEXUAL_NUDITY', 'EXPLOITATION', 'VIOLENCE', 'GRAPHIC_CONTENT', 'THREATS', 'HATE_HARASSMENT', 'BULLYING', 'ABUSIVE_PROFANE_LANGUAGE', 'DANGEROUS_BEHAVIOR', 'SCAM_FRAUD', 'SPAM', 'IMPERSONATION', 'ILLEGAL_REGULATED', 'HARMFUL_CONTENT', 'COPYRIGHT', 'UNDERAGE_USER', 'OTHER');

-- CreateEnum
CREATE TYPE "SafetyReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RiskSubjectType" AS ENUM ('USER', 'ACCOUNT_CREATION', 'WITHDRAWAL', 'PAYOUT_METHOD', 'GIFT_TRANSACTION');

-- CreateEnum
CREATE TYPE "IdentityTrustStatus" AS ENUM ('ACTIVE', 'REVOKED_BANNED');

-- CreateTable
CREATE TABLE "moderation_events" (
    "id" TEXT NOT NULL,
    "contentType" "ModerationContentType" NOT NULL,
    "contentId" TEXT NOT NULL,
    "authorId" TEXT,
    "provider" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "categories" JSONB NOT NULL,
    "severity" "ModerationSeverity" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "decision" "ModerationDecision" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_evidence" (
    "id" TEXT NOT NULL,
    "moderationEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enforcement_actions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" "EnforcementActionType" NOT NULL,
    "category" "ModerationCategory",
    "severity" "ModerationSeverity",
    "sourceType" "EnforcementSourceType" NOT NULL,
    "moderationEventId" TEXT,
    "safetyReportId" TEXT,
    "riskAssessmentId" TEXT,
    "contentType" "ModerationContentType",
    "contentId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "EnforcementStatus" NOT NULL DEFAULT 'ACTIVE',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,

    CONSTRAINT "enforcement_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appeals" (
    "id" TEXT NOT NULL,
    "enforcementActionId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'SUBMITTED',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" "SafetyReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "reasonCategory" "SafetyReportReasonCategory" NOT NULL,
    "details" TEXT,
    "status" "SafetyReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" TEXT NOT NULL,
    "subjectType" "RiskSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "userId" TEXT,
    "riskScore" INTEGER NOT NULL,
    "reasonCodes" TEXT[],
    "evidenceRefs" JSONB,
    "recommendedAction" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_trust_signals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityFingerprintHash" TEXT NOT NULL,
    "verificationProvider" TEXT NOT NULL,
    "status" "IdentityTrustStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "identity_trust_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_events_contentType_contentId_idx" ON "moderation_events"("contentType", "contentId");

-- CreateIndex
CREATE INDEX "moderation_events_authorId_createdAt_idx" ON "moderation_events"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_events_decision_idx" ON "moderation_events"("decision");

-- CreateIndex
CREATE INDEX "moderation_evidence_moderationEventId_idx" ON "moderation_evidence"("moderationEventId");

-- CreateIndex
CREATE INDEX "enforcement_actions_userId_status_idx" ON "enforcement_actions"("userId", "status");

-- CreateIndex
CREATE INDEX "enforcement_actions_contentType_contentId_idx" ON "enforcement_actions"("contentType", "contentId");

-- CreateIndex
CREATE INDEX "enforcement_actions_actionType_idx" ON "enforcement_actions"("actionType");

-- CreateIndex
CREATE INDEX "appeals_enforcementActionId_idx" ON "appeals"("enforcementActionId");

-- CreateIndex
CREATE INDEX "appeals_submittedById_createdAt_idx" ON "appeals"("submittedById", "createdAt");

-- CreateIndex
CREATE INDEX "appeals_status_idx" ON "appeals"("status");

-- CreateIndex
CREATE INDEX "safety_reports_targetType_targetId_idx" ON "safety_reports"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "safety_reports_targetUserId_idx" ON "safety_reports"("targetUserId");

-- CreateIndex
CREATE INDEX "safety_reports_status_createdAt_idx" ON "safety_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "risk_assessments_subjectType_subjectId_idx" ON "risk_assessments"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "risk_assessments_userId_createdAt_idx" ON "risk_assessments"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "identity_trust_signals_userId_key" ON "identity_trust_signals"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "identity_trust_signals_identityFingerprintHash_key" ON "identity_trust_signals"("identityFingerprintHash");

-- CreateIndex
CREATE INDEX "identity_trust_signals_status_idx" ON "identity_trust_signals"("status");

-- AddForeignKey
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_evidence" ADD CONSTRAINT "moderation_evidence_moderationEventId_fkey" FOREIGN KEY ("moderationEventId") REFERENCES "moderation_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_moderationEventId_fkey" FOREIGN KEY ("moderationEventId") REFERENCES "moderation_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_safetyReportId_fkey" FOREIGN KEY ("safetyReportId") REFERENCES "safety_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "risk_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_enforcementActionId_fkey" FOREIGN KEY ("enforcementActionId") REFERENCES "enforcement_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_trust_signals" ADD CONSTRAINT "identity_trust_signals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

