import type { Request, Response } from 'express';
import { validate } from '../../core/http.ts';
import { z } from 'zod';
import * as service from './market.service.ts';
import { getLevelsBoard } from './market.levels.ts';
import { getMarketStatus } from './market.status.ts';
import { buildBriefing } from './market.briefing.ts';
import { buildDigest } from './market.digest.ts';

const boardQuery = z.object({ board: z.enum(['main', 'growth', 'all']).default('all') });
const rangeQuery = z.object({ days: z.coerce.number().int().min(1).max(3650).optional() });

export async function overview(_req: Request, res: Response): Promise<void> {
  res.json(await service.getOverview());
}

export async function indexSeries(req: Request, res: Response): Promise<void> {
  const { days } = validate(rangeQuery, req.query, 'range');
  res.json({ series: await service.getIndexSeries(days) });
}

export async function periods(req: Request, res: Response): Promise<void> {
  const { board } = validate(boardQuery, req.query, 'board');
  res.json({ board, periods: await service.getPeriodSeries(board) });
}

export async function levelsBoard(_req: Request, res: Response): Promise<void> {
  res.json(await getLevelsBoard());
}

export function status(_req: Request, res: Response): void {
  res.json(getMarketStatus());
}

export async function briefing(_req: Request, res: Response): Promise<void> {
  res.json(await buildBriefing());
}

export async function digest(req: Request, res: Response): Promise<void> {
  const language = req.query.lang === 'km' ? 'km' : 'en';
  res.json(await buildDigest(language));
}
