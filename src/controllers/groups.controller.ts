import { Request, Response } from 'express'
import { Types } from 'mongoose'
import { Group } from '../models/group.model.js'
import { Player } from '../models/player.model.js'

/** Helpers */
const isHexId = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s)

const toObjectId = (s: string) => new Types.ObjectId(s)

function getUserId(req: Request): string {
  // tu middleware ya setea req.userId (string)
  return (req as any).userId as string
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

/** Devuelve el _id del Player asociado al usuario logueado (owner = userId) */
async function getMyPlayerId(userId: string): Promise<string | null> {
  const me = await Player.findOne({ owner: userId }).select('_id').lean()
  return me?._id ? String(me._id) : null
}

/** Crea un grupo y agrega automáticamente al Player del usuario (si existe) */
export async function createGroup(req: Request, res: Response) {
  try {
    const { name } = req.body as { name: string }
    if (!name) return res.status(400).json({ message: 'name requerido' })

    const userId = getUserId(req)
    const myPlayerId = await getMyPlayerId(userId)

    const group = await Group.create({
      name,
      owner: userId,
      members: myPlayerId ? [toObjectId(myPlayerId)] : [],
    })

    return res.status(201).json(group)
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Error creando grupo', error: (err as Error).message })
  }
}

/** Lista los grupos del usuario (owner) */
export async function listGroups(req: Request, res: Response) {
  try {
    const groups = await Group.find({ owner: getUserId(req) }).lean()
    return res.json(groups)
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Error listando grupos', error: (err as Error).message })
  }
}

/** El usuario logueado se une (self-join) al grupo */
export async function joinGroup(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })

    const userId = getUserId(req)
    const myPlayerId = await getMyPlayerId(userId)
    if (!myPlayerId) return res.status(400).json({ message: 'No hay Player asociado al usuario' })

    const updated = await Group.findByIdAndUpdate(
      groupId,
      { $addToSet: { members: toObjectId(myPlayerId) } },
      { new: true }
    )
    if (!updated) return res.status(404).json({ message: 'Grupo no encontrado' })
    return res.json(updated)
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Error al unirse al grupo', error: (err as Error).message })
  }
}

/** Bulk add: agrega varios players (por id) al grupo del usuario */
export async function addPlayersToGroup(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    if (!isHexId(groupId)) return res.status(400).json({ message: 'groupId inválido' })

    // IDs desde playerIds | ids | players (y acepta body string)
    const ids = normalizeIdArray(req.body)
    if (!ids.length) return res.status(400).json({ message: 'Ids inválidos' })

    // (opcional) Validar ownership de cada Player (que te pertenezcan)
    const userId = getUserId(req)
    const owned = await Player.find({ _id: { $in: ids }, owner: userId })
      .select('_id')
      .lean()
    const ownedSet = new Set(owned.map(p => String(p._id)))

    const notOwned = ids.filter(id => !ownedSet.has(id))
    if (notOwned.length) {
      return res.status(403).json({
        message: 'Alguno de los jugadores no te pertenece',
        notOwned,
      })
    }

    // Update con $addToSet para evitar duplicados
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

/** Compat: agrega UN player (body: { playerId }) usando la misma validación */
export async function addPlayerToGroup(req: Request, res: Response) {
  try {
    const groupId = String(req.params.id)
    const { playerId } = req.body as { playerId?: string }

    if (!isHexId(groupId) || !isHexId(playerId)) {
      return res.status(400).json({ message: 'Ids inválidos' })
    }

    // Reusa la validación de ownership
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
