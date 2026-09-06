-- CreateTable
CREATE TABLE "call_reports" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "VideoReportReason" NOT NULL,
    "description" TEXT,
    "status" "VideoReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_reports_callId_idx" ON "call_reports"("callId");

-- CreateIndex
CREATE INDEX "call_reports_status_idx" ON "call_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "call_reports_callId_reporterId_key" ON "call_reports"("callId", "reporterId");

-- AddForeignKey
ALTER TABLE "call_reports" ADD CONSTRAINT "call_reports_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_reports" ADD CONSTRAINT "call_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
