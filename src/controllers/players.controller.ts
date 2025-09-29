// src/controllers/players.controller.ts
import { Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { Player } from '../models/player.model.js'
import { normalizeAbilitiesInput } from '../utils/abilities.js'
import { Group } from '../models/group.model.js'
import { Match } from '../models/match.model.js'
import { Types } from 'mongoose'

// Crear jugador (acepta array viejo o objeto nuevo)
export async function createPlayer(req: Request, res: Response) {
  try {
    const { name, nickname, abilities } = req.body as { name?: string; nickname?: string; abilities?: unknown }
    if (!name) return res.status(400).json({ message: 'name is required' })

    const normalized = normalizeAbilitiesInput(abilities) // { key: score } | undefined

    // Calcular rating inicial basado en average de abilities si vienen
    let initialRating = 1000
    if (normalized && Object.keys(normalized).length) {
      const scores = Object.values(normalized)
      const avg = scores.reduce((a, b) => a + (b || 0), 0) / scores.length
      // Fórmula: 1000 + (avg - 5) * 40  (avg 5 =>1000, avg10=>1200, avg1=>840)
      initialRating = 1000 + (avg - 5) * 40
      // Clamp
      if (initialRating < 800) initialRating = 800
      if (initialRating > 1250) initialRating = 1250
      initialRating = Math.round(initialRating)
    }

    const created = await Player.create({
      name,
      nickname,
      abilities: normalized, // Mongoose guarda como Map
      rating: initialRating,
      owner: (req as any).userId, // por consistencia con rutas que usan owner
    } as any)

    return res.status(201).json(created)
  } catch (err) {
    return res.status(500).json({ message: 'Error creando jugador', error: (err as Error).message })
  }
}

// PATCH /players/:id/abilities
export async function updateAbilities(req: Request, res: Response) {
  try {
    const { id } = req.params
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Id inválido' })

    const player = await Player.findById(id)
    if (!player) return res.status(404).json({ message: 'Jugador no encontrado' })

    // ✅ acepta { defense: 8, passes: 7 } o ['defense', 'passes'] y lo mapea
    const normalized = normalizeAbilitiesInput(req.body?.abilities)

    // 👉 Usá set() para evitar el error de TS (Map vs objeto)
    player.set('abilities', normalized)  // undefined = las borra
    await player.save()

    return res.json(player)
  } catch (err) {
    return res.status(500).json({ message: 'Error actualizando habilidades', error: (err as Error).message })
  }
}

// DELETE /players/:id  (elimina jugador y lo quita de grupos y matches)
export async function deletePlayer(req: Request, res: Response) {
  try {
    const { id } = req.params
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Id inválido' })
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })

    // Verificamos ownership del jugador
    const player = await Player.findOne({ _id: id, owner: req.userId }).select('_id')
    if (!player) return res.status(404).json({ message: 'Jugador no encontrado' })

    const playerObjId = new Types.ObjectId(id)

    // 1) Quitar de grupos (members)
    await Group.updateMany(
      { members: playerObjId },
      { $pull: { members: playerObjId } }
    )

    // 2) Quitar de matches: participants, teams[].players, feedback[].playerId
    // participants
    await Match.updateMany(
      { participants: playerObjId },
      { $pull: { participants: playerObjId } }
    )
    // teams.players
    await Match.updateMany(
      { 'teams.players': playerObjId },
      { $pull: { 'teams.$[].players': playerObjId } }
    )
    // feedback
    await Match.updateMany(
      { 'feedback.playerId': playerObjId },
      { $pull: { feedback: { playerId: playerObjId } } }
    )

    // 3) Borrar jugador
    await Player.deleteOne({ _id: id })

    return res.status(200).json({ message: 'Jugador eliminado' })
  } catch (err) {
    return res.status(500).json({ message: 'Error eliminando jugador', error: (err as Error).message })
  }
}
