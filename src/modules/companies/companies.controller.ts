import type { Request, Response } from 'express';
import { validate } from '../../core/http.ts';
import {
  chartQuerySchema,
  compareQuerySchema,
  listQuerySchema,
  symbolParamSchema,
} from './companies.schema.ts';
import * as service from './companies.service.ts';

export async function list(req: Request, res: Response): Promise<void> {
  const query = validate(listQuerySchema, req.query, 'filters');
  res.json({ companies: await service.list(query) });
}

export async function sectors(_req: Request, res: Response): Promise<void> {
  res.json({ sectors: await service.listSectors() });
}

export async function detail(req: Request, res: Response): Promise<void> {
  const { symbol } = validate(symbolParamSchema, req.params, 'ticker');
  const [company, quotes, periods, dividends] = await Promise.all([
    service.getBySymbol(symbol),
    service.getQuotes(symbol),
    service.getPeriods(symbol),
    service.getDividends(symbol),
  ]);
  res.json({ company, quotes, periods, dividends });
}

export async function quotes(req: Request, res: Response): Promise<void> {
  const { symbol } = validate(symbolParamSchema, req.params, 'ticker');
  res.json({ quotes: await service.getQuotes(symbol) });
}

export async function chart(req: Request, res: Response): Promise<void> {
  const { symbol } = validate(symbolParamSchema, req.params, 'ticker');
  const query = validate(chartQuerySchema, req.query, 'chart request');
  res.json(await service.getChart(symbol, query.interval, query.range));
}

export async function quickRead(req: Request, res: Response): Promise<void> {
  const { symbol } = validate(symbolParamSchema, req.params, 'ticker');
  res.json(await service.getQuickRead(symbol));
}

export async function analysis(req: Request, res: Response): Promise<void> {
  const { symbol } = validate(symbolParamSchema, req.params, 'ticker');
  const language = req.query.lang === 'km' ? 'km' : 'en';
  res.json({ analysis: await service.analyseWithNarrative(symbol, language) });
}

export async function levels(req: Request, res: Response): Promise<void> {
  const { symbol } = validate(symbolParamSchema, req.params, 'ticker');
  res.json({ levels: await service.getPriceLevels(symbol) });
}

export async function plan(req: Request, res: Response): Promise<void> {
  const { symbol } = validate(symbolParamSchema, req.params, 'ticker');
  res.json({ plan: await service.getTradePlan(symbol) });
}

export async function compare(req: Request, res: Response): Promise<void> {
  const { symbols } = validate(compareQuerySchema, req.query, 'comparison request');
  res.json({ analyses: await service.compare(symbols) });
}

export async function decisionReview(req: Request, res: Response): Promise<void> {
  const { symbol } = validate(symbolParamSchema, req.params, 'ticker');
  res.json({ review: await service.getDecisionReview(symbol) });
}
