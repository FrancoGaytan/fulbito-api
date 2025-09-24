import { Router } from 'express'
import { Player } from '../models/player.model'
import { normalizeAbilitiesInput } from '../utils/abilities'

const router = Router()

router.get('/players', async (_req, res, next) => {
  try {
    const list = await Player.find().lean({ getters: true })
    return res.json(list)
  } catch (e) {
    next(e)
  }
})

router.post('/players', async (req, res, next) => {
  try {
    const { name, nickname, abilities } = req.body
    if (!name) return res.status(400).json({ message: 'name is required' })

    const normalized = normalizeAbilitiesInput(abilities)
    const created = await Player.create({ name, nickname, abilities: normalized })
    return res.status(201).json(created.toJSON())
  } catch (e) {
    next(e)
  }
})

router.patch('/players/:id/abilities', async (req, res, next) => {
  try {
    const normalized = normalizeAbilitiesInput(req.body?.abilities)
    const updated = await Player.findByIdAndUpdate(
      req.params.id,
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
