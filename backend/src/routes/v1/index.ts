import { Router } from 'express';

import { healthRouter } from '@/routes/v1/health';
import { authRouter } from '@/routes/v1/auth';
import { meRouter } from '@/routes/v1/me';
import { profileRouter } from '@/routes/v1/profile';
import { videosRouter } from '@/routes/v1/videos';
import { feedRouter } from '@/routes/v1/feed';
import { followRouter } from '@/routes/v1/follow';
import { adminRouter } from '@/routes/v1/admin';

export const v1Router = Router();

v1Router.use(healthRouter);
v1Router.use(authRouter);
v1Router.use(meRouter);
v1Router.use(profileRouter);
v1Router.use(videosRouter);
v1Router.use(feedRouter);
v1Router.use(followRouter);
v1Router.use(adminRouter);
