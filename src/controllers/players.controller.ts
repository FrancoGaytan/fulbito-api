import { Request, Response } from 'express';
import { z } from 'zod';
import { PlayerModel } from '../models/players/player.model.js';
import { serializePlayer } from '../views/player.view.js';

const abilityKeys = [
  'goalkeeper',
  'running',
  'passes',
  'defense',
  'power',
  'scorer',
  'positionalUnderstanding',
] as const;

const createPlayerDto = z.object({
  name: z.string().min(1),
  abilities: z.array(
    z.object({
      key: z.enum(abilityKeys),
      value: z.number().int().min(0).max(10),
    })
  ),
});

export class PlayersController {
  static async create(req: Request, res: Response) {
    const data = createPlayerDto.parse(req.body);
    const player = await PlayerModel.create(data);
    res.status(201).json(serializePlayer(player));
  }

  static async list(_req: Request, res: Response) {
    const players = await PlayerModel.find().sort({ createdAt: -1 });
    res.json(players.map(serializePlayer));
  }
}
