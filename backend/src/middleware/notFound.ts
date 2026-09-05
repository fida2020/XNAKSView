import type { NextFunction, Request, Response } from 'express';

import { AppError } from '@/utils/AppError';

export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl}`));
}
