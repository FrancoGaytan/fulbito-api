import { Request, Response } from 'express'
import { Types } from 'mongoose'
import { Group } from '../models/group.model.js'
import { Player } from '../models/player.model.js'
import { GroupMembership } from '../models/groupMembership.model.js'

/** Helpers */
const isHexId = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s)

const toObjectId = (s: string) => new Types.ObjectId(s)

function getUserId(req: Request): string { return (req as any).userId as string }

/** Codigo corto alfanumérico para join */
function generateJoinCode(len = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/** Normaliza arreglos de IDs desde distintas claves y/o body como string */
function normalizeIdArray(body: any): string[] {
  let obj = body
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj) } catch { obj = {} }
  }

  const raw = Array.isArray(obj?.playerIds)
    ? obj.playerIds
    : Array.isArray(obj?.ids)
    ? obj.ids
    : Array.isArray(obj?.players)
    ? obj.players
    : []

  const unique = [...new Set(raw.map((x: any) => String(x)))]
  return unique.filter(isHexId)
}

/** Devuelve el _id del Player asociado al usuario logueado (por owner o userId reclamado) */
async function getMyPlayerId(userId: string): Promise<string | null> {
  const me = await Player.findOne({ $or: [ { owner: userId }, { userId } ] }).select('_id').lean()
  return me?._id ? String(me._id) : null
}

/** Crear grupo (vacío) */
export async function createGroup(req: Request, res: Response) {
  try {
    const { name } = req.body as { name: string }
    if (!name) return res.status(400).json({ message: 'name requerido' })

    const userId = getUserId(req)
    const group = await Group.create({ name, owner: userId, members: [], joinCode: generateJoinCode(), joinCodeUpdatedAt: new Date() })

    return res.status(201).json(group)
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Error creando grupo', error: (err as Error).message })
  }
}

/** Listar grupos (owner o miembro) */
export async function listGroups(req: Request, res: Response) {
  try {
    const userId = getUserId(req)
    const myPlayerId = await getMyPlayerId(userId)
    const criteria: any = myPlayerId
      ? { $or: [ { owner: userId }, { members: new Types.ObjectId(myPlayerId) } ] }
      : { owner: userId }
    const groups = await Group.find(criteria).lean()
    // Añadir flags
    const out = groups.map(g => ({
      ...g,
      isOwner: String(g.owner) === userId,
      isMember: !!(myPlayerId && (g.members as any[]).some(m => String(m) === myPlayerId)),
      canEdit: String(g.owner) === userId,
    }))
    return res.json(out)
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Error listando grupos', error: (err as Error).message })
  }
}

/** Detalle de grupo */
export async function getGroupDetail(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })
    const userId = getUserId(req)
    const myPlayerId = await getMyPlayerId(userId)
    const group = await Group.findById(groupId).lean()
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' })
    const isOwner = String(group.owner) === userId
    const isMember = !!(myPlayerId && (group.members as any[]).some(m => String(m) === myPlayerId))
    if (!isOwner && !isMember) return res.status(403).json({ message: 'Sin permiso' })
    return res.json({
      ...group,
      isOwner,
      isMember,
      canEdit: isOwner,
      joinCode: isOwner ? (group as any).joinCode : undefined,
    })
  } catch (err) {
    return res.status(500).json({ message: 'Error obteniendo grupo', error: (err as Error).message })
  }
}

/** Unirse al grupo */
export async function joinGroup(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })

    const { code } = req.body as { code?: string }
    const group = await Group.findById(groupId).select('owner members joinCode').lean()
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' })

    const userId = getUserId(req)
    const isOwner = String(group.owner) === userId
    // Owner puede omitir code, resto debe proveer y coincidir (case insensitive)
    if (!isOwner) {
      if (!code || !group.joinCode || group.joinCode.toUpperCase() !== code.toUpperCase()) {
        return res.status(400).json({ message: 'Código inválido' })
      }
    }

    const myPlayerId = await getMyPlayerId(userId)
    if (myPlayerId) {
      // Ya tiene player: crear membership si no existe y añadir a members
      await Group.findByIdAndUpdate(groupId, { $addToSet: { members: toObjectId(myPlayerId) } })
      // Upsert membership contextual
      await GroupMembership.findOneAndUpdate(
        { groupId: toObjectId(groupId), playerId: toObjectId(myPlayerId) },
        { $setOnInsert: { rating: 1000, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, role: 'member', status: 'active' } },
        { upsert: true, new: true }
      )
      const membership = await GroupMembership.findOne({ groupId, playerId: myPlayerId }).lean()
      return res.json({
        groupId,
        mode: 'attached-existing-player',
        playerId: myPlayerId,
        membership: membership && {
          groupId: String(membership.groupId),
            playerId: String(membership.playerId),
          rating: membership.rating,
          gamesPlayed: membership.gamesPlayed,
          wins: membership.wins,
          losses: membership.losses,
          draws: membership.draws,
        },
        membershipCreated: true,
      })
    }

    // Usuario sin player todavía -> listar placeholders unclaimed
    const playerIds = (group.members as any[]).map(m => toObjectId(String(m)))
    const players = await Player.find({ _id: { $in: playerIds }, userId: { $exists: false } })
      .select('name nickname')
      .lean()
    return res.json({
      groupId,
      mode: 'need-claim',
      unclaimed: players.map(p => ({ playerId: String(p._id), name: p.name, nickname: p.nickname }))
    })
  } catch (err) {
    return res.status(500).json({ message: 'Error en join', error: (err as Error).message })
  }
}

/** Unirse usando sólo el joinCode (sin conocer el id del grupo) */
export async function joinGroupByCode(req: Request, res: Response) {
  try {
    const { code } = req.body as { code?: string }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ message: 'code requerido' })
    }
    const norm = code.trim().toUpperCase()
    // Buscar grupo por código (ya es único y uppercased en schema)
    const group = await Group.findOne({ joinCode: norm }).select('_id joinCode').lean()
    if (!group) return res.status(400).json({ message: 'Código inválido' })
    // Reutilizamos la lógica existente seteando params y body normalizados
    ;(req as any).params = { ...(req as any).params, id: String(group._id) }
    ;(req as any).body = { ...(req as any).body, code: norm }
    return joinGroup(req, res)
  } catch (err) {
    return res.status(500).json({ message: 'Error en join-by-code', error: (err as Error).message })
  }
}

export async function claimPlayerInGroup(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })
    const { code, playerId } = req.body as { code?: string; playerId?: string }
    if (!isHexId(playerId)) return res.status(400).json({ message: 'playerId inválido' })
    const group = await Group.findById(groupId).select('owner members joinCode').lean()
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' })
    if (!code || !group.joinCode || group.joinCode.toUpperCase() !== code.toUpperCase()) {
      return res.status(400).json({ message: 'Código inválido' })
    }
    const userId = getUserId(req)
    const existingPlayer = await Player.findOne({ userId }).select('_id').lean()
    if (existingPlayer && String(existingPlayer._id) !== playerId) {
      return res.status(409).json({ message: 'Ya tenés un player asignado.', yourPlayerId: String(existingPlayer._id) })
    }
    // Validar placeholder pertenece al grupo y no está reclamado
    const inGroup = (group.members as any[]).some(m => String(m) === playerId)
    if (!inGroup) return res.status(404).json({ message: 'El player no pertenece al grupo' })
    const player = await Player.findById(playerId).lean()
    if (!player) return res.status(404).json({ message: 'Player no encontrado' })
    if ((player as any).userId) return res.status(409).json({ message: 'Player ya reclamado' })

    // Reclamar: set userId
    await Player.updateOne({ _id: playerId }, { $set: { userId } })
    // Upsert membership
    const membership = await GroupMembership.findOneAndUpdate(
      { groupId: toObjectId(groupId), playerId: toObjectId(playerId) },
      { $setOnInsert: { rating: 1000, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, role: 'member', status: 'active' } },
      { upsert: true, new: true }
    ).lean()
    return res.status(201).json({
      playerId,
      claimed: true,
      membership: membership && {
        groupId: String(membership.groupId),
        playerId: String(membership.playerId),
        rating: membership.rating,
        gamesPlayed: membership.gamesPlayed,
        wins: membership.wins,
        losses: membership.losses,
        draws: membership.draws,
      }
    })
  } catch (err) {
    return res.status(500).json({ message: 'Error reclamando player', error: (err as Error).message })
  }
}

export async function rotateJoinCode(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })
    const userId = getUserId(req)
    const group = await Group.findOne({ _id: groupId, owner: userId }).select('_id').lean()
    if (!group) return res.status(403).json({ message: 'Solo owner puede rotar código' })
    const newCode = generateJoinCode()
    await Group.updateOne({ _id: groupId }, { $set: { joinCode: newCode, joinCodeUpdatedAt: new Date() } })
    return res.json({ groupId, joinCode: newCode })
  } catch (err) {
    return res.status(500).json({ message: 'Error rotando código', error: (err as Error).message })
  }
}

/** Agregar varios players */
export async function addPlayersToGroup(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })

    const ids = normalizeIdArray(req.body)
    if (!ids.length) return res.status(400).json({ message: 'Ids inválidos' })

    const userId = getUserId(req)
    const owned = await Player.find({ _id: { $in: ids }, owner: userId })
      .select('_id')
      .lean()
    const ownedSet = new Set(owned.map(p => String(p._id)))

    //removed to allow adding any player, not just owned
 /*    const notOwned = ids.filter(id => !ownedSet.has(id))
    if (notOwned.length) {
      return res.status(403).json({
        message: 'Alguno de los jugadores no te pertenece',
        notOwned,
      })
    } */

    const updated = await Group.findByIdAndUpdate(
      groupId,
      { $addToSet: { members: { $each: ids.map(toObjectId) } } },
      { new: true }
    )

    if (!updated) return res.status(404).json({ message: 'Grupo no encontrado' })
    return res.json(updated)
  } catch (err) {
    return res.status(500).json({
      message: 'Error agregando jugadores',
      error: (err as Error).message,
    })
  }
}

/** Agregar un player */
export async function addPlayerToGroup(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    const { playerId } = req.body as { playerId?: string }

    if (!isHexId(groupId) || !isHexId(playerId)) {
      return res.status(400).json({ message: 'Ids inválidos' })
    }

    const userId = getUserId(req)
    const player = await Player.findOne({ _id: playerId, owner: userId })
      .select('_id')
      .lean()
    if (!player) {
      return res
        .status(403)
        .json({ message: 'El jugador no te pertenece o no existe' })
    }

    const updated = await Group.findByIdAndUpdate(
      groupId,
      { $addToSet: { members: toObjectId(playerId) } },
      { new: true }
    )
    if (!updated) return res.status(404).json({ message: 'Grupo no encontrado' })

    return res.status(200).json({ message: 'Jugador agregado', groupId, playerId })
  } catch (err) {
    return res.status(500).json({
      message: 'Error agregando jugador al grupo',
      error: (err as Error).message,
    })
  }
}

/** Eliminar grupo (solo owner) */
export async function deleteGroup(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })

    const userId = getUserId(req)
    const group = await Group.findOne({ _id: groupId, owner: userId }).select('_id')
  if (!group) return res.status(404).json({ message: 'Grupo no encontrado o no te pertenece' })
  await Group.deleteOne({ _id: groupId })
    return res.status(200).json({ message: 'Grupo eliminado' })
  } catch (err) {
    return res.status(500).json({ message: 'Error eliminando grupo', error: (err as Error).message })
  }
}

/** Listar jugadores (membership) de un grupo con rating contextual */
export async function listGroupPlayers(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })

    // Validar acceso: usuario debe ser owner o miembro
    const userId = getUserId(req)
    const myPlayerId = await getMyPlayerId(userId)
    const group = await Group.findById(groupId).select('owner members').lean()
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' })
    const isOwner = String(group.owner) === userId
    const isMember = !!(myPlayerId && (group.members as any[]).some(m => String(m) === myPlayerId))
    if (!isOwner && !isMember) return res.status(403).json({ message: 'Sin permiso' })

    // Buscar memberships (cuando exista adopción completa). Si aún no hay, fallback a members del group.
    const memberships = await GroupMembership.find({ groupId }).lean()
    let playerIds: string[]
    if (memberships.length) {
      playerIds = memberships.map(m => String(m.playerId))
    } else {
      // Fallback temporal usando array legacy group.members
      playerIds = (group.members as any[]).map(m => String(m))
    }
    const players = await Player.find({ _id: { $in: playerIds } }).lean()
    const playerMap = new Map(players.map(p => [String(p._id), p]))

    const items = (memberships.length ? memberships : playerIds.map(pid => ({ playerId: pid, rating: undefined, gamesPlayed: undefined } as any)))
      .map(m => {
        const pid = memberships.length ? String(m.playerId) : String(m.playerId || m)
        const base = playerMap.get(pid)
        if (!base) return null
        return {
          playerId: pid,
          name: base.name,
          nickname: base.nickname,
          rating: m.rating ?? 1000,
          gamesPlayed: m.gamesPlayed ?? 0,
          membershipId: m._id ? String(m._id) : null,
        }
      })
      .filter(Boolean)

    return res.json({ groupId, count: items.length, players: items })
  } catch (err) {
    return res.status(500).json({ message: 'Error listando jugadores del grupo', error: (err as Error).message })
  }
}

/** Crear/Invitar membership explícito (owner) */
export async function createGroupMembership(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    const { playerId, abilityOverrides, initialRating } = req.body as { playerId?: string, abilityOverrides?: Record<string, number>, initialRating?: number }
    if (!isHexId(groupId) || !isHexId(playerId)) {
      return res.status(400).json({ message: 'Ids inválidos' })
    }

    // Validar que el caller es owner del grupo
    const userId = getUserId(req)
    const group = await Group.findById(groupId).select('owner members').lean()
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' })
    if (String(group.owner) !== userId) return res.status(403).json({ message: 'Solo owner puede invitar/crear membership' })

    // Verificar player existe
    const player = await Player.findById(playerId).select('_id name').lean()
    if (!player) return res.status(404).json({ message: 'Player no encontrado' })

    // Upsert membership
    const payload: any = {}
    if (abilityOverrides && typeof abilityOverrides === 'object') payload.abilityOverrides = abilityOverrides
    if (typeof initialRating === 'number' && initialRating > 0) payload.rating = initialRating

    const membership = await GroupMembership.findOneAndUpdate(
      { groupId: new Types.ObjectId(groupId), playerId: new Types.ObjectId(playerId) },
      { $setOnInsert: { rating: 1000, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, role: 'member', status: 'active' }, $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()

    // Asegurar que el player figure en array legacy (para compat)
    await Group.updateOne({ _id: groupId }, { $addToSet: { members: new Types.ObjectId(playerId) } })

    return res.status(201).json({ message: 'Membership creado', membership })
  } catch (err) {
    return res.status(500).json({ message: 'Error creando membership', error: (err as Error).message })
  }
}

/** Ranking por grupo (ordenado por rating desc) */
export async function groupRanking(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })

    // Validar acceso (owner o miembro)
    const userId = getUserId(req)
    const myPlayerId = await getMyPlayerId(userId)
    const group = await Group.findById(groupId).select('owner members').lean()
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' })
    const isOwner = String(group.owner) === userId
    const isMember = !!(myPlayerId && (group.members as any[]).some(m => String(m) === myPlayerId))
    if (!isOwner && !isMember) return res.status(403).json({ message: 'Sin permiso' })

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)))
    const memberships = await GroupMembership.find({ groupId })
      .sort({ rating: -1, gamesPlayed: -1 })
      .limit(limit)
      .lean()

    const playerIds = memberships.map(m => m.playerId)
    const players = await Player.find({ _id: { $in: playerIds } }).select('name nickname rating gamesPlayed').lean()
    const pMap = new Map(players.map(p => [String(p._id), p]))

    const rows = memberships.map((m, idx) => {
      const p = pMap.get(String(m.playerId))
      return {
        position: idx + 1,
        playerId: String(m.playerId),
        name: p?.name,
        nickname: p?.nickname,
        rating: m.rating,
        gamesPlayed: m.gamesPlayed,
        wins: m.wins,
        losses: m.losses,
        draws: m.draws,
      }
    })

    return res.json({ groupId, count: rows.length, ranking: rows })
  } catch (err) {
    return res.status(500).json({ message: 'Error obteniendo ranking', error: (err as Error).message })
  }
}

/** Listar memberships del player del usuario */
export async function listMyMemberships(req: Request, res: Response) {
  try {
    const userId = getUserId(req)
    const myPlayerId = await getMyPlayerId(userId)
    if (!myPlayerId) return res.json({ count: 0, memberships: [] })

    const memberships = await GroupMembership.find({ playerId: myPlayerId }).lean()
    const groupIds = memberships.map(m => m.groupId)
    const groups = await Group.find({ _id: { $in: groupIds } }).select('name owner').lean()
    const gMap = new Map(groups.map(g => [String(g._id), g]))

    const rows = memberships.map(m => {
      const g = gMap.get(String(m.groupId))
      return {
        membershipId: String(m._id),
        groupId: String(m.groupId),
        groupName: g?.name,
        isOwner: g ? String(g.owner) === userId : false,
        rating: m.rating,
        gamesPlayed: m.gamesPlayed,
        wins: m.wins,
        losses: m.losses,
        draws: m.draws,
        role: m.role,
        status: m.status,
      }
    })

    return res.json({ playerId: myPlayerId, count: rows.length, memberships: rows })
  } catch (err) {
    return res.status(500).json({ message: 'Error listando memberships', error: (err as Error).message })
  }
}
