import { Router } from 'express'
import { Player } from '../models/player.model.js'
import { Match } from '../models/match.model.js'
import { Group } from '../models/group.model.js'
import { GroupMembership } from '../models/groupMembership.model.js'
import { normalizeAbilitiesInput } from '../utils/abilities.js'
import { deletePlayer } from '../controllers/players.controller.js'

const router = Router()

// LISTAR mis jugadores (legacy)
router.get('/players', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })

    const spaceId = (req.query.spaceId as string | undefined)?.trim()

    // Si viene spaceId => devolver sólo jugadores contextualizados a ese espacio (grupo)
    const isHex = (v: string) => /^[0-9a-fA-F]{24}$/.test(v)
    if (spaceId) {
      if (!isHex(spaceId)) return res.status(400).json({ message: 'spaceId inválido' })
      // Validar acceso (owner o miembro) usando Group + player del usuario
      const group = await Group.findById(spaceId).select('owner members').lean()
      if (!group) return res.status(404).json({ message: 'Espacio no encontrado' })

      const myPlayers = await Player.find({ $or: [ { owner: req.userId }, { userId: req.userId } ] }).select('_id').lean()
      const myPlayerIdSet = new Set(myPlayers.map(p => String(p._id)))
      const isOwner = String(group.owner) === String(req.userId)
      const isMember = (group.members as any[] || []).some(id => myPlayerIdSet.has(String(id)))
      if (!isOwner && !isMember) return res.status(403).json({ message: 'Sin permiso en el espacio' })

      // Obtener memberships de ese espacio
      const memberships = await GroupMembership.find({ groupId: spaceId }).lean()
      if (!memberships.length) return res.json([])
      const playerIds = memberships.map(m => m.playerId)
      const players = await Player.find({ _id: { $in: playerIds } }).select('name nickname userId owner').lean()
      const pMap = new Map(players.map(p => [String(p._id), p]))

      const list = memberships.map(m => {
        const p = pMap.get(String(m.playerId))
        if (!p) return null
        return {
          id: String(p._id),
          _id: p._id, // compat legacy
          name: p.name,
          nickname: (p as any).nickname,
          claimedByUserId: p.userId ? String(p.userId) : null,
          contextMembership: {
            membershipId: String(m._id),
            rating: m.rating,
            gamesPlayed: m.gamesPlayed,
            wins: m.wins,
            draws: m.draws,
            losses: m.losses,
          },
        }
      }).filter(Boolean)

      return res.json(list)
    }

    // Legacy (sin spaceId): devolver mis jugadores (owner) con stats agregadas multi-espacio
    const players = await Player.find({ owner: req.userId })
      .sort({ name: 1 })
      .lean({ getters: true })

    const ids = players.map(p => p._id)
    const membershipsAgg = await GroupMembership.aggregate([
      { $match: { playerId: { $in: ids } } },
      { $group: { _id: '$playerId', gamesPlayed: { $sum: '$gamesPlayed' }, wins: { $sum: '$wins' }, losses: { $sum: '$losses' }, draws: { $sum: '$draws' } } }
    ])
    const statsMap = new Map<string, any>(membershipsAgg.map(m => [String(m._id), m]))

    const out = players.map(p => {
      const s = statsMap.get(String(p._id))
      if (!s) return p
      const wins = s.wins || 0
      const losses = s.losses || 0
      const draws = s.draws || 0
      const derivedGames = s.gamesPlayed || (wins + losses + draws)
      const total = wins + losses + draws
      const winRate = total > 0 ? +(wins / total * 100).toFixed(1) : 0
      return { ...p, gamesPlayed: derivedGames, stats: { wins, losses, draws, total, winRate } }
    })

    return res.json(out)
  } catch (e) {
    next(e)
  }
})

// LISTAR TODOS los jugadores (para asignarse uno ya existente)
router.get('/players/all', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })
    const players = await Player.find({})
      .select('name nickname userId owner')
      .sort({ name: 1 })
      .lean({ getters: true })

    const ids = players.map(p => p._id)
    const membershipsAgg = await GroupMembership.aggregate([
      { $match: { playerId: { $in: ids } } },
      { $group: { _id: '$playerId', gamesPlayed: { $sum: '$gamesPlayed' }, wins: { $sum: '$wins' }, losses: { $sum: '$losses' }, draws: { $sum: '$draws' } } }
    ])
    const statsMap = new Map<string, any>(membershipsAgg.map(m => [String(m._id), m]))

    const out = players.map(p => {
      const s = statsMap.get(String(p._id))
      if (!s) return p
      const wins = s.wins || 0
      const losses = s.losses || 0
      const draws = s.draws || 0
      const derivedGames = s.gamesPlayed || (wins + losses + draws)
      const total = wins + losses + draws
      const winRate = total > 0 ? +(wins / total * 100).toFixed(1) : 0
      return { ...p, gamesPlayed: derivedGames, stats: { wins, losses, draws, total, winRate } }
    })
    return res.json(out)
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

    // Agregar estadísticas dinámicas (wins/losses/draws) sin modificar el schema.
    // Contamos sólo partidos FINALIZADOS donde el jugador estuvo en teams y tienen score.
    try {
      const playerObjId = (player as any)._id
      const agg = await Match.aggregate([
        { $match: { 'teams.players': playerObjId, status: 'finalized', 'teams.0.score': { $exists: true } } },
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
      // Intentar sobreescribir gamesPlayed con suma de memberships
      const membershipAgg = await GroupMembership.aggregate([
        { $match: { playerId: player._id } },
        { $group: { _id: '$playerId', gamesPlayed: { $sum: '$gamesPlayed' }, wins: { $sum: '$wins' }, losses: { $sum: '$losses' }, draws: { $sum: '$draws' } } }
      ])
      let contextualGames: number | undefined
      if (membershipAgg[0]) {
        const mg = membershipAgg[0]
        contextualGames = mg.gamesPlayed || (mg.wins + mg.losses + mg.draws)
      }
      return res.json({
        ...player,
        gamesPlayed: contextualGames ?? (stats.wins + stats.losses + stats.draws),
        stats: { wins: stats.wins, losses: stats.losses, draws: stats.draws, total: stats.wins + stats.losses + stats.draws }
      })
    } catch (statsErr) {
      return res.json({ ...player, stats: { wins: 0, losses: 0, draws: 0, total: 0, error: 'stats_failed' } })
    }
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
    })

    return res.status(201).json(created.toJSON())
  } catch (e) {
    next(e)
  }
})

// ACTUALIZAR abilities (solo si el jugador es tuyo)
router.patch('/players/:id/abilities', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })

    const normalized = normalizeAbilitiesInput(req.body?.abilities)
    const updated = await Player.findOneAndUpdate(
      { _id: req.params.id, $or: [ { owner: req.userId }, { userId: req.userId } ] },
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
    const updated = await Player.findOneAndUpdate(
      { _id: req.params.id, $or: [ { owner: req.userId }, { userId: req.userId } ] },
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
