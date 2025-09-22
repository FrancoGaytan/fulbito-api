import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { GroupModel } from './group.model.js';
import { PlayerModel } from '../players/player.model.js';

export const groupRouter = Router();

// 1) Crear grupo
groupRouter.post('/', async (req, res, next) => {
  try {
    const schema = z.object({ name: z.string().min(1) });
    const { name } = schema.parse(req.body);
    const group = await GroupModel.create({ name, members: [] });
    res.status(201).json(group);
  } catch (e) { next(e); }
});

// 2) Listar grupos
groupRouter.get('/', async (_req, res, next) => {
  try {
    const groups = await GroupModel.find().sort({ createdAt: -1 });
    res.json(groups);
  } catch (e) { next(e); }
});

// 3) Agregar jugador al grupo (creando o reusando)
groupRouter.post('/:groupId/players', async (req, res, next) => {
  try {
    const paramsSchema = z.object({ groupId: z.string().refine(Types.ObjectId.isValid) });
    const bodySchema = z.object({
      // si mandás playerId, lo reusa; si no, crea con estos datos
      playerId: z.string().optional(),
      name: z.string().min(1).optional(),
      skill: z.number().int().min(1).max(10).optional(),
      positions: z.array(z.string()).optional(),
    });

    const { groupId } = paramsSchema.parse(req.params);
    const payload = bodySchema.parse(req.body);
    const group = await GroupModel.findById(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    let playerId: Types.ObjectId;

    if (payload.playerId) {
      if (!Types.ObjectId.isValid(payload.playerId)) {
        return res.status(400).json({ error: 'Invalid playerId' });
      }
      playerId = new Types.ObjectId(payload.playerId);
      const exists = await PlayerModel.exists({ _id: playerId });
      if (!exists) return res.status(404).json({ error: 'Player not found' });
    } else {
      // creación rápida de jugador
      if (!payload.name || !payload.skill) {
        return res.status(400).json({ error: 'name and skill are required if no playerId' });
      }
      const player = await PlayerModel.create({
        name: payload.name,
        skill: payload.skill,
        positions: payload.positions ?? [],
      });
      playerId = player._id;
    }

    // evitar duplicados
    if (group.members.some((m) => m.equals(playerId))) {
      return res.status(409).json({ error: 'Player already in group' });
    }

    group.members.push(playerId);
    await group.save();

    const populated = await GroupModel.findById(groupId).populate('members');
    res.status(201).json(populated);
  } catch (e) { next(e); }
});

// 4) Listar jugadores del grupo
groupRouter.get('/:groupId/players', async (req, res, next) => {
  try {
    const paramsSchema = z.object({ groupId: z.string().refine(Types.ObjectId.isValid) });
    const { groupId } = paramsSchema.parse(req.params);
    const group = await GroupModel.findById(groupId).populate('members');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(group.members);
  } catch (e) { next(e); }
});
