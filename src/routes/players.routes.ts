import { Router } from 'express'
import { Types } from 'mongoose'
import { Player } from '../models/player.model.js'
import { Match } from '../models/match.model.js'
import { SpaceMembership } from '../models/space-membership.model.js'
import { SpacePlayer } from '../models/space-player.model.js'
import { normalizeAbilitiesInput } from '../utils/abilities.js'
import { deletePlayer } from '../controllers/players.controller.js'

const router = Router()

// LISTAR mis jugadores (legacy)
router.get('/players', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })

    const filter: any = { owner: req.userId }

    const list = await Player.find(filter)
      .sort({ name: 1 })
      .lean({ getters: true })

    return res.json(list)
  } catch (e) {
    next(e)
  }
})

// LISTAR TODOS los jugadores (para asignarse uno ya existente)
// Si hay un space activo, sólo muestra jugadores cuyos usuarios son miembros del space
// y sobreescribe rating/gamesPlayed con los datos per-space de SpacePlayer
router.get('/players/all', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })

    let filter: any = {}
    let spaceOid: Types.ObjectId | null = null

    if (req.spaceId) {
      spaceOid = new Types.ObjectId(req.spaceId)
      const memberships = await SpaceMembership.find({ spaceId: spaceOid }).select('userId').lean()
      const memberUserIds = memberships.map(m => m.userId)

      filter = {
        $or: [
          { userId: { $in: memberUserIds } },
          { userId: null, spaceId: spaceOid },
          { userId: { $exists: false }, spaceId: spaceOid },
        ],
      }
    }

    const players = await Player.find(filter)
      .select('name nickname rating gamesPlayed userId owner')
      .sort({ name: 1 })
      .lean({ getters: true })

    // Overlay per-space stats si existe SpacePlayer para este space
    if (spaceOid && players.length) {
      const userIds = players.map((p: any) => p.userId).filter(Boolean)
      const spaceStats = await SpacePlayer.find({
        spaceId: spaceOid,
        userId: { $in: userIds },
      }).select('userId rating gamesPlayed').lean()

      const statsMap = new Map(spaceStats.map(s => [s.userId.toString(), s]))

      const list = players.map((p: any) => {
        const stats = p.userId ? statsMap.get(p.userId.toString()) : undefined
        return {
          ...p,
          rating: stats?.rating ?? p.rating ?? 1000,
          gamesPlayed: stats?.gamesPlayed ?? p.gamesPlayed ?? 0,
        }
      })
      return res.json(list)
    }

    return res.json(players)
  } catch (e) { next(e) }
})

// OBTENER un jugador por id
// Nota: dejar este después de /players/all para que 'all' no sea tomado como :id
router.get('/players/:id', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })
    const { id } = req.params
    if (!id) return res.status(400).json({ message: 'id requerido' })
    const player = await Player.findById(id).lean({ getters: true })
    if (!player) return res.status(404).json({ message: 'player not found' })

    // Overlay per-space rating/gamesPlayed si hay spaceId activo
    let spaceRating: number | undefined
    let spaceGamesPlayed: number | undefined
    if (req.spaceId && (player as any).userId) {
      const sp = await SpacePlayer.findOne({
        spaceId: new Types.ObjectId(req.spaceId),
        userId: (player as any).userId,
      }).select('rating gamesPlayed').lean()
      if (sp) {
        spaceRating = sp.rating
        spaceGamesPlayed = sp.gamesPlayed
      }
    }

    const effectiveRating = spaceRating ?? (player as any).rating ?? 1000
    const effectiveGamesPlayed = spaceGamesPlayed ?? (player as any).gamesPlayed ?? 0

    // Estadísticas dinámicas (wins/losses/draws)
    try {
      const playerObjId = (player as any)._id
      const agg = await Match.aggregate([
        { $match: { 'teams.players': playerObjId, status: 'finalized', 'teams.0.score': { $exists: true }, ...( req.spaceId ? { spaceId: new Types.ObjectId(req.spaceId) } : {} ) } },
        { $project: { teams: 1 } },
        { $addFields: {
          playerTeam: { $first: { $filter: { input: '$teams', as: 't', cond: { $in: [ playerObjId, '$$t.players' ] } } } },
          otherTeam: { $first: { $filter: { input: '$teams', as: 't', cond: { $not: { $in: [ playerObjId, '$$t.players' ] } } } } }
        } },
        { $addFields: {
          outcome: {
            $switch: {
              branches: [
                { case: { $gt: [ '$playerTeam.score', '$otherTeam.score' ] }, then: 'win' },
                { case: { $lt: [ '$playerTeam.score', '$otherTeam.score' ] }, then: 'lose' },
              ],
              default: 'draw'
            }
          }
        } },
        { $group: {
          _id: null,
          wins: { $sum: { $cond: [ { $eq: [ '$outcome', 'win' ] }, 1, 0 ] } },
          losses: { $sum: { $cond: [ { $eq: [ '$outcome', 'lose' ] }, 1, 0 ] } },
          draws: { $sum: { $cond: [ { $eq: [ '$outcome', 'draw' ] }, 1, 0 ] } },
        } },
      ])
      const stats = agg[0] || { wins: 0, losses: 0, draws: 0 }
      return res.json({
        ...player,
        rating: effectiveRating,
        gamesPlayed: effectiveGamesPlayed,
        stats: { wins: stats.wins, losses: stats.losses, draws: stats.draws, total: stats.wins + stats.losses + stats.draws },
      })
    } catch (statsErr) {
      return res.json({ ...player, rating: effectiveRating, gamesPlayed: effectiveGamesPlayed, stats: { wins: 0, losses: 0, draws: 0, total: 0, error: 'stats_failed' } })
    }
  } catch (e) { next(e) }
})

// HISTORIAL DE ELO de un jugador (partidos finalizados con ratingChanges)
router.get('/players/:id/elo-history', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })
    const { id } = req.params
    if (!id) return res.status(400).json({ message: 'id requerido' })

    const playerObjId = new Types.ObjectId(id)

    const matchFilter: any = {
      status: 'finalized',
      'ratingChanges.playerId': playerObjId,
    }
    if (req.spaceId) matchFilter.spaceId = new Types.ObjectId(req.spaceId)

    const matches = await Match.find(matchFilter)
      .select('scheduledAt createdAt ratingChanges')
      .sort({ scheduledAt: 1, createdAt: 1 })
      .lean()

    const history = matches.map((m) => {
      const change = (m.ratingChanges ?? []).find(
        (rc) => rc.playerId.toString() === id
      )
      return {
        date: m.scheduledAt ?? m.createdAt,
        before: change?.before ?? null,
        after: change?.after ?? null,
        delta: change?.delta ?? null,
      }
    }).filter((h) => h.after !== null)

    return res.json(history)
  } catch (e) { next(e) }
})

// CREAR jugador (queda asociado al owner del token)
router.post('/players', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })

    const { name, nickname, abilities } = req.body as {
      name?: string
      nickname?: string
      abilities?: unknown
    }
    if (!name) return res.status(400).json({ message: 'name is required' })

    const normalized = normalizeAbilitiesInput(abilities)
    const created = await Player.create({
      name,
      nickname,
      abilities: normalized,
      owner: req.userId,
      spaceId: req.spaceId ?? null,
    })

    return res.status(201).json(created.toJSON())
  } catch (e) {
    next(e)
  }
})

// EDITAR perfil (nombre/nickname) — solo el dueño del player
router.patch('/players/:id/profile', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })
    const { name, nickname } = req.body as { name?: string; nickname?: string }
    if (!name?.trim()) return res.status(400).json({ message: 'name requerido' })
    const updated = await Player.findOneAndUpdate(
      { _id: req.params.id, $or: [{ owner: req.userId }, { userId: req.userId }] },
      { name: name.trim(), ...(nickname !== undefined ? { nickname: nickname.trim() || undefined } : {}) },
      { new: true, runValidators: true }
    ).lean({ getters: true })
    if (!updated) return res.status(404).json({ message: 'player not found' })
    return res.json(updated)
  } catch (e) { next(e) }
})

// Helper: verificar si el usuario actual es admin del space activo
async function isSpaceAdmin(userId: string, spaceId?: string): Promise<boolean> {
  if (!spaceId) return false
  const m = await SpaceMembership.findOne({
    spaceId: new Types.ObjectId(spaceId),
    userId: new Types.ObjectId(userId),
    role: 'admin',
  }).lean()
  return !!m
}

// ACTUALIZAR abilities (el jugador, su dueño, o admin del space activo)
router.patch('/players/:id/abilities', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })

    const normalized = normalizeAbilitiesInput(req.body?.abilities)
    const admin = await isSpaceAdmin(req.userId, req.spaceId)
    const ownerFilter = admin
      ? { _id: req.params.id }
      : { _id: req.params.id, $or: [ { owner: req.userId }, { userId: req.userId } ] }
    const updated = await Player.findOneAndUpdate(
      ownerFilter,
      { abilities: normalized },
      { new: true, runValidators: true }
    ).lean({ getters: true })

    if (!updated) return res.status(404).json({ message: 'player not found' })
    return res.json(updated)
  } catch (e) {
    next(e)
  }
})

// Alias más expresivo para edición de skills (mismo comportamiento)
router.patch('/players/:id/skills', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })
    const normalized = normalizeAbilitiesInput(req.body?.abilities)
    const admin = await isSpaceAdmin(req.userId, req.spaceId)
    const ownerFilter = admin
      ? { _id: req.params.id }
      : { _id: req.params.id, $or: [ { owner: req.userId }, { userId: req.userId } ] }
    const updated = await Player.findOneAndUpdate(
      ownerFilter,
      { abilities: normalized },
      { new: true, runValidators: true }
    ).lean({ getters: true })
    if (!updated) return res.status(404).json({ message: 'player not found' })
    return res.json(updated)
  } catch (e) { next(e) }
})

// ELIMINAR jugador y limpiarlo de grupos/matches
router.delete('/players/:id', async (req, res, next) => {
  try { return await deletePlayer(req, res) } catch (e) { next(e) }
})

// CLAIM: asociar usuario actual a un player que no tenga userId
router.post('/players/:id/claim', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })
    const { id } = req.params
    if (!id) return res.status(400).json({ message: 'id requerido' })
    const updated = await Player.findOneAndUpdate(
      { _id: id, userId: { $exists: false } },
      { $set: { userId: req.userId } },
      { new: true }
    ).lean({ getters: true })
    if (!updated) return res.status(409).json({ message: 'Player ya está asignado o no existe' })
    return res.json(updated)
  } catch (e) { next(e) }
})

// UNCLAIM: remover asociación del usuario actual (solo si él lo había reclamado)
router.post('/players/:id/unclaim', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })
    const { id } = req.params
    if (!id) return res.status(400).json({ message: 'id requerido' })

    // Solo si el player tiene userId === req.userId
    const updated = await Player.findOneAndUpdate(
      { _id: id, userId: req.userId },
      { $unset: { userId: '' } }, // remover el campo para respetar índice sparse unique
      { new: true }
    ).lean({ getters: true })

    if (!updated) return res.status(409).json({ message: 'No podés desvincular este player (no es tuyo o no existe)' })
    return res.json(updated)
  } catch (e) { next(e) }
})

export default router
