// src/controllers/players.controller.ts
import { Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { Player } from '../models/player.model.js'
import { normalizeAbilitiesInput } from '../utils/abilities'

// Crear jugador (acepta array viejo o objeto nuevo)
export async function createPlayer(req: Request, res: Response) {
  try {
    const { name, nickname, abilities } = req.body
    if (!name) return res.status(400).json({ message: 'name is required' })

    const normalized = normalizeAbilitiesInput(abilities) // { key: score } | undefined
    const created = await Player.create({
      name,
      nickname,
      abilities: normalized, // Mongoose guarda como Map
    })

    return res.status(201).json(created) // toJSON ya debe tener flattenMaps
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
