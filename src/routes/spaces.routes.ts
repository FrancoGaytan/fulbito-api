import { Router } from 'express';
import * as ctrl from '../controllers/spaces.controller.js';

const router = Router();

// Spaces CRUD
router.get('/', ctrl.listMySpaces);
router.post('/', ctrl.createSpace);

// Join via invite code — ANTES que /:id para no ser capturado como id
router.post('/join', ctrl.joinSpace);

// Individual space routes
router.get('/:id', ctrl.getSpace);
router.patch('/:id', ctrl.updateSpace);
router.post('/:id/regenerate-code', ctrl.regenerateInviteCode);

// Members
router.get('/:id/members', ctrl.listSpaceMembers);

// My profile within a space
router.get('/:id/me', ctrl.getMySpaceProfile);
router.put('/:id/me', ctrl.upsertMySpaceProfile);

// All players in a space
router.get('/:id/players', ctrl.listSpacePlayers);

export default router;
