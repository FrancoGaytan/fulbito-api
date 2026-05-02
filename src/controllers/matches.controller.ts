import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Match as MatchModel } from '../models/match.model.js';
import { Group as GroupModel } from '../models/group.model.js';
import { Player as PlayerModel } from '../models/player.model.js';
import { suggestTeamsWithGemini } from '../ai/suggest-teams.js';
import { MatchPlayerVote } from '../models/match-vote.model.js';

/* ------------------------ helpers de balance/aleatoriedad ------------------------ */

function generateBalancedTeamOptions(
  participants: { _id: string; rating: number; abilityScore?: number }[],
  count: number = 5,
  baseSeed: number = 0,
): { teamA: string[]; teamB: string[]; score: number }[] {
  const n = participants.length;
  if (n < 2) return [];
  const half = Math.floor(n / 2);

  // Abilities get a meaningful weight: assume max ability sum ~25 (5 skills × max 5 each)
  // → contributes up to ~150 pts, roughly 15% of a 1000-rating score
  const abilityWeight = 6;
  const cMap = new Map(
    participants.map(p => [p._id, p.rating + (p.abilityScore ?? 0) * abilityWeight]),
  );

  const splitScore = (a: string[], b: string[]): number => {
    const s = (ids: string[]) => ids.reduce((acc, id) => acc + (cMap.get(id) ?? 0), 0);
    return Math.abs(s(a) - s(b));
  };

  const ids = participants.map(p => p._id);
  const raw: { a: string[]; b: string[]; score: number }[] = [];

  if (n <= 20) {
    // Enumerate all C(n, floor(n/2)) splits exhaustively — comfortably fast up to n=20
    const recurse = (start: number, chosen: string[]) => {
      if (chosen.length === half) {
        const chosenSet = new Set(chosen);
        const rest = ids.filter(id => !chosenSet.has(id));
        raw.push({ a: [...chosen], b: rest, score: splitScore(chosen, rest) });
        return;
      }
      const remaining = n - start;
      const needed = half - chosen.length;
      if (remaining < needed) return;
      chosen.push(ids[start]!);
      recurse(start + 1, chosen);
      chosen.pop();
      recurse(start + 1, chosen);
    };
    recurse(0, []);
  } else {
    // Heuristic for large groups: many random-seed greedy assignments
    for (let i = 0; i < 200; i++) {
      const shuffled = seededShuffle(participants, baseSeed + i * 1013 + i);
      const tA: string[] = [];
      const tB: string[] = [];
      let sA = 0;
      let sB = 0;
      for (const p of shuffled) {
        const c = cMap.get(p._id) ?? 0;
        if (sA <= sB) { tA.push(p._id); sA += c; }
        else { tB.push(p._id); sB += c; }
      }
      raw.push({ a: tA, b: tB, score: splitScore(tA, tB) });
    }
  }

  // Sort by balance quality (lower diff = better)
  raw.sort((x, y) => x.score - y.score);

  // Take top pool, then seeded-shuffle for deterministic diversity across requests
  const poolSize = Math.min(raw.length, Math.max(count * 10, 30));
  const pool = seededShuffle(raw.slice(0, poolSize), baseSeed);

  // Deduplicate via canonical form: sort each team, lex-order the pair
  const seen = new Set<string>();
  const result: { teamA: string[]; teamB: string[]; score: number }[] = [];

  for (const c of pool) {
    const sa = [...c.a].sort().join(',');
    const sb = [...c.b].sort().join(',');
    const key = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ teamA: c.a, teamB: c.b, score: c.score });
      if (result.length === count) break;
    }
  }

  return result;
}

// Returns the index in pool that matches the currently saved teams, or -1 if not found.
function findCurrentOptionIndex(
  currentTeams: { players: { toString(): string }[] }[],
  pool: { teamA: string[]; teamB: string[] }[],
): number {
  if (!currentTeams || currentTeams.length < 2) return -1;
  const getIds = (team: { players: { toString(): string }[] }) =>
    (team?.players ?? []).map(p => p.toString()).sort().join(',');
  const cA = getIds(currentTeams[0]!);
  const cB = getIds(currentTeams[1]!);
  const currentKey = cA < cB ? `${cA}|${cB}` : `${cB}|${cA}`;

  return pool.findIndex(opt => {
    const sa = [...opt.teamA].sort().join(',');
    const sb = [...opt.teamB].sort().join(',');
    const key = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
    return key === currentKey;
  });
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
    const debug = req.query.debug === '1';
    const raw = req.query.raw === '1';

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
        const baseSeed = parseInt(matchId.slice(-8), 16) >>> 0;
        const mapped = participants.map(p => ({
          _id: p.id,
          rating: p.rating,
          abilityScore: Object.values(p.abilities || {}).reduce((a: number, v: any) => a + (typeof v === 'number' ? v : 0), 0),
        }));
        const pool = generateBalancedTeamOptions(mapped, 5, baseSeed);
        if (pool.length > 0) {
          const currentIdx = findCurrentOptionIndex(match.teams as any, pool);
          const nextIdx = (currentIdx + 1) % pool.length;
          const chosen = pool[nextIdx]!;
          teamA = chosen.teamA;
          teamB = chosen.teamB;
        }
      }
    } else {
      const baseSeed = parseInt(matchId.slice(-8), 16) >>> 0;
      const mapped = participants.map(p => ({
        _id: p.id,
        rating: p.rating,
        abilityScore: Object.values(p.abilities || {}).reduce((a: number, v: any) => a + (typeof v === 'number' ? v : 0), 0),
      }));
      const pool = generateBalancedTeamOptions(mapped, 5, baseSeed);
      if (pool.length > 0) {
        const currentIdx = findCurrentOptionIndex(match.teams as any, pool);
        const nextIdx = (currentIdx + 1) % pool.length;
        const chosen = pool[nextIdx]!;
        teamA = chosen.teamA;
        teamB = chosen.teamB;
      }
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
