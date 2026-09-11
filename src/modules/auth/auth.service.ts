import bcrypt from 'bcryptjs';
import { conflict, unauthorized } from '../../core/errors.ts';
import type { Currency, User } from '../../generated/prisma/client.ts';
import * as repository from './auth.repository.ts';
import { createRefreshToken, hashRefreshToken, signAccessToken } from './auth.tokens.ts';

const BCRYPT_COST = 12;

/** A bcrypt hash that matches nothing, used to keep sign-in timing uniform. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.9F1n8Y3Z1kZlKMr2n0h4T0O1kQ9lF0m';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  baseCurrency: Currency;
  createdAt: string;
}

export interface Session {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    baseCurrency: user.baseCurrency,
    createdAt: user.createdAt.toISOString(),
  };
}

async function issueSession(user: User, userAgent?: string): Promise<Session> {
  const refresh = createRefreshToken();
  await repository.storeRefreshToken({
    userId: user.id,
    tokenHash: refresh.hash,
    expiresAt: refresh.expiresAt,
    userAgent,
  });
  return {
    user: toPublicUser(user),
    accessToken: signAccessToken({ sub: user.id, email: user.email }),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt.toISOString(),
  };
}

export async function register(input: {
  email: string;
  password: string;
  displayName: string;
  userAgent?: string;
}): Promise<Session> {
  if (await repository.findUserByEmail(input.email)) {
    throw conflict('An account with that email already exists.');
  }
  const user = await repository.createUserWithDefaults({
    email: input.email,
    passwordHash: await bcrypt.hash(input.password, BCRYPT_COST),
    displayName: input.displayName,
  });
  return issueSession(user, input.userAgent);
}

export async function login(input: {
  email: string;
  password: string;
  userAgent?: string;
}): Promise<Session> {
  const user = await repository.findUserByEmail(input.email);

  // Always run a comparison so an unknown account and a wrong password take
  // the same amount of time and cannot be told apart.
  const matches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !matches) {
    throw unauthorized('That email and password combination is not correct.');
  }

  const updated = await repository.touchLastLogin(user.id);
  return issueSession(updated, input.userAgent);
}

export async function refreshSession(token: string, userAgent?: string): Promise<Session> {
  const stored = await repository.findLiveRefreshToken(hashRefreshToken(token));
  if (!stored) throw unauthorized('Your session has expired. Please sign in again.');

  const user = await repository.findUserById(stored.userId);
  if (!user) throw unauthorized();

  // Rotate: the presented token is retired as its replacement is issued.
  await repository.revokeRefreshTokenById(stored.id);
  return issueSession(user, userAgent);
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await repository.revokeRefreshToken(hashRefreshToken(token));
}

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await repository.findUserById(userId);
  if (!user) throw unauthorized();
  return toPublicUser(user);
}

export async function updateProfile(
  userId: string,
  patch: { displayName?: string; baseCurrency?: Currency },
): Promise<PublicUser> {
  return toPublicUser(await repository.updateUserProfile(userId, patch));
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await repository.findUserById(userId);
  if (!user) throw unauthorized();
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw unauthorized('Your current password is not correct.');
  }
  await repository.changePasswordAndRevoke(userId, await bcrypt.hash(newPassword, BCRYPT_COST));
}
