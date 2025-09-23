import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { enforceOwnership } from '../middlewares/ownership.js';
import { Player } from '../models/player.model.js';
import * as ctrl from '../controllers/players.controller.js';

const router = Router();

// Crear player
router.post('/', requireAuth, ctrl.createPlayer);

// Listar players
router.get('/', requireAuth, ctrl.listPlayers);

// Actualizar abilities de un player
router.patch('/:id/abilities', requireAuth, enforceOwnership(Player, 'id'), ctrl.updateAbilities);

export default router;
