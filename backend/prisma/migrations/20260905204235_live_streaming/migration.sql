-- CreateEnum
CREATE TYPE "LiveStatus" AS ENUM ('LIVE', 'ENDED');

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "thumbnailKey" TEXT,
    "status" "LiveStatus" NOT NULL DEFAULT 'LIVE',
    "viewerCount" INTEGER NOT NULL DEFAULT 0,
    "peakViewerCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_viewers" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "live_viewers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_chat_messages" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_reports" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "VideoReportReason" NOT NULL,
    "description" TEXT,
    "status" "VideoReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_sessions_status_startedAt_idx" ON "live_sessions"("status", "startedAt");

-- CreateIndex
CREATE INDEX "live_sessions_hostId_idx" ON "live_sessions"("hostId");

-- CreateIndex
CREATE INDEX "live_viewers_liveSessionId_idx" ON "live_viewers"("liveSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "live_viewers_liveSessionId_userId_key" ON "live_viewers"("liveSessionId", "userId");

-- CreateIndex
CREATE INDEX "live_chat_messages_liveSessionId_createdAt_idx" ON "live_chat_messages"("liveSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "live_reports_liveSessionId_idx" ON "live_reports"("liveSessionId");

-- CreateIndex
CREATE INDEX "live_reports_status_idx" ON "live_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "live_reports_liveSessionId_reporterId_key" ON "live_reports"("liveSessionId", "reporterId");

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_viewers" ADD CONSTRAINT "live_viewers_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_viewers" ADD CONSTRAINT "live_viewers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_chat_messages" ADD CONSTRAINT "live_chat_messages_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_chat_messages" ADD CONSTRAINT "live_chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_reports" ADD CONSTRAINT "live_reports_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_reports" ADD CONSTRAINT "live_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
