-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('LIKE', 'COMMENT', 'COMMENT_LIKE', 'COMMENT_REPLY', 'FOLLOW', 'MENTION', 'REPOST');

-- AlterTable
ALTER TABLE "video_comments" ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "pinnedAt" TIMESTAMP(3),
ADD COLUMN     "replyCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "allowDownload" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowDuet" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowStitch" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "duetOfVideoId" TEXT,
ADD COLUMN     "stitchOfVideoId" TEXT,
ADD COLUMN     "stitchSourceEndMs" INTEGER,
ADD COLUMN     "stitchSourceStartMs" INTEGER;

-- CreateTable
CREATE TABLE "video_comment_likes" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_comment_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_comment_reports" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "VideoReportReason" NOT NULL,
    "description" TEXT,
    "status" "VideoReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_comment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hashtags" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hashtags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_hashtags" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "hashtagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_hashtags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentions" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "mentionedUserId" TEXT NOT NULL,
    "mentionedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reposts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reposts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_notifications" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "videoId" TEXT,
    "commentId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recent_searches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recent_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_playlists" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverKey" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_playlist_items" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_playlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_comment_likes_userId_idx" ON "video_comment_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "video_comment_likes_commentId_userId_key" ON "video_comment_likes"("commentId", "userId");

-- CreateIndex
CREATE INDEX "video_comment_reports_commentId_idx" ON "video_comment_reports"("commentId");

-- CreateIndex
CREATE INDEX "video_comment_reports_status_idx" ON "video_comment_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "video_comment_reports_commentId_reporterId_key" ON "video_comment_reports"("commentId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "hashtags_tag_key" ON "hashtags"("tag");

-- CreateIndex
CREATE INDEX "hashtags_postCount_idx" ON "hashtags"("postCount");

-- CreateIndex
CREATE INDEX "video_hashtags_hashtagId_createdAt_idx" ON "video_hashtags"("hashtagId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "video_hashtags_videoId_hashtagId_key" ON "video_hashtags"("videoId", "hashtagId");

-- CreateIndex
CREATE INDEX "mentions_mentionedUserId_createdAt_idx" ON "mentions"("mentionedUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mentions_videoId_mentionedUserId_key" ON "mentions"("videoId", "mentionedUserId");

-- CreateIndex
CREATE INDEX "reposts_userId_createdAt_idx" ON "reposts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "reposts_videoId_idx" ON "reposts"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "reposts_userId_videoId_key" ON "reposts"("userId", "videoId");

-- CreateIndex
CREATE INDEX "favorites_userId_createdAt_idx" ON "favorites"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_userId_videoId_key" ON "favorites"("userId", "videoId");

-- CreateIndex
CREATE INDEX "activity_notifications_recipientId_createdAt_idx" ON "activity_notifications"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_notifications_recipientId_readAt_idx" ON "activity_notifications"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "recent_searches_userId_createdAt_idx" ON "recent_searches"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recent_searches_userId_query_key" ON "recent_searches"("userId", "query");

-- CreateIndex
CREATE INDEX "creator_playlists_userId_createdAt_idx" ON "creator_playlists"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "creator_playlist_items_playlistId_position_idx" ON "creator_playlist_items"("playlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "creator_playlist_items_playlistId_videoId_key" ON "creator_playlist_items"("playlistId", "videoId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_playlist_items_playlistId_position_key" ON "creator_playlist_items"("playlistId", "position");

-- CreateIndex
CREATE INDEX "video_comments_videoId_parentId_createdAt_idx" ON "video_comments"("videoId", "parentId", "createdAt");

-- CreateIndex
CREATE INDEX "videos_duetOfVideoId_idx" ON "videos"("duetOfVideoId");

-- CreateIndex
CREATE INDEX "videos_stitchOfVideoId_idx" ON "videos"("stitchOfVideoId");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_duetOfVideoId_fkey" FOREIGN KEY ("duetOfVideoId") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_stitchOfVideoId_fkey" FOREIGN KEY ("stitchOfVideoId") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_comments" ADD CONSTRAINT "video_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "video_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_comment_likes" ADD CONSTRAINT "video_comment_likes_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "video_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_comment_likes" ADD CONSTRAINT "video_comment_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_comment_reports" ADD CONSTRAINT "video_comment_reports_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "video_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_comment_reports" ADD CONSTRAINT "video_comment_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_hashtags" ADD CONSTRAINT "video_hashtags_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_hashtags" ADD CONSTRAINT "video_hashtags_hashtagId_fkey" FOREIGN KEY ("hashtagId") REFERENCES "hashtags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_mentionedById_fkey" FOREIGN KEY ("mentionedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_notifications" ADD CONSTRAINT "activity_notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_notifications" ADD CONSTRAINT "activity_notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_notifications" ADD CONSTRAINT "activity_notifications_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_notifications" ADD CONSTRAINT "activity_notifications_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "video_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recent_searches" ADD CONSTRAINT "recent_searches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_playlists" ADD CONSTRAINT "creator_playlists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_playlist_items" ADD CONSTRAINT "creator_playlist_items_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "creator_playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_playlist_items" ADD CONSTRAINT "creator_playlist_items_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

