import { prisma } from '../../core/prisma.ts';
import type { Currency, User } from '../../generated/prisma/client.ts';

export function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Creates the account together with its default watchlist.
 *
 * Provisioning both records in one transaction means a half-provisioned user
 * can never exist.
 */
export function createUserWithDefaults(input: {
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<User> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
      },
    });
    await tx.watchlist.create({
      data: { userId: user.id, name: 'My Watchlist', isDefault: true },
    });
    return user;
  });
}

export function touchLastLogin(userId: string): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

export function updateUserProfile(
  userId: string,
  data: { displayName?: string; baseCurrency?: Currency },
): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data });
}

export function storeRefreshToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | undefined;
}): Promise<{ id: string }> {
  return prisma.refreshToken.create({
    data: {
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
    },
    select: { id: true },
  });
}

export function findLiveRefreshToken(tokenHash: string) {
  return prisma.refreshToken.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true },
  });
}

export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeRefreshTokenById(id: string): Promise<void> {
  await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

/** Used when a password changes: every other device must sign in again. */
export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function changePasswordAndRevoke(userId: string, passwordHash: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
