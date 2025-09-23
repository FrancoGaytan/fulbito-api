import { Router } from 'express';
import { asyncHandler } from '../middlewares/async.js';
import { MatchesController } from '../controllers/matches.controller.js';

export const matchesRouter = Router();

// CRUD mínimo
matchesRouter.post('/', asyncHandler(MatchesController.create));
matchesRouter.get('/group/:groupId', asyncHandler(MatchesController.listByGroup));
matchesRouter.post('/:matchId/participants', asyncHandler(MatchesController.addParticipant));

// Armar equipos
matchesRouter.post('/:matchId/generate-teams', asyncHandler(MatchesController.generateTeams));

// Feedback y finalizar
matchesRouter.post('/:matchId/feedback', asyncHandler(MatchesController.feedback));
matchesRouter.post('/:matchId/finalize', asyncHandler(MatchesController.finalize));
