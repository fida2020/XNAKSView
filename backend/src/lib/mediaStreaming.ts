import type { NextFunction, Request, Response } from 'express';

import { storage } from '@/lib/storage';
import { AppError } from '@/utils/AppError';

/**
 * Serves a storage key as an HTTP response, with real Range support
 * (206 Partial Content) — needed for video scrubbing/seeking, harmless for
 * images. Shared by video files/thumbnails and LIVE thumbnails so there's
 * one place that knows how to turn a storage key into bytes on the wire.
 */
export async function streamAsset(
  req: Request,
  res: Response,
  next: NextFunction,
  key: string | null,
  contentType: string,
): Promise<void> {
  try {
    if (!key) {
      throw new AppError('NOT_FOUND', 'Asset not available yet');
    }

    const publicUrl = storage.getPublicUrl(key);
    if (publicUrl) {
      res.redirect(publicUrl);
      return;
    }

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const { sizeBytes } = await storage.read(key);
      const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${sizeBytes}`).end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : sizeBytes - 1;
      if (start >= sizeBytes || end >= sizeBytes || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${sizeBytes}`).end();
        return;
      }

      const { stream } = await storage.read(key, { start, end });
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${sizeBytes}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Content-Type', contentType);
      stream.pipe(res);
      return;
    }

    const { stream, sizeBytes } = await storage.read(key);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', sizeBytes);
    res.setHeader('Content-Type', contentType);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}
