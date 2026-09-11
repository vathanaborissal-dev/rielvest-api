import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.email('Enter a valid email address').max(200).trim().toLowerCase(),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});

export const registerSchema = credentialsSchema.extend({
  displayName: z.string().min(1, 'Tell us what to call you').max(80).trim(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'A refresh token is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export const updateProfileSchema = z
  .object({
    displayName: z.string().min(1).max(80).trim().optional(),
    baseCurrency: z.enum(['KHR', 'USD']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type CredentialsInput = z.infer<typeof credentialsSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
