import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { requireMatchGroupAccess, requireGroupAccess } from '../middlewares/groupAccess.js';
import { enforceOwnership } from '../middlewares/ownership.js';
import { Match } from '../models/match.model.js';
import * as ctrl from '../controllers/matches.controller.js';

const router = Router();

// Crear un match
router.post('/', requireAuth, ctrl.createMatch);

// Listar matches de un grupo (ahora con scoping previo)
router.get('/group/:id', requireAuth, requireGroupAccess, ctrl.listMatchesByGroup);

// Operaciones sobre un match puntual
// Acciones sobre match: primero validar acceso al grupo del match; luego ownership donde aplica
router.post('/:id/participants', requireAuth, requireMatchGroupAccess, enforceOwnership(Match, 'id'), ctrl.addParticipant);
router.post('/:id/generate-teams', requireAuth, requireMatchGroupAccess, enforceOwnership(Match, 'id'), ctrl.generateTeams);
router.post('/:id/feedback', requireAuth, requireMatchGroupAccess, ctrl.addFeedback); // ahora exige pertenencia al grupo
router.get('/:id/vote-progress', requireAuth, requireMatchGroupAccess, ctrl.getVoteProgress);
router.get('/:id/my-votes', requireAuth, requireMatchGroupAccess, ctrl.getMyVotes);
router.post('/:id/finalize', requireAuth, requireMatchGroupAccess, enforceOwnership(Match, 'id'), ctrl.finalizeMatch);
router.patch('/:id/result', requireAuth, requireMatchGroupAccess, enforceOwnership(Match, 'id'), ctrl.updateResult);
router.post('/:id/result', requireAuth, requireMatchGroupAccess, enforceOwnership(Match, 'id'), ctrl.updateResult);
router.delete('/:id', requireAuth, requireMatchGroupAccess, enforceOwnership(Match, 'id'), ctrl.deleteMatch);
router.post('/:id/apply-ratings', requireAuth, requireMatchGroupAccess, enforceOwnership(Match, 'id'), ctrl.applyRatings);

export default router;
