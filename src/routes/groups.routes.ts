import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { enforceOwnership } from '../middlewares/ownership.js';
import { Group } from '../models/group.model.js';
import * as ctrl from '../controllers/groups.controller.js';

const router = Router();

// Crear grupo
router.post('/', requireAuth, ctrl.createGroup);

// Listar grupos
router.get('/', requireAuth, ctrl.listGroups);

// Agregar player a un grupo
router.post('/:id/players', requireAuth, enforceOwnership(Group, 'id'), ctrl.addPlayerToGroup);

export default router;