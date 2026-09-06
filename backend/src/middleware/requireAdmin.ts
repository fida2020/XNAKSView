import type { NextFunction, Request, Response } from 'express';

import { AppError } from '@/utils/AppError';

/**
 * Gate for every `/admin/*` route. Must run after `requireAuth` (which
 * populates `req.user` from a fresh DB read every request — see its own
 * comment on why that matters for enforcement to take effect immediately).
 *
 * `isAdmin` is a plain boolean on User, not a role/permission system —
 * deliberately minimal for Step 4. There is no endpoint that sets it; an
 * operator flips it directly in the database. That's a real limitation
 * (no admin-management UI, no granular permissions), not a shortcut dressed
 * up as a feature: it's the smallest thing that closes "any authenticated
 * user can act as admin" without inventing a fake privilege model.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    next(new AppError('FORBIDDEN', 'Admin access required'));
    return;
  }
  next();
}
