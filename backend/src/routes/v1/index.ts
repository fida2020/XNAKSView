import { Router } from 'express';

import { healthRouter } from '@/routes/v1/health';

export const v1Router = Router();

v1Router.use(healthRouter);

// Future route groups mount here, e.g.:
// v1Router.use('/auth', authRouter);
// v1Router.use('/users', usersRouter);
// v1Router.use('/profiles', profilesRouter);
