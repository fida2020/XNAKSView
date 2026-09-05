import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

import type { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';

import { env } from '@/config/env';
import { AppError } from '@/utils/AppError';

const tempUploadDir = path.resolve(env.STORAGE_LOCAL_DIR, 'tmp');
if (!existsSync(tempUploadDir)) {
  mkdirSync(tempUploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tempUploadDir),
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: env.MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, callback) => {
    // A mimetype check alone is a cheap, spoofable first line of defense —
    // the real validation is `probeVideo` actually decoding the file
    // during upload handling (see routes/v1/videos.ts). This only rejects
    // content types that are unambiguously not video (images, text, PDFs,
    // ...); `application/octet-stream` is allowed through since many
    // clients (including some HTTP tooling) send it for any binary upload
    // when they can't determine a precise type.
    const isObviouslyNotVideo = /^(image|text|audio)\//.test(file.mimetype) || file.mimetype === 'application/pdf';
    if (isObviouslyNotVideo) {
      callback(new AppError('BAD_REQUEST', `Unsupported file type: ${file.mimetype}`));
      return;
    }
    callback(null, true);
  },
});

/** Wraps multer's `single()` so its errors flow through our normal AppError → HTTP mapping. */
export function uploadSingleVideo(fieldName: string) {
  const middleware = upload.single(fieldName);

  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          next(new AppError('BAD_REQUEST', `File exceeds the maximum upload size of ${env.MAX_UPLOAD_BYTES} bytes`));
          return;
        }
        next(new AppError('BAD_REQUEST', `Upload error: ${error.message}`));
        return;
      }

      next(error);
    });
  };
}
