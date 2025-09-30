import { Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { Player } from '../models/player.model.js'
import { normalizeAbilitiesInput } from '../utils/abilities.js'
import { Group } from '../models/group.model.js'
import { Match } from '../models/match.model.js'
import { Types } from 'mongoose'

export async function createPlayer(req: Request, res: Response) {
  try {
    const { name, nickname, abilities } = req.body as { name?: string; nickname?: string; abilities?: unknown }
    if (!name) return res.status(400).json({ message: 'name is required' })

  const normalized = normalizeAbilitiesInput(abilities)

    let initialRating = 1000
    if (normalized && Object.keys(normalized).length) {
      const scores = Object.values(normalized)
      const avg = scores.reduce((a, b) => a + (b || 0), 0) / scores.length
      initialRating = 1000 + (avg - 5) * 40
      if (initialRating < 800) initialRating = 800
      if (initialRating > 1250) initialRating = 1250
      initialRating = Math.round(initialRating)
    }

    const created = await Player.create({
      name,
      nickname,
      abilities: normalized,
      rating: initialRating,
      owner: (req as any).userId,
    } as any)

    return res.status(201).json(created)
  } catch (err) {
    return res.status(500).json({ message: 'Error creando jugador', error: (err as Error).message })
  }
}

export async function updateAbilities(req: Request, res: Response) {
  try {
    const { id } = req.params
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Id inválido' })

    const player = await Player.findById(id)
    if (!player) return res.status(404).json({ message: 'Jugador no encontrado' })

    const normalized = normalizeAbilitiesInput(req.body?.abilities)
    player.set('abilities', normalized)  // undefined = las borra
    await player.save()

    return res.json(player)
  } catch (err) {
    return res.status(500).json({ message: 'Error actualizando habilidades', error: (err as Error).message })
  }
}

export async function deletePlayer(req: Request, res: Response) {
  try {
    const { id } = req.params
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Id inválido' })
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })

    const player = await Player.findOne({ _id: id, owner: req.userId }).select('_id')
    if (!player) return res.status(404).json({ message: 'Jugador no encontrado' })

    const playerObjId = new Types.ObjectId(id)

    await Group.updateMany(
      { members: playerObjId },
      { $pull: { members: playerObjId } }
    )
    await Match.updateMany(
      { participants: playerObjId },
      { $pull: { participants: playerObjId } }
    )
    await Match.updateMany(
      { 'teams.players': playerObjId },
      { $pull: { 'teams.$[].players': playerObjId } }
    )
    await Match.updateMany(
      { 'feedback.playerId': playerObjId },
      { $pull: { feedback: { playerId: playerObjId } } }
    )
    await Player.deleteOne({ _id: id })

    return res.status(200).json({ message: 'Jugador eliminado' })
  } catch (err) {
    return res.status(500).json({ message: 'Error eliminando jugador', error: (err as Error).message })
  }
}
