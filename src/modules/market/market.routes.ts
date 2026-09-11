import { Router } from 'express';
import { asyncHandler } from '../../core/http.ts';
import * as controller from './market.controller.ts';

export const marketRouter: Router = Router();

marketRouter.get('/status', controller.status);
marketRouter.get('/digest', asyncHandler(controller.digest));
marketRouter.get('/briefing', asyncHandler(controller.briefing));
marketRouter.get('/overview', asyncHandler(controller.overview));
marketRouter.get('/index', asyncHandler(controller.indexSeries));
marketRouter.get('/periods', asyncHandler(controller.periods));
marketRouter.get('/levels', asyncHandler(controller.levelsBoard));
