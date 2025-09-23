import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Group } from '../models/group.model';
import { Player } from '../models/player.model';

export async function createGroup(req: Request, res: Response) {
  try {
    const { name } = req.body as { name: string };
    if (!name) return res.status(400).json({ message: 'name requerido' });

    const group = await Group.create({
      name,
      members: [],
      owner: req.userId, // ownership del token
    });

    return res.status(201).json(group);
  } catch (err) {
    return res.status(500).json({ message: 'Error creando grupo', error: (err as Error).message });
  }
}

export async function listGroups(req: Request, res: Response) {
  try {
    const groups = await Group.find({ owner: req.userId }).lean();
    return res.json(groups);
  } catch (err) {
    return res.status(500).json({ message: 'Error listando grupos', error: (err as Error).message });
  }
}

export async function addPlayerToGroup(req: Request, res: Response) {
  try {
    const groupId = req.params.id;
    const { playerId } = req.body as { playerId: string };

    if (
      !groupId ||
      !playerId ||
      !Types.ObjectId.isValid(groupId) ||
      !Types.ObjectId.isValid(playerId)
    ) {
      return res.status(400).json({ message: 'Ids inválidos' });
    }

    // Como la ruta usa enforceOwnership(Group), acá el grupo EXISTE y es del user.
    const group = await Group.findById(groupId).select('members owner');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });

    // Validar ownership del Player
    const player = await Player.findById(playerId).select('owner');
    if (!player) return res.status(404).json({ message: 'Jugador no encontrado' });
    if (player.owner.toString() !== req.userId) {
      return res.status(403).json({ message: 'El jugador no te pertenece' });
    }

    // Evitar duplicados
    const already = group.members.find(m => m.toString() === playerId);
    if (!already) {
      group.members.push(new Types.ObjectId(playerId));
      await group.save();
    }

    return res.status(200).json({ message: 'Jugador agregado', groupId, playerId });
  } catch (err) {
    return res.status(500).json({ message: 'Error agregando jugador al grupo', error: (err as Error).message });
  }
}
