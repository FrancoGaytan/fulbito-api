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
    const group = await GroupModel.findById(groupId).select('owner members');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });

    // obtener player del usuario (owner o userId reclamado)
    const myPlayer = await PlayerModel.findOne({ $or: [ { owner: req.userId }, { userId: req.userId } ] })
      .select('_id')
      .lean();
    const myPid = myPlayer?._id ? myPlayer._id.toString() : null;

    const isOwner = group.owner.toString() === req.userId;
    const isMember = !!(myPid && (group.members ?? []).some(m => m.toString() === myPid));
    if (!isOwner && !isMember) return res.status(403).json({ message: 'Sin permiso' });

    // ahora traemos TODOS los matches del grupo
    const matches = await MatchModel.find({ groupId }).lean();
    // Obtener mis votos por match (un solo query agregando matchId in [...])
    const matchIds = matches.map(m => m._id);
    const { MatchPlayerVote } = await import('../models/match-vote.model.js');
    const votes = await MatchPlayerVote.find({ matchId: { $in: matchIds }, voterUserId: req.userId })
      .select('matchId playerId')
      .lean();
    const votesMap = new Map<string, string[]>();
    for (const v of votes) {
      const key = v.matchId.toString();
      const arr = votesMap.get(key) || [];
      arr.push(v.playerId.toString());
      votesMap.set(key, arr);
    }
    const out = matches.map(m => ({
      ...m,
      isOwnerMatch: m.owner && m.owner.toString() === req.userId,
      canEdit: m.owner && m.owner.toString() === req.userId,
      myVotes: votesMap.get(m._id.toString()) ?? [],
    }));
    return res.json({ matches: out, meta: { isOwner, isMember, canCreate: isOwner, groupId } });
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

        // Validación de balance por rating y reequilibrio suave si está muy desbalanceado
        const ratingsMap = new Map(participants.map(p => [p.id, p.rating]));
        const sum = (arr: string[]) => arr.reduce((acc, id) => acc + (ratingsMap.get(id) || 1000), 0);
        let sumA = sum(teamA);
        let sumB = sum(teamB);
        const diff = Math.abs(sumA - sumB);
        const avgTeam = (sumA + sumB) / 2;
        const threshold = Math.max(30, avgTeam * 0.05); // 5% o 30 como mínimo
        if (diff > threshold && teamA.length && teamB.length) {
          // Intento simple: ordenar por diferencia de impacto y mover un jugador
          const tryImprove = () => {
            let improved = false;
            // Genero pares candidatos (jugador de A por jugador de B) y calculo nueva diferencia
            let bestSwap: { a: string; b: string; newDiff: number } | null = null;
            for (const pa of teamA) {
              const ra = ratingsMap.get(pa) || 1000;
              for (const pb of teamB) {
                const rb = ratingsMap.get(pb) || 1000;
                const newSumA = sumA - ra + rb;
                const newSumB = sumB - rb + ra;
                const newDiff = Math.abs(newSumA - newSumB);
                if (newDiff < diff && (!bestSwap || newDiff < bestSwap.newDiff)) {
                  bestSwap = { a: pa, b: pb, newDiff };
                }
              }
            }
            if (bestSwap) {
              teamA = teamA.map(id => (id === bestSwap!.a ? bestSwap!.b : id));
              teamB = teamB.map(id => (id === bestSwap!.b ? bestSwap!.a : id));
              sumA = sum(teamA);
              sumB = sum(teamB);
              improved = true;
            }
            return improved;
          };
          // Hasta 5 intentos de mejora
          for (let i = 0; i < 5; i++) {
            if (!tryImprove()) break;
            if (Math.abs(sumA - sumB) <= threshold) break;
          }
        }
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

    const match = await MatchModel.findById(matchId).select('participants teams status ratingApplied');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });
    if (match.ratingApplied) return res.status(409).json({ message: 'Ratings ya aplicados' });

    // validar que playerId pertenece: en participants o en teams[*].players
    const playerIdStr = body.playerId;
    const inParticipants = match.participants.some(p => p.toString() === playerIdStr);
    let inTeams = false;
    for (const t of match.teams) {
      if ((t as any)?.players?.some?.((pid: any) => pid.toString() === playerIdStr)) { inTeams = true; break; }
    }
    if (!inParticipants && !inTeams) {
      return res.status(400).json({ message: 'El jugador no participa en el match' });
    }

    const { MatchPlayerVote } = await import('../models/match-vote.model.js');
    const voteDoc = await MatchPlayerVote.findOneAndUpdate(
      { matchId: new Types.ObjectId(matchId), playerId: new Types.ObjectId(playerIdStr), voterUserId: new Types.ObjectId(req.userId!) },
      { $set: { vote: body.vote, note: body.note, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true }
    ).lean();

    return res.json({ message: 'Feedback registrado', vote: voteDoc });
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

    // Guardar antes de actualizar jugadores
    await match.save();

    // Incrementar gamesPlayed para jugadores únicos en los teams (solo una vez por match)
    try {
      const playerIdsSet = new Set<string>();
      for (const t of match.teams) {
        for (const pid of (t.players as any[])) {
          if (pid) playerIdsSet.add(pid.toString());
        }
      }
      if (playerIdsSet.size) {
        const ids = Array.from(playerIdsSet).map(id => new Types.ObjectId(id));
        const { Player } = await import('../models/player.model.js');
        await Player.updateMany({ _id: { $in: ids } }, { $inc: { gamesPlayed: 1 } });
      }
    } catch (e) {
      // logging silencioso: podrías integrar logger real
      // console.error('Error incrementando gamesPlayed', e);
    }
    return res.json(match);
  } catch (err) {
    return res.status(500).json({ message: 'Error finalizando match', error: (err as Error).message });
  }
}

/* ----------------------------------- delete ------------------------------------ */

export async function deleteMatch(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }

    const deleted = await MatchModel.findByIdAndDelete(matchId);
    if (!deleted) return res.status(404).json({ message: 'Match no encontrado' });

    // podríamos devolver 204, pero mantenemos consistencia con mensajes JSON
    return res.status(200).json({ message: 'Match eliminado' });
  } catch (err) {
    return res.status(500).json({ message: 'Error eliminando match', error: (err as Error).message });
  }
}

/* -------------------------------- applyRatings --------------------------------- */

// Aplica cambios de rating basados en resultado + feedback (una sola vez)
export async function applyRatings(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }

    const match = await MatchModel.findById(matchId)
      .populate('teams.players', 'rating')
      .select('teams status result ratingApplied ratingChanges participants');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });
    if (match.status !== 'finalized') {
      return res.status(400).json({ message: 'El match debe estar finalizado' });
    }
    if (match.ratingApplied) {
      return res.status(409).json({ message: 'Ratings ya aplicados' });
    }

    // Reglas básicas:
    // - Base delta por resultado: +10 victoria, -10 derrota, +2 empate
    // - Ajuste por feedback acumulado (up:+2, neutral:0, down:-2) limitado a ±6
    // - Multiplicador suave si rating < 950 (+20%) o > 1200 (-20%)
    const baseWin = 10;
    const baseLose = -10;
    const baseDraw = 2;
    const fbUp = 2;
    const fbDown = -2;
    const fbCap = 6; // máximo ajuste absoluto por feedback

    const teamA = match.teams[0];
    const teamB = match.teams[1];
    if (!teamA || !teamB || !match.result) {
      return res.status(400).json({ message: 'Faltan equipos o resultado' });
    }

    const scoreA = match.result.scoreA;
    const scoreB = match.result.scoreB;
    let outcomeA: 'win' | 'lose' | 'draw';
    if (scoreA > scoreB) outcomeA = 'win';
    else if (scoreA < scoreB) outcomeA = 'lose';
    else outcomeA = 'draw';
    const outcomeB = outcomeA === 'win' ? 'lose' : outcomeA === 'lose' ? 'win' : 'draw';

    // Agregar votos desde colección externa
    const { MatchPlayerVote } = await import('../models/match-vote.model.js');
    const rawVotes = await MatchPlayerVote.aggregate([
      { $match: { matchId: new Types.ObjectId(matchId) } },
      { $group: { _id: '$playerId', score: { $sum: {
        $switch: {
          branches: [
            { case: { $eq: ['$vote', 'up'] }, then: fbUp },
            { case: { $eq: ['$vote', 'down'] }, then: fbDown },
          ],
          default: 0,
        }
      } }, ups: { $sum: { $cond: [{ $eq: ['$vote','up']},1,0]}}, downs:{ $sum:{ $cond:[{ $eq:['$vote','down']},1,0]}}, neutrals:{ $sum:{ $cond:[{ $eq:['$vote','neutral']},1,0]}}, total: { $sum: 1 } } }
    ]);
    const fbMap = new Map<string, number>();
    for (const r of rawVotes) {
      let val = r.score as number;
      if (val > fbCap) val = fbCap;
      if (val < -fbCap) val = -fbCap;
      fbMap.set(r._id.toString(), val);
    }

    const playerDeltas: { playerId: Types.ObjectId; before: number; after: number; delta: number }[] = [];
    const playerUpdates: { _id: Types.ObjectId; rating: number }[] = [];

    const applyForTeam = (team: any, outcome: 'win' | 'lose' | 'draw') => {
      for (const p of team.players as any[]) {
        if (!p || !p._id) continue;
        const before = typeof p.rating === 'number' ? p.rating : 1000;
        let base = outcome === 'win' ? baseWin : outcome === 'lose' ? baseLose : baseDraw;
        const fb = fbMap.get(p._id.toString()) ?? 0;
        let total = base + fb;
        // multiplicador según rating
        if (before < 950) total = Math.round(total * 1.2);
        else if (before > 1200) total = Math.round(total * 0.8);
        // limitar delta extremo
        if (total > 40) total = 40;
        if (total < -40) total = -40;
        const after = Math.max(500, before + total); // límite inferior 500
        playerDeltas.push({ playerId: p._id, before, after, delta: after - before });
        playerUpdates.push({ _id: p._id, rating: after });
      }
    };

    applyForTeam(teamA, outcomeA);
    applyForTeam(teamB, outcomeB);

    // Aplicar updates (bulk)
    if (playerUpdates.length) {
      const bulk = playerUpdates.map(u => ({
        updateOne: {
          filter: { _id: u._id },
          update: { $set: { rating: u.rating } },
        },
      }));
      // Importación lazy para evitar ciclo si existiera
      const { Player } = await import('../models/player.model.js');
      await Player.bulkWrite(bulk as any);
    }

    match.ratingApplied = true as any;
    match.ratingChanges = playerDeltas as any;
    await match.save();

    return res.json({ applied: playerDeltas.length, changes: playerDeltas });
  } catch (err) {
    return res.status(500).json({ message: 'Error aplicando ratings', error: (err as Error).message });
  }
}
