// src/routes/groups.routes.ts
import { Router } from 'express'
import { requireGroupAccess, requireGroupOwner } from '../middlewares/groupAccess.js'
import {
  createGroup,
  listGroups,
  joinGroup,
  addPlayersToGroup,
  addPlayerToGroup,
  deleteGroup,
  getGroupDetail,
  listGroupPlayers,
  createGroupMembership,
  groupRanking,
  listMyMemberships,
} from '../controllers/groups.controller.js'
import { requireAuth } from '../middlewares/auth.js'

const router = Router()

router.get('/groups', requireAuth, listGroups)
router.get('/groups/:id', requireAuth, getGroupDetail)
router.get('/groups/:id/players', requireAuth, requireGroupAccess, listGroupPlayers)
router.get('/groups/:id/ranking', requireAuth, requireGroupAccess, groupRanking)
router.post('/groups/:id/memberships', requireAuth, requireGroupAccess, requireGroupOwner, createGroupMembership)
router.get('/me/memberships', requireAuth, listMyMemberships)
router.post('/groups', requireAuth, createGroup)

router.post('/groups/:id/join', requireAuth, joinGroup)
router.post('/groups/:id/players', requireAuth, addPlayersToGroup) // bulk
router.post('/groups/:id/player', requireAuth, addPlayerToGroup)   // single (compat)
router.delete('/groups/:id', requireAuth, deleteGroup)

export default router
