import { Router } from 'express';
import { asyncHandler } from '../../core/http.ts';
import * as controller from './auth.controller.ts';
import { requireAuth } from './auth.middleware.ts';

export const authRouter: Router = Router();

authRouter.post('/register', asyncHandler(controller.register));
authRouter.post('/login', asyncHandler(controller.login));
authRouter.post('/refresh', asyncHandler(controller.refresh));
authRouter.post('/logout', asyncHandler(controller.logout));

authRouter.get('/me', requireAuth, asyncHandler(controller.me));
authRouter.patch('/me', requireAuth, asyncHandler(controller.updateMe));
authRouter.post('/change-password', requireAuth, asyncHandler(controller.changePassword));
