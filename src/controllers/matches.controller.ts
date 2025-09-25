import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Match as MatchModel } from '../models/match.model.js';
import { Group as GroupModel } from '../models/group.model.js';
import { Player as PlayerModel } from '../models/player.model.js';
import { suggestTeamsWithGemini } from '../ai/suggest-teams.js';

/* ------------------------ helpers de balance/aleatoriedad ------------------------ */

function generateBalancedTeams(
  participants: { _id: string; rating: number }[],
) {
  const sorted = [...participants].sort((a, b) => b.rating - a.rating);
  const teamA: string[] = [];
  const teamB: string[] = [];
  let sumA = 0, sumB = 0;
  for (const p of sorted) {
    if (sumA <= sumB) { teamA.push(p._id); sumA += p.rating; }
    else { teamB.push(p._id); sumB += p.rating; }
  }
  return { teamA, teamB };
}

function seededRng(seed: number) {
  let t = seed >>> 0;
  return () => ((t = (t * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function seededShuffle<T>(arr: ReadonlyArray<T>, seed: number): T[] {
  const rnd = seededRng(seed || Math.floor(Math.random() * 1e9));
  const a = arr.slice(); // copia mutable

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    // swap seguro para TS
    const tmp = a[i]!;   // sabemos que existe
    a[i] = a[j]!;
    a[j] = tmp;
  }

  return a;
}

/* ----------------------------------- create ------------------------------------ */

export async function createMatch(req: Request, res: Response) {
  try {
    const body = req.body as {
      groupId?: string;
      participants?: unknown;
      scheduledAt?: unknown;
    };

    const groupId = body.groupId;
    if (!groupId || !Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ message: 'groupId inválido' });
    }

    // participants opcional, si viene: string[]
    const partIds: string[] =
      Array.isArray(body.participants) && body.participants.every(p => typeof p === 'string')
        ? (body.participants as string[])
        : [];
    const partIdsClean = [...new Set(partIds.map(String))];

    // grupo existe y es del usuario
    const group = await GroupModel.findById(groupId).select('owner members');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });
    if (group.owner.toString() !== req.userId) {
      return res.status(403).json({ message: 'No podés usar ese grupo' });
    }

    // si hay participantes, deben pertenecer al grupo
    if (partIdsClean.length) {
      const setMembers = new Set((group.members ?? []).map(m => m.toString()));
      const outside = partIdsClean.filter(id => !Types.ObjectId.isValid(id) || !setMembers.has(id));
      if (outside.length) {
        return res.status(400).json({
          message: 'Todos los participantes deben pertenecer al grupo',
          fueraDelGrupo: outside,
        });
      }
    }

    // fecha opcional
    const rawDate = (body as any).scheduledAt ?? (body as any).date ?? (body as any).when;
    let when: Date | undefined = undefined;
    if (rawDate !== undefined && rawDate !== null && String(rawDate).trim() !== '') {
      const d = new Date(String(rawDate));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'scheduledAt inválido' });
      }
      when = d;
    }

    const match = await MatchModel.create({
      groupId: new Types.ObjectId(groupId),
      participants: partIdsClean.map(id => new Types.ObjectId(id)),
      teams: [],
      feedback: [],
      result: undefined,
      status: 'pending',
      owner: req.userId!,
      ...(when ? { scheduledAt: when } : {}),
    });

    return res.status(201).json(match);
  } catch (err) {
    return res.status(500).json({ message: 'Error creando match', error: (err as Error).message });
  }
}

/* ----------------------------------- list -------------------------------------- */

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

    const matches = await MatchModel.find({ groupId, owner: req.userId }).lean();
    return res.json(matches);
  } catch (err) {
    return res.status(500).json({ message: 'Error listando matches', error: (err as Error).message });
  }
}

/* -------------------------------- addParticipant ------------------------------- */

export async function addParticipant(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    const { playerId } = req.body as { playerId?: string };

    if (!matchId || !Types.ObjectId.isValid(matchId) || !playerId || !Types.ObjectId.isValid(playerId)) {
      return res.status(400).json({ message: 'Ids inválidos' });
    }

    const match = await MatchModel.findById(matchId).select('groupId');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    const group = await GroupModel.findById(match.groupId).select('members');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });

    const isMember = (group.members ?? []).some(m => m.toString() === playerId);
    if (!isMember) {
      return res.status(400).json({ message: 'El jugador no pertenece al grupo del match' });
    }

    const updated = await MatchModel.findByIdAndUpdate(
      matchId,
      { $addToSet: { participants: new Types.ObjectId(playerId) } },
      { new: true },
    );

    if (!updated) return res.status(404).json({ message: 'Match no encontrado' });
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ message: 'Error agregando participante', error: (err as Error).message });
  }
}

/* -------------------------------- generateTeams -------------------------------- */

export async function generateTeams(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    const useAI =
      req.query.ai === '1' || String(process.env.USE_GEMINI_TEAMS).toLowerCase() === 'true';
    const seed =
      Number.parseInt(String(req.query.seed ?? '')) || Math.floor(Math.random() * 1e9);

    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }

    // Ruta con enforceOwnership(Match)
    const match = await MatchModel.findById(matchId)
      .populate('participants', 'name rating abilities')
      .select('participants teams status');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    const participants = (match.participants as any[]).map(p => ({
      id: p._id.toString(),
      name: p.name,
      rating: typeof p.rating === 'number' ? p.rating : 1000,
      abilities: ((): Record<string, number> => {
        // si viene como Map, lo convierto a objeto plano
        const a = p.abilities;
        if (!a) return {};
        if (typeof a.entries === 'function') return Object.fromEntries(a.entries());
        return a;
      })(),
    }));
    const ids = participants.map(p => p.id);
    const idsSet = new Set(ids);

    let teamA: string[] = [];
    let teamB: string[] = [];

    if (useAI && process.env.GEMINI_API_KEY) {
      try {
        const ai = await suggestTeamsWithGemini({ participants, seed });
        const find = (L: 'A' | 'B') => ai.teams.find(t => (t.name || '').toUpperCase() === L);
        const a = find('A') ?? ai.teams[0];
        const b = find('B') ?? ai.teams[1];

        // limpiar ids desconocidos/duplicados
        const clean = (arr: string[]) => {
          const seen = new Set<string>();
          const out: string[] = [];
          for (const id of arr) {
            if (idsSet.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
          }
          return out;
        };

        teamA = clean(a?.players ?? []);
        teamB = clean(b?.players ?? []);

        // completar si faltó alguien
        const assigned = new Set([...teamA, ...teamB]);
        const missing = participants.filter(p => !assigned.has(p.id));
        if (missing.length) {
          const shuffled = seededShuffle(missing, seed);
          let sumA = 0, sumB = 0;
          for (const p of shuffled) {
            if (sumA <= sumB) { teamA.push(p.id); sumA += p.rating; }
            else { teamB.push(p.id); sumB += p.rating; }
          }
        }
      } catch (e) {
        // IA falló -> fallback local
        const shuffled = seededShuffle(participants, seed).map(p => ({ _id: p.id, rating: p.rating }));
        const fb = generateBalancedTeams(shuffled);
        teamA = fb.teamA;
        teamB = fb.teamB;
      }
    } else {
      // Solo algoritmo local con semilla
      const shuffled = seededShuffle(participants, seed).map(p => ({ _id: p.id, rating: p.rating }));
      const fb = generateBalancedTeams(shuffled);
      teamA = fb.teamA;
      teamB = fb.teamB;
    }

    match.teams = [
      { name: 'A', players: teamA.map(id => new Types.ObjectId(id)), score: 0 },
      { name: 'B', players: teamB.map(id => new Types.ObjectId(id)), score: 0 },
    ];
    await match.save();

    return res.json({ teams: match.teams }); // (podrías devolver seed si querés)
  } catch (err) {
    return res.status(500).json({
      message: 'Error generando equipos',
      error: (err as Error).message,
    });
  }
}

/* ---------------------------------- feedback ----------------------------------- */

export async function addFeedback(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    const body = req.body as { playerId?: string; vote?: unknown; note?: string };

    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }
    if (!body.playerId || !Types.ObjectId.isValid(body.playerId)) {
      return res.status(400).json({ message: 'playerId inválido' });
    }
    const validVotes = ['up', 'neutral', 'down'] as const;
    if (typeof body.vote !== 'string' || !validVotes.includes(body.vote as any)) {
      return res.status(400).json({ message: 'vote inválido' });
    }

    const match = await MatchModel.findById(matchId).select('participants feedback');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    const isParticipant = match.participants.find(p => p.toString() === body.playerId);
    if (!isParticipant) return res.status(400).json({ message: 'El jugador no participa en el match' });

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
    return res.status(500).json({ message: 'Error registrando feedback', error: (err as Error).message });
  }
}

/* ---------------------------------- finalize ----------------------------------- */

export async function finalizeMatch(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    const body = req.body as { scoreA?: unknown; scoreB?: unknown };

    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }
    const scoreA = Number(body.scoreA);
    const scoreB = Number(body.scoreB);
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
      return res.status(400).json({ message: 'Scores inválidos' });
    }

    const match = await MatchModel.findById(matchId).select('teams status result');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    match.status = 'finalized';
    match.result = { scoreA, scoreB, finalizedAt: new Date() } as any;

    // reflejar scores en teams si existen
    if (Array.isArray(match.teams) && match.teams.length >= 2 && match.teams[0] && match.teams[1]) {
      match.teams[0].score = scoreA;
      match.teams[1].score = scoreB;
    }

    // (aquí podrías actualizar ELO por jugador, etc.)
    await match.save();
    return res.json(match);
  } catch (err) {
    return res.status(500).json({ message: 'Error finalizando match', error: (err as Error).message });
  }
}
