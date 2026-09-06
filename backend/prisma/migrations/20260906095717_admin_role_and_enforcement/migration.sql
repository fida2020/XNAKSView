-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "statusUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "statusUpdatedById" TEXT;
