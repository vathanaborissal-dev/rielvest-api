import { z } from 'zod';

export const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  sector: z.string().trim().max(100).optional(),
  board: z.enum(['main', 'growth']).optional(),
});

export const symbolParamSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9.]+$/, 'A ticker contains only letters, digits and dots'),
});

export const compareQuerySchema = z.object({
  symbols: z
    .string()
    .trim()
    .min(1, 'List at least one ticker')
    .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
    .refine((list) => list.length >= 1 && list.length <= 6, {
      message: 'Compare between one and six companies at a time',
    }),
});

export const chartQuerySchema = z.object({
  interval: z.enum(['1m', '5m', '15m', '1h', '1d', '1w', '1mo']).default('1d'),
  range: z.enum(['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', 'max']).default('1y'),
});
