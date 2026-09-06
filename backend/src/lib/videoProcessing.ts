import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  compositeDuetSideBySide,
  compositeStitchConcat,
  generateThumbnail,
  probeVideo,
  transcodeToPlaybackMp4,
} from '@/lib/ffmpeg';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { storage, videoPlaybackKey, videoThumbnailKey } from '@/lib/storage';

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;

function tempFilePath(suffix: string): string {
  return path.join(os.tmpdir(), `xnakview-video-${randomUUID()}${suffix}`);
}

async function cleanupQuietly(...filePaths: string[]): Promise<void> {
  await Promise.allSettled(filePaths.map((filePath) => unlink(filePath)));
}

async function runProcessingAttempt(videoId: string, originalKey: string): Promise<void> {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
  const original = await storage.getLocalReadPath(originalKey);
  const thumbnailTemp = tempFilePath('.jpg');
  // The final encoded output — either a plain transcode of `original`, or
  // the composited Duet/Stitch result, which is already final-format.
  const finalTemp = tempFilePath('.mp4');
  let sourceLocal: Awaited<ReturnType<typeof storage.getLocalReadPath>> | null = null;

  try {
    if (video.duetOfVideoId) {
      // A Duet (brief E) composites the source's existing playback file
      // with the newly uploaded recording — never the source's original
      // upload, which may not even still exist once it's PROCESSING-only.
      const source = await prisma.video.findUniqueOrThrow({ where: { id: video.duetOfVideoId } });
      if (!source.playbackKey) {
        throw new Error('Duet source video has no playback file');
      }
      sourceLocal = await storage.getLocalReadPath(source.playbackKey);
      await compositeDuetSideBySide(sourceLocal.path, original.path, finalTemp);
    } else if (video.stitchOfVideoId && video.stitchSourceStartMs !== null && video.stitchSourceEndMs !== null) {
      const source = await prisma.video.findUniqueOrThrow({ where: { id: video.stitchOfVideoId } });
      if (!source.playbackKey) {
        throw new Error('Stitch source video has no playback file');
      }
      sourceLocal = await storage.getLocalReadPath(source.playbackKey);
      await compositeStitchConcat(sourceLocal.path, video.stitchSourceStartMs, video.stitchSourceEndMs, original.path, finalTemp);
    } else {
      await transcodeToPlaybackMp4(original.path, finalTemp);
    }

    const probe = await probeVideo(finalTemp);

    // Capture the thumbnail at 1s in, or halfway through very short clips —
    // never past the end of the video.
    const thumbnailAtSeconds = Math.min(1, probe.durationMs / 2000);
    await generateThumbnail(finalTemp, thumbnailTemp, thumbnailAtSeconds);

    const playbackKey = videoPlaybackKey(videoId);
    const thumbnailKey = videoThumbnailKey(videoId);
    await storage.putFromLocalPath(playbackKey, finalTemp);
    await storage.putFromLocalPath(thumbnailKey, thumbnailTemp);

    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'READY',
        playbackKey,
        thumbnailKey,
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        processingError: null,
      },
    });
  } finally {
    await original.cleanup();
    await sourceLocal?.cleanup();
    // putFromLocalPath moves (renames) its source on success, so only a
    // failed attempt (thrown before the move) leaves these temp files behind.
    await cleanupQuietly(thumbnailTemp, finalTemp);
  }
}

/**
 * Runs the full processing pipeline for a video that was just uploaded,
 * with a small number of immediate retries for transient failures (e.g. a
 * momentary ffmpeg hiccup). If every attempt fails, the video is marked
 * FAILED with the real error — never silently left in PROCESSING, and
 * never marked READY without a genuine successful transcode.
 *
 * This runs in-process, fire-and-forget from the upload request. A durable,
 * cross-restart job queue (e.g. BullMQ on the existing Redis) is the
 * natural next step once upload volume warrants it — not built here to
 * keep this step's scope to "a real, working pipeline", not "a production
 * job scheduler".
 */
export async function processVideo(videoId: string, originalKey: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await runProcessingAttempt(videoId, originalKey);
      return;
    } catch (error) {
      lastError = error;
      logger.error({ err: error, videoId, attempt }, 'Video processing attempt failed');
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Unknown video processing error';
  try {
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'FAILED', processingError: message.slice(0, 1000) },
    });
  } catch (updateError) {
    logger.error({ err: updateError, videoId }, 'Failed to persist FAILED status after processing error');
  }
}
