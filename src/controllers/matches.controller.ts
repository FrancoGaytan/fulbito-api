import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Match as MatchModel } from '../models/match.model.js';
import { Group as GroupModel } from '../models/group.model.js';
import { Player as PlayerModel } from '../models/player.model.js';
import { suggestTeamsWithGemini } from '../ai/suggest-teams.js';
import { MatchPlayerVote } from '../models/match-vote.model.js';

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
  const a = arr.slice();

  for (let i = a.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  const tmp = a[i]!;
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

    const partIds: string[] =
      Array.isArray(body.participants) && body.participants.every(p => typeof p === 'string')
        ? (body.participants as string[])
        : [];
    const partIdsClean = [...new Set(partIds.map(String))];

    const group = await GroupModel.findById(groupId).select('owner members');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });

    const isOwner = group.owner.toString() === req.userId;
    let isMember = false;
    if (!isOwner) {
      const myPlayer = await PlayerModel.findOne({ $or: [ { owner: req.userId }, { userId: req.userId } ] })
        .select('_id')
        .lean();
      if (myPlayer?._id) {
        isMember = (group.members ?? []).some(m => m.toString() === myPlayer._id.toString());
      }
    }
    if (!isOwner && !isMember) {
      return res.status(403).json({ message: 'No pertenecés al grupo' });
    }

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

    const myPlayer = await PlayerModel.findOne({ $or: [ { owner: req.userId }, { userId: req.userId } ] })
      .select('_id')
      .lean();
    const myPid = myPlayer?._id ? myPlayer._id.toString() : null;

    const isOwner = group.owner.toString() === req.userId;
    const isMember = !!(myPid && (group.members ?? []).some(m => m.toString() === myPid));
    if (!isOwner && !isMember) return res.status(403).json({ message: 'Sin permiso' });

    const matches = await MatchModel.find({ groupId }).lean();
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
  return res.json({ matches: out, meta: { isOwner, isMember, canCreate: (isOwner || isMember), groupId } });
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

    const match = await MatchModel.findById(matchId)
      .populate('participants', 'name rating abilities')
      .select('participants teams status');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    const participants = (match.participants as any[]).map(p => ({
      id: p._id.toString(),
      name: p.name,
      rating: typeof p.rating === 'number' ? p.rating : 1000,
      abilities: ((): Record<string, number> => {
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

        const ratingsMap = new Map(participants.map(p => [p.id, p.rating]));
        const sum = (arr: string[]) => arr.reduce((acc, id) => acc + (ratingsMap.get(id) || 1000), 0);
        let sumA = sum(teamA);
        let sumB = sum(teamB);
        const diff = Math.abs(sumA - sumB);
        const avgTeam = (sumA + sumB) / 2;
  const threshold = Math.max(30, avgTeam * 0.05);
        if (diff > threshold && teamA.length && teamB.length) {
          const tryImprove = () => {
            let improved = false;
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
          for (let i = 0; i < 5; i++) {
            if (!tryImprove()) break;
            if (Math.abs(sumA - sumB) <= threshold) break;
          }
        }
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
        const shuffled = seededShuffle(participants, seed).map(p => ({ _id: p.id, rating: p.rating }));
        const fb = generateBalancedTeams(shuffled);
        teamA = fb.teamA;
        teamB = fb.teamB;
      }
    } else {
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

  return res.json({ teams: match.teams });
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

    if (Array.isArray(match.teams) && match.teams.length >= 2 && match.teams[0] && match.teams[1]) {
      match.teams[0].score = scoreA;
      match.teams[1].score = scoreB;
    }

    await match.save();

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

    if (req.query.requireFull === '1') {
      const progress = await buildVoteProgress(match);
      if (!progress.allVotersCompletedAllPlayers) {
        return res.status(409).json({
          message: 'Faltan votos para aplicar ratings (requireFull activo)',
          progress,
        });
      }
    }

    const baseWin = 10;
    const baseLose = -10;
    const baseDraw = 2;
    const fbUp = 2;
    const fbDown = -2;
  const fbCap = 6;

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
        if (before < 950) total = Math.round(total * 1.2);
        else if (before > 1200) total = Math.round(total * 0.8);
        if (total > 40) total = 40;
        if (total < -40) total = -40;
  const after = Math.max(500, before + total);
        playerDeltas.push({ playerId: p._id, before, after, delta: after - before });
        playerUpdates.push({ _id: p._id, rating: after });
      }
    };

    applyForTeam(teamA, outcomeA);
    applyForTeam(teamB, outcomeB);

    if (playerUpdates.length) {
      const bulk = playerUpdates.map(u => ({
        updateOne: {
          filter: { _id: u._id },
          update: { $set: { rating: u.rating } },
        },
      }));
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

/* ---------------------------- vote progress helper ---------------------------- */

interface VoteProgress {
  matchId: string;
  totalPlayers: number;
  totalPotentialVoters: number;
  perPlayer: Array<{
    playerId: string;
    votes: { up: number; down: number; neutral: number; total: number };
    distinctVoters: number;
  }>;
  perVoter: Array<{
    userId: string;
    votedPlayers: string[];
    remainingPlayers: string[];
    completed: boolean;
  }>;
  allPlayersHaveAtLeastOneVote: boolean;
  allVotersCompletedAllPlayers: boolean;
  ratingApplied: boolean;
}

async function buildVoteProgress(matchOrId: any): Promise<VoteProgress> {
  let match = matchOrId;
  if (!match || !match._id) {
    match = await MatchModel.findById(matchOrId)
      .select('teams participants ratingApplied')
      .lean();
  }
  if (!match) throw new Error('match not found');

  // Colección de playerIds: usar players de teams si existen, sino participants
  const playerIdsSet = new Set<string>();
  if (Array.isArray(match.teams) && match.teams.length) {
    for (const t of match.teams) {
      for (const pid of (t.players ?? [])) {
        if (pid) playerIdsSet.add(pid.toString());
      }
    }
  } else if (Array.isArray(match.participants)) {
    for (const pid of match.participants) {
      if (pid) playerIdsSet.add(pid.toString());
    }
  }
  const playerIds = Array.from(playerIdsSet).map(id => new Types.ObjectId(id));

  // Cargar players para identificar userIds/owners
  const players = await PlayerModel.find({ _id: { $in: playerIds } })
    .select('_id userId owner name')
    .lean();
  const totalPlayers = players.length;
  const voterIdsSet = new Set<string>();
  const playerToVoter: Record<string, string> = {};
  for (const p of players) {
    const vid = (p as any).userId?.toString() || (p as any).owner?.toString();
    if (vid) {
      voterIdsSet.add(vid);
      playerToVoter[p._id.toString()] = vid;
    }
  }

  const votes = await MatchPlayerVote.find({ matchId: match._id })
    .select('playerId voterUserId vote')
    .lean();

  // perPlayer aggregation
  const perPlayerMap = new Map<string, { up: number; down: number; neutral: number; total: number; voterSet: Set<string>; }>();
  for (const v of votes) {
    const pid = v.playerId.toString();
    let rec = perPlayerMap.get(pid);
    if (!rec) {
      rec = { up: 0, down: 0, neutral: 0, total: 0, voterSet: new Set() };
      perPlayerMap.set(pid, rec);
    }
    if (v.vote === 'up') rec.up++;
    else if (v.vote === 'down') rec.down++;
    else rec.neutral++;
    rec.total++;
    rec.voterSet.add(v.voterUserId.toString());
  }

  const perPlayer = players.map(p => {
    const rec = perPlayerMap.get(p._id.toString()) || { up: 0, down: 0, neutral: 0, total: 0, voterSet: new Set<string>() };
    return {
      playerId: p._id.toString(),
      votes: { up: rec.up, down: rec.down, neutral: rec.neutral, total: rec.total },
      distinctVoters: rec.voterSet.size,
    };
  });

  // perVoter progress (cada userId/owner debe votar a todos los players)
  const voterProgressMap = new Map<string, Set<string>>();
  for (const v of votes) {
    let s = voterProgressMap.get(v.voterUserId.toString());
    if (!s) { s = new Set(); voterProgressMap.set(v.voterUserId.toString(), s); }
    s.add(v.playerId.toString());
  }
  const perVoter: VoteProgress['perVoter'] = Array.from(voterIdsSet).map(uid => {
    const voted = voterProgressMap.get(uid) || new Set();
    const votedPlayers = Array.from(voted);
    const remainingPlayers = players.map(p => p._id.toString()).filter(id => !voted.has(id));
    return { userId: uid, votedPlayers, remainingPlayers, completed: remainingPlayers.length === 0 };
  });

  const allPlayersHaveAtLeastOneVote = perPlayer.every(p => p.votes.total > 0);
  const allVotersCompletedAllPlayers = perVoter.every(v => v.completed);

  return {
    matchId: match._id.toString(),
    totalPlayers,
    totalPotentialVoters: voterIdsSet.size,
    perPlayer,
    perVoter,
    allPlayersHaveAtLeastOneVote,
    allVotersCompletedAllPlayers,
    ratingApplied: !!match.ratingApplied,
  };
}

/* ----------------------------- vote progress API ------------------------------ */

export async function getVoteProgress(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }
    const match = await MatchModel.findById(matchId).select('groupId teams participants ratingApplied owner');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    // validar que el usuario tiene acceso (owner del match o miembro del grupo)
    const group = await GroupModel.findById(match.groupId).select('owner members');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });

    const isOwner = group.owner.toString() === req.userId;
    // buscar player del usuario
    const myPlayer = await PlayerModel.findOne({ $or: [ { owner: req.userId }, { userId: req.userId } ] }).select('_id').lean();
    const myPid = myPlayer?._id?.toString();
    const isMember = !!(myPid && (group.members ?? []).some(m => m.toString() === myPid));
    if (!isOwner && !isMember) return res.status(403).json({ message: 'Sin permiso' });

    const progress = await buildVoteProgress(match);
    return res.json({ progress });
  } catch (err) {
    return res.status(500).json({ message: 'Error obteniendo progreso de votos', error: (err as Error).message });
  }
}

/* ------------------------------- my votes status ------------------------------- */

export async function getMyVotes(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }
    const match = await MatchModel.findById(matchId).select('groupId teams participants ratingApplied ratingChanges');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    const group = await GroupModel.findById(match.groupId).select('owner members');
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });
    const isOwner = group.owner.toString() === req.userId;
    const myPlayer = await PlayerModel.findOne({ $or: [ { owner: req.userId }, { userId: req.userId } ] }).select('_id').lean();
    const myPid = myPlayer?._id?.toString();
    const isMember = !!(myPid && (group.members ?? []).some(m => m.toString() === myPid));
    if (!isOwner && !isMember) return res.status(403).json({ message: 'Sin permiso' });

    // lista de players evaluables
    const playerIdSet = new Set<string>();
    if (Array.isArray(match.teams) && match.teams.length) {
      for (const t of match.teams) {
        for (const pid of (t.players as any[])) if (pid) playerIdSet.add(pid.toString());
      }
    } else {
      for (const pid of match.participants as any[]) if (pid) playerIdSet.add(pid.toString());
    }
    const playerIds = Array.from(playerIdSet).map(id => new Types.ObjectId(id));

    const myVotes = await MatchPlayerVote.find({ matchId: match._id, voterUserId: req.userId })
      .select('playerId vote note')
      .lean();
    const myVotedIds = new Set(myVotes.map(v => v.playerId.toString()));
    const remainingPlayerIds = Array.from(playerIdSet).filter(id => !myVotedIds.has(id));
    const completed = remainingPlayerIds.length === 0 && playerIdSet.size > 0;

    return res.json({
  matchId: (match as any)._id.toString(),
      ratingApplied: !!match.ratingApplied,
      ratingChanges: match.ratingApplied ? match.ratingChanges : undefined,
      totalPlayers: playerIdSet.size,
      myVotes: myVotes.map(v => ({ playerId: v.playerId.toString(), vote: v.vote, note: v.note })),
      myVotedPlayerIds: Array.from(myVotedIds),
      remainingPlayerIds,
      completed,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error obteniendo mis votos', error: (err as Error).message });
  }
}
