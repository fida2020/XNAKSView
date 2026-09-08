import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import os from 'os';
import path from 'path';

import { env } from '@/config/env';
import { downloadEpidemicTrack } from '@/lib/epidemicSound';
import {
  compositeDuetSideBySide,
  compositeStitchConcat,
  generateThumbnail,
  probeVideo,
  renderEditedVideo,
  transcodeToPlaybackMp4,
  type ExtraAudioInput,
  type VideoEditSpec,
} from '@/lib/ffmpeg';
import { onContentPublished } from '@/lib/gamification/events';
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
  // The final encoded output — either a plain transcode of `original`, the
  // composited Duet/Stitch result, or the real editor's render, each
  // already final-format.
  const finalTemp = tempFilePath('.mp4');
  let sourceLocal: Awaited<ReturnType<typeof storage.getLocalReadPath>> | null = null;
  const extraAudioLocals: Awaited<ReturnType<typeof storage.getLocalReadPath>>[] = [];
  let coverAtMs: number | undefined;
  let epidemicTrackTemp: string | undefined;

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
    } else if (video.editSpec) {
      // Video editor rebuild — real trim/speed/filter/text/rotate/volume
      // render (see lib/ffmpeg.ts's renderEditedVideo). Duet/Stitch above
      // never carry an editSpec — they keep their own composite pipeline.
      const spec = video.editSpec as unknown as VideoEditSpec & { voiceoverKey?: string; epidemicTrackId?: string };
      coverAtMs = spec.coverAtMs;

      const extraAudio: ExtraAudioInput[] = [];
      if (video.soundId) {
        const sound = await prisma.sound.findUnique({ where: { id: video.soundId }, include: { sourceVideo: true } });
        if (sound?.sourceVideo.playbackKey) {
          const soundLocal = await storage.getLocalReadPath(sound.sourceVideo.playbackKey);
          extraAudioLocals.push(soundLocal);
          extraAudio.push({ path: soundLocal.path, volume: spec.soundVolume ?? 1 });
        } else {
          logger.warn({ videoId, soundId: video.soundId }, 'Attached Sound has no ready source audio — posting without it');
        }
      }
      if (spec.epidemicTrackId) {
        // Real licensed music (Epidemic Sound Partner Content API) — a
        // fresh signed download URL + real audio bytes are fetched right
        // here, at render time, rather than ever cached/re-served (see
        // lib/epidemicSound.ts's own doc comment on why).
        epidemicTrackTemp = tempFilePath('.mp3');
        await downloadEpidemicTrack(spec.epidemicTrackId, epidemicTrackTemp);
        extraAudio.push({ path: epidemicTrackTemp, volume: spec.soundVolume ?? 1 });
      }
      if (spec.voiceoverKey) {
        const voiceoverLocal = await storage.getLocalReadPath(spec.voiceoverKey);
        extraAudioLocals.push(voiceoverLocal);
        extraAudio.push({ path: voiceoverLocal.path, volume: spec.voiceoverVolume ?? 1 });
      }

      await renderEditedVideo(original.path, spec, extraAudio, finalTemp, env.DRAWTEXT_FONT_PATH);
    } else {
      await transcodeToPlaybackMp4(original.path, finalTemp);
    }

    const probe = await probeVideo(finalTemp);

    // Capture the thumbnail at the user-chosen cover frame if the editor
    // spec named one (clamped to the real final duration — a stale choice
    // from before a later trim/speed edit must never point past the end);
    // otherwise the existing default (1s in, or halfway through very short
    // clips, never past the end).
    const thumbnailAtSeconds =
      coverAtMs !== undefined ? Math.min(coverAtMs / 1000, Math.max(0, probe.durationMs / 1000 - 0.05)) : Math.min(1, probe.durationMs / 2000);
    await generateThumbnail(finalTemp, thumbnailTemp, thumbnailAtSeconds);

    const playbackKey = videoPlaybackKey(videoId);
    const thumbnailKey = videoThumbnailKey(videoId);
    await storage.putFromLocalPath(playbackKey, finalTemp);
    await storage.putFromLocalPath(thumbnailKey, thumbnailTemp);

    const readyVideo = await prisma.video.update({
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
    onContentPublished(readyVideo.userId, 'VIDEO', readyVideo.id);
  } finally {
    await original.cleanup();
    await sourceLocal?.cleanup();
    await Promise.allSettled(extraAudioLocals.map((local) => local.cleanup()));
    // putFromLocalPath moves (renames) its source on success, so only a
    // failed attempt (thrown before the move) leaves these temp files behind.
    await cleanupQuietly(thumbnailTemp, finalTemp);
    if (epidemicTrackTemp) await cleanupQuietly(epidemicTrackTemp);
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
