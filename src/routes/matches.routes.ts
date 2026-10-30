import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { enforceOwnership } from '../middlewares/ownership.js';
import { Match } from '../models/match.model.js';
import * as ctrl from '../controllers/matches.controller.js';

const router = Router();

// Crear un match
router.post('/', requireAuth, ctrl.createMatch);

// Listar matches de un grupo
router.get('/group/:id', requireAuth, ctrl.listMatchesByGroup);
router.get('/:id', requireAuth, ctrl.getMatch);

// Operaciones sobre un match puntual
router.post('/:id/participants', requireAuth, enforceOwnership(Match, 'id'), ctrl.addParticipant);
router.post('/:id/generate-teams', requireAuth, enforceOwnership(Match, 'id'), ctrl.generateTeams);
router.post('/:id/substitution', requireAuth, enforceOwnership(Match, 'id'), ctrl.substitutePlayer);
router.post('/:id/feedback', requireAuth, ctrl.addFeedback); // cualquier miembro podrá votar (validación interna)
router.get('/:id/vote-progress', requireAuth, ctrl.getVoteProgress);
router.get('/:id/my-votes', requireAuth, ctrl.getMyVotes);
router.post('/:id/finalize', requireAuth, enforceOwnership(Match, 'id'), ctrl.finalizeMatch);
router.patch('/:id/result', requireAuth, enforceOwnership(Match, 'id'), ctrl.updateResult);
router.post('/:id/result', requireAuth, enforceOwnership(Match, 'id'), ctrl.updateResult);
router.delete('/:id', requireAuth, enforceOwnership(Match, 'id'), ctrl.deleteMatch);
router.post('/:id/apply-ratings', requireAuth, enforceOwnership(Match, 'id'), ctrl.applyRatings);

export default router;
