import { Router } from 'express'
import { Player } from '../models/player.model.js'
import { normalizeAbilitiesInput } from '../utils/abilities.js'

const router = Router()

// LISTAR mis jugadores
router.get('/players', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })

    const list = await Player.find({ owner: req.userId })
      .sort({ name: 1 })
      .lean({ getters: true })

    return res.json(list)
  } catch (e) {
    next(e)
  }
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
      { _id: req.params.id, owner: req.userId },
      { abilities: normalized },
      { new: true, runValidators: true }
    ).lean({ getters: true })

    if (!updated) return res.status(404).json({ message: 'player not found' })
    return res.json(updated)
  } catch (e) {
    next(e)
  }
})

export default router
