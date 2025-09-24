import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Player as PlayerModel } from '../models/player.model.js';

export async function createPlayer(req: Request, res: Response) {
  try {
    const { name, abilities } = req.body as { name: string; abilities?: string[] };
    if (!name) return res.status(400).json({ message: 'name requerido' });

    const player = await PlayerModel.create({
      name,
      abilities: Array.isArray(abilities) ? abilities : [],
      rating: 1000,
      ratingHistory: [],
      skillHistory: [],
      owner: req.userId!, // <- del token
    });

    return res.status(201).json(player);
  } catch (err) {
    return res.status(500).json({ message: 'Error creando jugador', error: (err as Error).message });
  }
}

export async function listPlayers(req: Request, res: Response) {
  try {
    const players = await PlayerModel.find({ owner: req.userId }).lean();
    return res.json(players);
  } catch (err) {
    return res.status(500).json({ message: 'Error listando jugadores', error: (err as Error).message });
  }
}

export async function updateAbilities(req: Request, res: Response) {
  try {
    // 1) Narrow de params
    const { id } = req.params as { id?: string };
    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Id inválido' });
    }

    // 2) Narrow del body
    const body = req.body as { abilities?: unknown };
    if (!Array.isArray(body.abilities) || !body.abilities.every(a => typeof a === 'string')) {
      return res.status(400).json({ message: 'abilities debe ser array de string' });
    }
    const abilities = body.abilities as string[];

    // 3) La route ya usa enforceOwnership(Player) → el player es del user
    const player = await PlayerModel.findById(id);
    if (!player) return res.status(404).json({ message: 'Jugador no encontrado' });

    player.abilities = abilities;
    await player.save();

    return res.json(player);
  } catch (err) {
    return res.status(500).json({ message: 'Error actualizando habilidades', error: (err as Error).message });
  }
}
