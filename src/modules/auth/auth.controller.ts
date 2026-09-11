import type { Request, Response } from 'express';
import { validate } from '../../core/http.ts';
import { currentUserId } from './auth.middleware.ts';
import {
  changePasswordSchema,
  credentialsSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  updateProfileSchema,
} from './auth.schema.ts';
import * as service from './auth.service.ts';

export async function register(req: Request, res: Response): Promise<void> {
  const body = validate(registerSchema, req.body, 'registration details');
  const session = await service.register({ ...body, userAgent: req.headers['user-agent'] });
  res.status(201).json(session);
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = validate(credentialsSchema, req.body, 'sign-in details');
  const session = await service.login({ ...body, userAgent: req.headers['user-agent'] });
  res.json(session);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const body = validate(refreshSchema, req.body, 'refresh request');
  const session = await service.refreshSession(body.refreshToken, req.headers['user-agent']);
  res.json(session);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const body = validate(logoutSchema, req.body ?? {}, 'logout request');
  await service.logout(body.refreshToken);
  res.status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json({ user: await service.getProfile(currentUserId(req)) });
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const body = validate(updateProfileSchema, req.body, 'profile update');
  res.json({ user: await service.updateProfile(currentUserId(req), body) });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const body = validate(changePasswordSchema, req.body, 'password change');
  await service.changePassword(currentUserId(req), body.currentPassword, body.newPassword);
  res.status(204).end();
}
