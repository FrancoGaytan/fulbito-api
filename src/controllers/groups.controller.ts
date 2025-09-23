import { Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { GroupModel } from '../models/groups/group.model.js';
import { PlayerModel } from '../models/players/player.model.js';
import { serializeGroup } from '../views/group.view.js';

export class GroupsController {
  static async create(req: Request, res: Response) {
    const schema = z.object({ name: z.string().min(1) });
    const { name } = schema.parse(req.body);
    const group = await GroupModel.create({ name, members: [] });
    res.status(201).json(serializeGroup(group));
  }

  static async list(_req: Request, res: Response) {
    const groups = await GroupModel.find().sort({ createdAt: -1 });
    res.json(groups.map(serializeGroup));
  }

  static async addPlayer(req: Request, res: Response) {
    const params = z.object({ groupId: z.string().refine(Types.ObjectId.isValid) });
    const body = z.object({
      playerId: z.string().optional(),
      name: z.string().min(1).optional(),
      abilities: z.array(
        z.object({
          key: z.enum([
            'goalkeeper','running','passes','defense','power','scorer','positionalUnderstanding'
          ] as const),
          value: z.number().int().min(0).max(10),
        })
      ).optional(),
    });

    const { groupId } = params.parse(req.params);
    const payload = body.parse(req.body);

    const group = await GroupModel.findById(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    let playerId: Types.ObjectId;

    if (payload.playerId) {
      playerId = new Types.ObjectId(payload.playerId);
      const exists = await PlayerModel.exists({ _id: playerId });
      if (!exists) return res.status(404).json({ error: 'Player not found' });
    } else {
      if (!payload.name || !payload.abilities)
        return res.status(400).json({ error: 'name and abilities are required if no playerId' });

      const player = await PlayerModel.create({
        name: payload.name,
        abilities: payload.abilities,
      });
      playerId = player._id;
    }

    if (group.members.some((m) => m.equals(playerId))) {
      return res.status(409).json({ error: 'Player already in group' });
    }

    group.members.push(playerId);
    await group.save();

    const populated = await GroupModel.findById(groupId).populate('members');
    res.status(201).json(serializeGroup(populated as any));
  }

  static async members(req: Request, res: Response) {
    const params = z.object({ groupId: z.string().refine(Types.ObjectId.isValid) });
    const { groupId } = params.parse(req.params);
    const group = await GroupModel.findById(groupId).populate('members');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(serializeGroup(group as any).members ?? []);
  }
}
