import { Router } from 'express';

import { healthRouter } from '@/routes/v1/health';
import { authRouter } from '@/routes/v1/auth';
import { meRouter } from '@/routes/v1/me';
import { profileRouter } from '@/routes/v1/profile';

export const v1Router = Router();

v1Router.use(healthRouter);
v1Router.use(authRouter);
v1Router.use(meRouter);
v1Router.use(profileRouter);

// Future route groups mount here, e.g.:
// v1Router.use('/users', usersRouter);
