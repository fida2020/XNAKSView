-- DropForeignKey
ALTER TABLE "dating_decisions" DROP CONSTRAINT "dating_decisions_actorId_fkey";

-- DropForeignKey
ALTER TABLE "dating_decisions" DROP CONSTRAINT "dating_decisions_targetId_fkey";

-- DropForeignKey
ALTER TABLE "dating_matches" DROP CONSTRAINT "dating_matches_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "dating_matches" DROP CONSTRAINT "dating_matches_userAId_fkey";

-- DropForeignKey
ALTER TABLE "dating_matches" DROP CONSTRAINT "dating_matches_userBId_fkey";

-- DropForeignKey
ALTER TABLE "dating_photos" DROP CONSTRAINT "dating_photos_datingProfileId_fkey";

-- DropForeignKey
ALTER TABLE "dating_profiles" DROP CONSTRAINT "dating_profiles_userId_fkey";

-- DropForeignKey
ALTER TABLE "dating_reports" DROP CONSTRAINT "dating_reports_reporterId_fkey";

-- DropForeignKey
ALTER TABLE "dating_reports" DROP CONSTRAINT "dating_reports_targetUserId_fkey";

-- DropTable
DROP TABLE "dating_decisions";

-- DropTable
DROP TABLE "dating_matches";

-- DropTable
DROP TABLE "dating_photos";

-- DropTable
DROP TABLE "dating_profiles";

-- DropTable
DROP TABLE "dating_reports";

-- DropEnum
DROP TYPE "DatingDecisionType";

-- DropEnum
DROP TYPE "DatingGender";

-- DropEnum
DROP TYPE "DatingMatchStatus";

-- DropEnum
DROP TYPE "DatingRelationshipIntent";

-- AlterEnum
BEGIN;
CREATE TYPE "VideoReportReason_new" AS ENUM ('SPAM', 'NUDITY_OR_SEXUAL_CONTENT', 'VIOLENCE', 'HARASSMENT_OR_BULLYING', 'HATE_SPEECH', 'MISINFORMATION', 'OTHER');
ALTER TABLE "video_reports" ALTER COLUMN "reason" TYPE "VideoReportReason_new" USING ("reason"::text::"VideoReportReason_new");
ALTER TABLE "live_reports" ALTER COLUMN "reason" TYPE "VideoReportReason_new" USING ("reason"::text::"VideoReportReason_new");
ALTER TABLE "live_viewer_reports" ALTER COLUMN "reason" TYPE "VideoReportReason_new" USING ("reason"::text::"VideoReportReason_new");
ALTER TABLE "live_chat_message_reports" ALTER COLUMN "reason" TYPE "VideoReportReason_new" USING ("reason"::text::"VideoReportReason_new");
ALTER TABLE "message_reports" ALTER COLUMN "reason" TYPE "VideoReportReason_new" USING ("reason"::text::"VideoReportReason_new");
ALTER TABLE "conversation_reports" ALTER COLUMN "reason" TYPE "VideoReportReason_new" USING ("reason"::text::"VideoReportReason_new");
ALTER TABLE "call_reports" ALTER COLUMN "reason" TYPE "VideoReportReason_new" USING ("reason"::text::"VideoReportReason_new");
ALTER TYPE "VideoReportReason" RENAME TO "VideoReportReason_old";
ALTER TYPE "VideoReportReason_new" RENAME TO "VideoReportReason";
DROP TYPE "VideoReportReason_old";
COMMIT;
