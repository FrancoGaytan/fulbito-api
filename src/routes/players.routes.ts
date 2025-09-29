import { Router } from 'express'
import { Player } from '../models/player.model.js'
import { normalizeAbilitiesInput } from '../utils/abilities.js'
import { deletePlayer } from '../controllers/players.controller.js'

const router = Router()

// LISTAR mis jugadores (legacy)
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

// LISTAR TODOS los jugadores (para asignarse uno ya existente)
router.get('/players/all', async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'unauthorized' })
    const list = await Player.find({})
      .select('name nickname rating gamesPlayed userId owner')
      .sort({ name: 1 })
      .lean({ getters: true })
    return res.json(list)
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
    // Usa findOneAndUpdate con filtro userId inexistente para atomicidad
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
