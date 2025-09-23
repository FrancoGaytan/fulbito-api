import { Router } from 'express';
import { GroupsController } from '../controllers/groups.controller.js';
import { asyncHandler } from '../middlewares/async.js';

export const groupsRouter = Router();

groupsRouter.get('/', asyncHandler(GroupsController.list));
groupsRouter.post('/', asyncHandler(GroupsController.create));
groupsRouter.post('/:groupId/players', asyncHandler(GroupsController.addPlayer));
groupsRouter.get('/:groupId/players', asyncHandler(GroupsController.members));