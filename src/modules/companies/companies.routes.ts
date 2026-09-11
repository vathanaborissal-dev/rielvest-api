import { Router } from 'express';
import { asyncHandler } from '../../core/http.ts';
import * as controller from './companies.controller.ts';

export const companiesRouter: Router = Router();

// Ordered before `/:symbol` so these literal paths are not read as tickers.
companiesRouter.get('/sectors', asyncHandler(controller.sectors));
companiesRouter.get('/compare', asyncHandler(controller.compare));

companiesRouter.get('/', asyncHandler(controller.list));
companiesRouter.get('/:symbol', asyncHandler(controller.detail));
companiesRouter.get('/:symbol/quotes', asyncHandler(controller.quotes));
companiesRouter.get('/:symbol/chart', asyncHandler(controller.chart));
companiesRouter.get('/:symbol/quick-read', asyncHandler(controller.quickRead));
companiesRouter.get('/:symbol/analysis', asyncHandler(controller.analysis));
companiesRouter.get('/:symbol/levels', asyncHandler(controller.levels));
companiesRouter.get('/:symbol/plan', asyncHandler(controller.plan));

companiesRouter.get('/:symbol/decision-review', asyncHandler(controller.decisionReview));
