import { Router } from 'express';
import { asyncHandler } from '../middlewares/async.js';
import { PlayersController } from '../controllers/players.controller.js';

export const playersRouter = Router();

playersRouter.get('/', asyncHandler(PlayersController.list));
playersRouter.post('/', asyncHandler(PlayersController.create));
