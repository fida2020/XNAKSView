import { createReadStream } from 'fs';
import { access, mkdir, rename, stat, unlink } from 'fs/promises';
import path from 'path';
import type { Readable } from 'stream';

import { env } from '@/config/env';

export interface ByteRange {
  start: number;
  end: number;
}

export interface StoredFileInfo {
  stream: Readable;
  sizeBytes: number;
  range?: ByteRange;
}

/**
 * Storage keys (not paths/URLs) are what the rest of the app deals with —
 * Video rows store keys, never filesystem paths or driver-specific detail.
 * Adding an object-storage/CDN driver later (S3, R2, ...) means implementing
 * this interface once; no caller changes.
 */
export interface LocalReadHandle {
  path: string;
  cleanup(): Promise<void>;
}

export interface StorageDriver {
  /** Moves a local file (e.g. multer's temp upload) into permanent storage under `key`. */
  putFromLocalPath(key: string, localPath: string): Promise<void>;
  read(key: string, range?: ByteRange): Promise<StoredFileInfo>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** A directly-fetchable URL for this key, or null if it must be proxied (e.g. local disk). */
  getPublicUrl(key: string): string | null;
  /**
   * A real filesystem path for tools (ffmpeg/ffprobe) that can't operate on
   * a generic stream. For local storage this is free (the file is already
   * on disk); a future remote driver (S3, ...) would download to a temp
   * file here and its `cleanup()` would delete that temp copy — callers
   * must always call `cleanup()` when done, regardless of driver.
   */
  getLocalReadPath(key: string): Promise<LocalReadHandle>;
}

function assertSafeKey(key: string): void {
  const normalized = path.normalize(key);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

class LocalStorageDriver implements StorageDriver {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    return path.join(this.baseDir, key);
  }

  async putFromLocalPath(key: string, localPath: string): Promise<void> {
    const destination = this.resolve(key);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await rename(localPath, destination);
    } catch (error) {
      // EXDEV: rename() can't cross filesystems/devices (common with temp
      // dirs on a different drive/volume than storage) — fall back to a
      // real copy in that case rather than failing the upload.
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        const { copyFile } = await import('fs/promises');
        await copyFile(localPath, destination);
        await unlink(localPath);
        return;
      }
      throw error;
    }
  }

  async read(key: string, range?: ByteRange): Promise<StoredFileInfo> {
    const filePath = this.resolve(key);
    const stats = await stat(filePath);
    const stream = createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
    return { stream, sizeBytes: stats.size, range };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  getPublicUrl(): null {
    // Local disk is never directly fetchable — the video-file route
    // (routes/v1/videos.ts) proxies/streams it instead.
    return null;
  }

  async getLocalReadPath(key: string): Promise<LocalReadHandle> {
    const filePath = this.resolve(key);
    return { path: filePath, cleanup: async () => {} };
  }
}

function createStorageDriver(): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case 'local':
      return new LocalStorageDriver(env.STORAGE_LOCAL_DIR);
    default:
      throw new Error(`Unsupported STORAGE_DRIVER: ${env.STORAGE_DRIVER as string}`);
  }
}

export const storage: StorageDriver = createStorageDriver();

export function videoOriginalKey(videoId: string, extension: string): string {
  return `videos/${videoId}/original${extension}`;
}

export function videoPlaybackKey(videoId: string): string {
  return `videos/${videoId}/playback.mp4`;
}

export function liveThumbnailKey(liveSessionId: string, extension: string): string {
  return `live/${liveSessionId}/thumbnail${extension}`;
}

export function voiceMessageKey(messageId: string, extension: string): string {
  return `messages/${messageId}/voice${extension}`;
}

export function videoThumbnailKey(videoId: string): string {
  return `videos/${videoId}/thumbnail.jpg`;
}
