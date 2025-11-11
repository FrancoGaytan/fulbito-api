import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Match as MatchModel } from '../models/match.model.js';
import { Group as GroupModel } from '../models/group.model.js';
import { Player as PlayerModel } from '../models/player.model.js';
import { GroupMembership } from '../models/groupMembership.model.js';
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
    const ctx = (req as any).groupContext;
    if (!ctx || ctx.groupId !== groupId) {
      return res.status(403).json({ message: 'Sin permiso (scoping)' });
    }

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
    return res.json({ matches: out, meta: { isOwner: ctx.isOwner, isMember: ctx.isMember, canCreate: (ctx.isOwner || ctx.isMember), groupId } });
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
    const debug = req.query.debug === '1';
    const raw = req.query.raw === '1';

    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }

    const match = await MatchModel.findById(matchId)
      .populate('participants', 'name abilities')
      .select('participants teams status groupId');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    // Intentar cargar ratings contextuales por grupo (GroupMembership)
    let membershipMap = new Map<string, { rating: number }>();
    if ((match as any).groupId) {
      const mids = (match.participants as any[]).map(p => p._id);
      const memberships = await GroupMembership.find({ groupId: (match as any).groupId, playerId: { $in: mids } })
        .select('playerId rating')
        .lean();
      membershipMap = new Map(memberships.map(m => [m.playerId.toString(), { rating: m.rating }]));
    }
    const participants = (match.participants as any[]).map(p => {
      const contextual = membershipMap.get(p._id.toString());
      return {
        id: p._id.toString(),
        name: p.name,
        rating: contextual ? contextual.rating : 1000,
        abilities: ((): Record<string, number> => {
          const a = p.abilities;
          if (!a) return {};
          if (typeof a.entries === 'function') return Object.fromEntries(a.entries());
          return a;
        })(),
      };
    });
    const ids = participants.map(p => p.id);
    const idsSet = new Set(ids);

  let teamA: string[] = [];
  let teamB: string[] = [];
  let aiTried = false;
  let aiSucceeded = false;
  let aiError: string | null = null;
  let aiRawResponse: any = null;

    let originalAiTeams: { name: string; players: string[] }[] | null = null;
    if (useAI && process.env.GEMINI_API_KEY) {
      try {
        aiTried = true;
        const ai = await suggestTeamsWithGemini({ participants, seed });
        aiRawResponse = ai;
        originalAiTeams = ai.teams.map(t => ({ name: t.name, players: [...t.players] }));
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
        aiSucceeded = true;
        // Rebalance cluster de top ratings si no es raw
        if (!raw) {
          const ratingsMap2 = new Map(participants.map(p => [p.id, p.rating]));
          const sortedAll = [...participants].sort((x, y) => y.rating - x.rating);
          const topCount = Math.max(2, Math.ceil(sortedAll.length * 0.2));
          const topIds = new Set(sortedAll.slice(0, topCount).map(p => p.id));
          const countTop = (arr: string[]) => arr.reduce((acc, id) => acc + (topIds.has(id) ? 1 : 0), 0);
          const topA = countTop(teamA);
          const topB = countTop(teamB);
          const maxAllowed = Math.ceil(topCount / 2);
          const overloaded: 'A' | 'B' | null = topA > maxAllowed ? 'A' : topB > maxAllowed ? 'B' : null;
          let clusterRebalanced = false;
          if (overloaded) {
            const from = overloaded === 'A' ? teamA : teamB;
            const to = overloaded === 'A' ? teamB : teamA;
            const topsInFrom = from.filter(id => topIds.has(id));
            const nonTopInTo = to.filter(id => !topIds.has(id));
            const sum2 = (arr: string[]) => arr.reduce((acc, id) => acc + (ratingsMap2.get(id) || 1000), 0);
            let sumA2 = sum2(teamA);
            let sumB2 = sum2(teamB);
            const avg2 = (sumA2 + sumB2) / 2;
            const threshold2 = Math.max(30, avg2 * 0.05);
            let bestSwap: { give: string; receive: string; newDiff: number } | null = null;
            for (const give of topsInFrom) {
              const rg = ratingsMap2.get(give) || 1000;
              for (const receive of nonTopInTo) {
                const rr = ratingsMap2.get(receive) || 1000;
                const newSumA = overloaded === 'A' ? sumA2 - rg + rr : sumA2 + rg - rr;
                const newSumB = overloaded === 'A' ? sumB2 + rg - rr : sumB2 - rg + rr;
                const newDiff = Math.abs(newSumA - newSumB);
                if (newDiff <= threshold2 && (!bestSwap || newDiff < bestSwap.newDiff)) {
                  bestSwap = { give, receive, newDiff };
                }
              }
            }
            if (bestSwap) {
              if (overloaded === 'A') {
                teamA = teamA.map(id => (id === bestSwap!.give ? bestSwap!.receive : id));
                teamB = teamB.map(id => (id === bestSwap!.receive ? bestSwap!.give : id));
              } else {
                teamB = teamB.map(id => (id === bestSwap!.give ? bestSwap!.receive : id));
                teamA = teamA.map(id => (id === bestSwap!.receive ? bestSwap!.give : id));
              }
              clusterRebalanced = true;
            }
            if (debug) {
              (aiRawResponse as any)._meta = {
                ...((aiRawResponse as any)._meta || {}),
                topCount,
                topA,
                topB,
                maxAllowed,
                clusterRebalanced,
              };
            }
          }
        }
        // Si se solicita raw=1 retornamos inmediatamente el resultado tal cual vino (solo limpiando ids duplicados/extraños)
        if (raw) {
          const rawTeamsCleaned = [a, b].map(t => {
            const safe = t || { name: '', players: [] as string[] };
            const upper = (safe.name || '').toUpperCase();
            const name = upper === 'A' ? 'A' : upper === 'B' ? 'B' : safe.name;
            const players = (safe.players || []).filter((pid, idx, arr) => idsSet.has(pid) && arr.indexOf(pid) === idx);
            return { name, players };
          });
          // Mapear al formato final sin post-balance
          match.teams = [
            { name: 'A', players: (rawTeamsCleaned.find(t => t.name === 'A')?.players || []).map(id => new Types.ObjectId(id)), score: 0 },
            { name: 'B', players: (rawTeamsCleaned.find(t => t.name === 'B')?.players || []).map(id => new Types.ObjectId(id)), score: 0 },
          ];
          await match.save();
          return res.json({
            teams: match.teams,
            debug: debug ? {
              seed,
              useAIRequested: useAI,
              geminiApiKeyPresent: !!process.env.GEMINI_API_KEY,
              aiTried,
              aiSucceeded,
              aiError,
              aiPrompt: (aiRawResponse as any)?._meta?.prompt,
              aiRawText: (aiRawResponse as any)?._meta?.rawText,
              originalAiTeams,
              rawMode: true,
              teamSizes: { A: (match.teams[0]?.players?.length) || 0, B: (match.teams[1]?.players?.length) || 0 },
            } : undefined,
          });
        }
      } catch (e) {
        aiError = (e as Error).message;
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

    if (debug) {
      return res.json({
        teams: match.teams,
        debug: {
          seed,
          useAIRequested: useAI,
          geminiApiKeyPresent: !!process.env.GEMINI_API_KEY,
          aiTried,
          aiSucceeded,
          aiError,
          aiRawResponse,
          aiPrompt: aiRawResponse?._meta?.prompt,
          aiRawText: aiRawResponse?._meta?.rawText,
          teamSizes: { A: teamA.length, B: teamB.length },
        },
      });
    }

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

  const match = await MatchModel.findById(matchId).select('teams status result groupId');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });

    match.status = 'finalized';
    match.result = { scoreA, scoreB, finalizedAt: new Date() } as any;

    if (Array.isArray(match.teams) && match.teams.length >= 2 && match.teams[0] && match.teams[1]) {
      match.teams[0].score = scoreA;
      match.teams[1].score = scoreB;
    }

    await match.save();

    try {
      if (!(match as any).groupId) {
        return res.status(409).json({ message: 'Match sin groupId (deprecated)' });
      }
      const playerIdsSet = new Set<string>();
      for (const t of match.teams) {
        for (const pid of (t.players as any[])) if (pid) playerIdsSet.add(pid.toString());
      }
      if (playerIdsSet.size) {
        const ids = Array.from(playerIdsSet).map(id => new Types.ObjectId(id));
        // Determinar outcome por equipo para incrementar wins/losses/draws
        let outcomeA: 'win' | 'lose' | 'draw' = 'draw';
        if (scoreA > scoreB) outcomeA = 'win'; else if (scoreA < scoreB) outcomeA = 'lose';
        const outcomeB = outcomeA === 'win' ? 'lose' : outcomeA === 'lose' ? 'win' : 'draw';
        const teamAPlayers = new Set((match.teams[0]?.players as any[]).map(p => p.toString()));
        const teamBPlayers = new Set((match.teams[1]?.players as any[]).map(p => p.toString()));
        const bulk = ids.map(pid => {
          const pidStr = pid.toString();
          let inc: any = { gamesPlayed: 1 };
          if (teamAPlayers.has(pidStr)) {
            if (outcomeA === 'win') inc.wins = 1; else if (outcomeA === 'lose') inc.losses = 1; else inc.draws = 1;
          } else if (teamBPlayers.has(pidStr)) {
            if (outcomeB === 'win') inc.wins = 1; else if (outcomeB === 'lose') inc.losses = 1; else inc.draws = 1;
          }
          return {
            updateOne: {
              filter: { groupId: (match as any).groupId, playerId: pid },
              update: { $inc: inc },
              upsert: true,
            },
          };
        });
        await GroupMembership.bulkWrite(bulk as any);
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[finalizeMatch] error incrementando stats membership:', (e as Error).message);
      }
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
      .select('teams status result ratingApplied ratingChanges participants groupId');
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
    // FEEDBACK CAP: si querés limitar la influencia de los votos por jugador, definí FEEDBACK_CAP (ej 6).
    // Si no se define (o es vacío), no se aplica límite y el valor puede crecer según cantidad de votos.
    const fbCapEnv = process.env.FEEDBACK_CAP;
    const fbCap = fbCapEnv !== undefined && fbCapEnv !== '' && !Number.isNaN(Number(fbCapEnv)) ? Number(fbCapEnv) : null;

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
      let val = r.score as number; // suma (up=+2, down=-2, neutral=0) * cantidad de votos
      if (fbCap !== null && Number.isFinite(fbCap)) {
        if (val > fbCap) val = fbCap;
        if (val < -fbCap) val = -fbCap;
      }
      fbMap.set(r._id.toString(), val);
    }

    if (!(match as any).groupId) {
      return res.status(409).json({ message: 'Match sin groupId (deprecated)' });
    }

    const playerDeltas: { playerId: Types.ObjectId; before: number; after: number; delta: number }[] = [];
    const membershipUpdates: { filter: any; update: any }[] = [];

    let membershipCache = new Map<string, { _id: Types.ObjectId; rating: number }>();
    const allPlayerIds: Types.ObjectId[] = [];
    for (const t of match.teams) {
      for (const p of (t.players as any[])) if (p && p._id) allPlayerIds.push(p._id);
    }
    const memberships = await GroupMembership.find({ groupId: (match as any).groupId, playerId: { $in: allPlayerIds } })
      .select('playerId rating')
      .lean();
    membershipCache = new Map(memberships.map(m => [m.playerId.toString(), { _id: m.playerId as any, rating: m.rating }]));

    const applyForTeam = (team: any, outcome: 'win' | 'lose' | 'draw') => {
      for (const p of team.players as any[]) {
        if (!p || !p._id) continue;
        let before = typeof p.rating === 'number' ? p.rating : 1000;
        const mem = membershipCache.get(p._id.toString());
        if (mem) before = mem.rating;
        let base = outcome === 'win' ? baseWin : outcome === 'lose' ? baseLose : baseDraw;
        const fb = fbMap.get(p._id.toString()) ?? 0;
        let total = base + fb;
        if (before < 950) total = Math.round(total * 1.2);
        else if (before > 1200) total = Math.round(total * 0.8);
        if (total > 40) total = 40;
        if (total < -40) total = -40;
  const after = Math.max(500, before + total);
        playerDeltas.push({ playerId: p._id, before, after, delta: after - before });
        membershipUpdates.push({
          filter: { groupId: (match as any).groupId, playerId: p._id },
          update: { $set: { rating: after } },
        });
      }
    };

    applyForTeam(teamA, outcomeA);
    applyForTeam(teamB, outcomeB);

    if (membershipUpdates.length) {
      const bulk = membershipUpdates.map(m => ({ updateOne: { filter: m.filter, update: m.update, upsert: true } }));
      await GroupMembership.bulkWrite(bulk as any);
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

/* ------------------------------ update result -------------------------------- */

// Permite corregir el resultado de un match ya finalizado SI todavía no se aplicaron ratings.
// Mantiene el finalizedAt original para no alterar el historial.
export async function updateResult(req: Request, res: Response) {
  try {
    const { id: matchId } = req.params as { id?: string };
    if (!matchId || !Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Id inválido' });
    }
    const { scoreA, scoreB } = req.body as { scoreA?: unknown; scoreB?: unknown };
    const a = Number(scoreA);
    const b = Number(scoreB);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return res.status(400).json({ message: 'Scores inválidos' });
    }

    const match = await MatchModel.findById(matchId).select('status result teams ratingApplied');
    if (!match) return res.status(404).json({ message: 'Match no encontrado' });
    if (match.status !== 'finalized') {
      return res.status(409).json({ message: 'El match no está finalizado' });
    }
    if (match.ratingApplied) {
      return res.status(409).json({ message: 'No se puede modificar: ratings ya aplicados' });
    }

    const finalizedAt = match.result?.finalizedAt || new Date();
    match.result = { scoreA: a, scoreB: b, finalizedAt } as any;
    if (Array.isArray(match.teams) && match.teams.length >= 2) {
      if (match.teams[0]) match.teams[0].score = a;
      if (match.teams[1]) match.teams[1].score = b;
    }
    await match.save();
    return res.json({ message: 'Resultado actualizado', match });
  } catch (err) {
    return res.status(500).json({ message: 'Error actualizando resultado', error: (err as Error).message });
  }
}
