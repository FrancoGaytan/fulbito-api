import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Match as MatchModel } from '../models/match.model.js';
import { Group as GroupModel } from '../models/group.model.js';
import { Player as PlayerModel } from '../models/player.model.js';

function generateBalancedTeams(
  participants: { _id: string; rating: number }[],
) {
  const sorted = [...participants].sort((a, b) => b.rating - a.rating);
  const teamA: string[] = [];
  const teamB: string[] = [];
  let sumA = 0,
    sumB = 0;
  for (const p of sorted) {
    if (sumA <= sumB) {
      teamA.push(p._id);
      sumA += p.rating;
    } else {
      teamB.push(p._id);
      sumB += p.rating;
    }
  }
  return { teamA, teamB };
}

export async function createMatch(req: Request, res: Response) {
  try {
    // Narrow del body
    const body = req.body as {
      groupId?: string;
      participants?: unknown;
      scheduledAt?: unknown;
    };
    const groupId = body.groupId;
    if (!groupId || !Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ message: 'groupId inválido' });
    }

    // participants opcional pero si viene debe ser string[] y ObjectId
    const partIds: string[] =
      Array.isArray(body.participants) &&
      body.participants.every((p) => typeof p === 'string')
        ? (body.participants as string[])
        : [];
    const partIdsClean = [...new Set(partIds.map(String))]; // únicos

    // Validar que el grupo exista y sea del usuario
    const group = await GroupModel.findById(groupId).select('owner members');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });
    if (group.owner.toString() !== req.userId) {
      return res.status(403).json({ message: 'No podés usar ese grupo' });
    }

    // Si hay participantes, deben pertenecer al grupo
    if (partIdsClean.length) {
      const setMembers = new Set(
        (group.members ?? []).map((m) => m.toString()),
      );
      const outside = partIdsClean.filter(
        (id) => !Types.ObjectId.isValid(id) || !setMembers.has(id),
      );
      if (outside.length) {
        return res.status(400).json({
          message: 'Todos los participantes deben pertenecer al grupo',
          fueraDelGrupo: outside,
        });
      }
    }

    const rawDate =
      (body as any).scheduledAt ??
      (body as any).date ??
      (body as any).when;

    let when: Date | undefined = undefined;
    if (
      rawDate !== undefined &&
      rawDate !== null &&
      String(rawDate).trim() !== ''
    ) {
      const d = new Date(String(rawDate));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'scheduledAt inválido' });
      }
      when = d;
    }

    const match = await MatchModel.create({
      groupId: new Types.ObjectId(groupId),
      participants: partIds.map((id) => new Types.ObjectId(id)),
      teams: [],
      feedback: [],
      result: undefined,
      status: 'pending',
      owner: req.userId!,
       ...(when ? { scheduledAt: when } : {}),
    });

    return res.status(201).json(match);
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Error creando match', error: (err as Error).message });
  }
}

export async function listMatchesByGroup(req: Request, res: Response) {
  try {
    const { id: groupId } = req.params as { id?: string };
    if (!groupId || !Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }

    const group = await GroupModel.findById(groupId).select('owner');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });
    if (group.owner.toString() !== req.userId)
      return res.status(403).json({ message: 'Sin permiso' });

    const matches = await MatchModel.find({
      groupId,
      owner: req.userId,
    }).lean();
    return res.json(matches);
  } catch (err) {
    return res.status(500).json({
      message: 'Error listando matches',
      error: (err as Error).message,
    });
  }
}

export async function addParticipant(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    const { playerId } = req.body as { playerId?: string };

    if (
      !matchId ||
      !Types.ObjectId.isValid(matchId) ||
      !playerId ||
      !Types.ObjectId.isValid(playerId)
    ) {
      return res.status(400).json({ message: 'Ids inválidos' });
    }

    // La ruta usa enforceOwnership(Match) -> el match es del user
    const match = await MatchModel.findById(matchId).select('groupId');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    // Validar que el player pertenezca al grupo del match
    const group = await GroupModel.findById(match.groupId).select('members');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });

    const isMember = (group.members ?? []).some(
      (m) => m.toString() === playerId,
    );
    if (!isMember) {
      return res
        .status(400)
        .json({ message: 'El jugador no pertenece al grupo del match' });
    }

    const updated = await MatchModel.findByIdAndUpdate(
      matchId,
      { $addToSet: { participants: new Types.ObjectId(playerId) } },
      { new: true },
    );

    if (!updated)
      return res.status(404).json({ message: 'Match no encontrado' });
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({
      message: 'Error agregando participante',
      error: (err as Error).message,
    });
  }
}

export async function generateTeams(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }

    // Ruta usa enforceOwnership(Match)
    const match = await MatchModel.findById(matchId)
      .populate('participants', 'rating')
      .select('participants teams status');

    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    const participantsRatings = (
      match.participants as unknown as { _id: Types.ObjectId; rating: number }[]
    ).map((p) => ({
      _id: p._id.toString(),
      rating: typeof p.rating === 'number' ? p.rating : 1000,
    }));

    const { teamA, teamB } = generateBalancedTeams(participantsRatings);
    match.teams = [
      {
        name: 'A',
        players: teamA.map((id) => new Types.ObjectId(id)),
        score: 0,
      },
      {
        name: 'B',
        players: teamB.map((id) => new Types.ObjectId(id)),
        score: 0,
      },
    ];
    await match.save();
    return res.json({ teams: match.teams });
  } catch (err) {
    return res.status(500).json({
      message: 'Error generando equipos',
      error: (err as Error).message,
    });
  }
}

export async function addFeedback(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    const body = req.body as {
      playerId?: string;
      vote?: unknown;
      note?: string;
    };

    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }
    if (!body.playerId || !Types.ObjectId.isValid(body.playerId)) {
      return res.status(400).json({ message: 'playerId inválido' });
    }
    const validVotes = ['up', 'neutral', 'down'] as const;
    if (
      typeof body.vote !== 'string' ||
      !validVotes.includes(body.vote as any)
    ) {
      return res.status(400).json({ message: 'vote inválido' });
    }

    const match = await MatchModel.findById(matchId).select(
      'participants feedback',
    );
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    const isParticipant = match.participants.find(
      (p) => p.toString() === body.playerId,
    );
    if (!isParticipant)
      return res
        .status(400)
        .json({ message: 'El jugador no participa en el match' });

    match.feedback.push({
      playerId: new Types.ObjectId(body.playerId),
      vote: body.vote,
      note: body.note,
      by: new Types.ObjectId(req.userId),
      at: new Date(),
    } as any);

    await match.save();
    return res.json({ message: 'Feedback registrado' });
  } catch (err) {
    return res.status(500).json({
      message: 'Error registrando feedback',
      error: (err as Error).message,
    });
  }
}

export async function finalizeMatch(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    const body = req.body as { scoreA?: unknown; scoreB?: unknown };

    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }
    if (typeof body.scoreA !== 'number' || typeof body.scoreB !== 'number') {
      return res.status(400).json({ message: 'Scores inválidos' });
    }

    const match = await MatchModel.findById(matchId).select(
      'teams status result',
    );
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    match.status = 'finalized';
    match.result = {
      scoreA: body.scoreA,
      scoreB: body.scoreB,
      finalizedAt: new Date(),
    } as any;

    // (Aquí podrías actualizar ELO si querés)

    await match.save();
    return res.json(match);
  } catch (err) {
    return res.status(500).json({
      message: 'Error finalizando match',
      error: (err as Error).message,
    });
  }
}
