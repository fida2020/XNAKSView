-- CreateEnum
CREATE TYPE "StoryMediaType" AS ENUM ('PHOTO', 'VIDEO');

-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "addYoursOfVideoId" TEXT,
ADD COLUMN     "addYoursPrompt" TEXT,
ADD COLUMN     "soundId" TEXT;

-- CreateTable
CREATE TABLE "sounds" (
    "id" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "title" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_posts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caption" TEXT,
    "visibility" "VideoVisibility" NOT NULL DEFAULT 'PUBLIC',
    "allowDownload" BOOLEAN NOT NULL DEFAULT true,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "photo_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_post_assets" (
    "id" TEXT NOT NULL,
    "photoPostId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "photo_post_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_post_likes" (
    "id" TEXT NOT NULL,
    "photoPostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_post_comments" (
    "id" TEXT NOT NULL,
    "photoPostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_post_reports" (
    "id" TEXT NOT NULL,
    "photoPostId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "VideoReportReason" NOT NULL,
    "description" TEXT,
    "status" "VideoReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_post_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_post_hashtags" (
    "id" TEXT NOT NULL,
    "photoPostId" TEXT NOT NULL,
    "hashtagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_post_hashtags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_posts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "backgroundStyle" TEXT,
    "visibility" "VideoVisibility" NOT NULL DEFAULT 'PUBLIC',
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "text_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_post_likes" (
    "id" TEXT NOT NULL,
    "textPostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_post_comments" (
    "id" TEXT NOT NULL,
    "textPostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_post_reports" (
    "id" TEXT NOT NULL,
    "textPostId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "VideoReportReason" NOT NULL,
    "description" TEXT,
    "status" "VideoReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_post_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_post_hashtags" (
    "id" TEXT NOT NULL,
    "textPostId" TEXT NOT NULL,
    "hashtagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_post_hashtags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "mediaType" "StoryMediaType" NOT NULL,
    "caption" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_views" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_replies" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_reports" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "VideoReportReason" NOT NULL,
    "description" TEXT,
    "status" "VideoReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sounds_sourceVideoId_key" ON "sounds"("sourceVideoId");

-- CreateIndex
CREATE INDEX "sounds_usageCount_idx" ON "sounds"("usageCount");

-- CreateIndex
CREATE INDEX "photo_posts_userId_createdAt_idx" ON "photo_posts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "photo_posts_visibility_createdAt_idx" ON "photo_posts"("visibility", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "photo_post_assets_photoPostId_position_key" ON "photo_post_assets"("photoPostId", "position");

-- CreateIndex
CREATE INDEX "photo_post_likes_userId_idx" ON "photo_post_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "photo_post_likes_photoPostId_userId_key" ON "photo_post_likes"("photoPostId", "userId");

-- CreateIndex
CREATE INDEX "photo_post_comments_photoPostId_createdAt_idx" ON "photo_post_comments"("photoPostId", "createdAt");

-- CreateIndex
CREATE INDEX "photo_post_reports_status_idx" ON "photo_post_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "photo_post_reports_photoPostId_reporterId_key" ON "photo_post_reports"("photoPostId", "reporterId");

-- CreateIndex
CREATE INDEX "photo_post_hashtags_hashtagId_createdAt_idx" ON "photo_post_hashtags"("hashtagId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "photo_post_hashtags_photoPostId_hashtagId_key" ON "photo_post_hashtags"("photoPostId", "hashtagId");

-- CreateIndex
CREATE INDEX "text_posts_userId_createdAt_idx" ON "text_posts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "text_posts_visibility_createdAt_idx" ON "text_posts"("visibility", "createdAt");

-- CreateIndex
CREATE INDEX "text_post_likes_userId_idx" ON "text_post_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "text_post_likes_textPostId_userId_key" ON "text_post_likes"("textPostId", "userId");

-- CreateIndex
CREATE INDEX "text_post_comments_textPostId_createdAt_idx" ON "text_post_comments"("textPostId", "createdAt");

-- CreateIndex
CREATE INDEX "text_post_reports_status_idx" ON "text_post_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "text_post_reports_textPostId_reporterId_key" ON "text_post_reports"("textPostId", "reporterId");

-- CreateIndex
CREATE INDEX "text_post_hashtags_hashtagId_createdAt_idx" ON "text_post_hashtags"("hashtagId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "text_post_hashtags_textPostId_hashtagId_key" ON "text_post_hashtags"("textPostId", "hashtagId");

-- CreateIndex
CREATE INDEX "stories_userId_createdAt_idx" ON "stories"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "stories_expiresAt_idx" ON "stories"("expiresAt");

-- CreateIndex
CREATE INDEX "story_views_storyId_idx" ON "story_views"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "story_views_storyId_userId_key" ON "story_views"("storyId", "userId");

-- CreateIndex
CREATE INDEX "story_replies_storyId_createdAt_idx" ON "story_replies"("storyId", "createdAt");

-- CreateIndex
CREATE INDEX "story_reports_status_idx" ON "story_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "story_reports_storyId_reporterId_key" ON "story_reports"("storyId", "reporterId");

-- CreateIndex
CREATE INDEX "videos_addYoursOfVideoId_idx" ON "videos"("addYoursOfVideoId");

-- CreateIndex
CREATE INDEX "videos_soundId_idx" ON "videos"("soundId");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_addYoursOfVideoId_fkey" FOREIGN KEY ("addYoursOfVideoId") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_soundId_fkey" FOREIGN KEY ("soundId") REFERENCES "sounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sounds" ADD CONSTRAINT "sounds_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_posts" ADD CONSTRAINT "photo_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_post_assets" ADD CONSTRAINT "photo_post_assets_photoPostId_fkey" FOREIGN KEY ("photoPostId") REFERENCES "photo_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_post_likes" ADD CONSTRAINT "photo_post_likes_photoPostId_fkey" FOREIGN KEY ("photoPostId") REFERENCES "photo_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_post_likes" ADD CONSTRAINT "photo_post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_post_comments" ADD CONSTRAINT "photo_post_comments_photoPostId_fkey" FOREIGN KEY ("photoPostId") REFERENCES "photo_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_post_comments" ADD CONSTRAINT "photo_post_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_post_reports" ADD CONSTRAINT "photo_post_reports_photoPostId_fkey" FOREIGN KEY ("photoPostId") REFERENCES "photo_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_post_reports" ADD CONSTRAINT "photo_post_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_post_hashtags" ADD CONSTRAINT "photo_post_hashtags_photoPostId_fkey" FOREIGN KEY ("photoPostId") REFERENCES "photo_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_post_hashtags" ADD CONSTRAINT "photo_post_hashtags_hashtagId_fkey" FOREIGN KEY ("hashtagId") REFERENCES "hashtags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_posts" ADD CONSTRAINT "text_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_post_likes" ADD CONSTRAINT "text_post_likes_textPostId_fkey" FOREIGN KEY ("textPostId") REFERENCES "text_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_post_likes" ADD CONSTRAINT "text_post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_post_comments" ADD CONSTRAINT "text_post_comments_textPostId_fkey" FOREIGN KEY ("textPostId") REFERENCES "text_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_post_comments" ADD CONSTRAINT "text_post_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_post_reports" ADD CONSTRAINT "text_post_reports_textPostId_fkey" FOREIGN KEY ("textPostId") REFERENCES "text_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_post_reports" ADD CONSTRAINT "text_post_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_post_hashtags" ADD CONSTRAINT "text_post_hashtags_textPostId_fkey" FOREIGN KEY ("textPostId") REFERENCES "text_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_post_hashtags" ADD CONSTRAINT "text_post_hashtags_hashtagId_fkey" FOREIGN KEY ("hashtagId") REFERENCES "hashtags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_reports" ADD CONSTRAINT "story_reports_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_reports" ADD CONSTRAINT "story_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

