import { Types } from 'mongoose';
import { MatchModel, IMatchTeam, IMatchFeedback } from '../models/matches/match.model.js';
import { shuffle } from '../utils/shuffle.js';

export class MatchesController {
  // POST /api/matches
  static async create(req: any, res: any) {
    const { groupId, participants } = req.body as {
      groupId: string;
      participants: string[];
    };

    const match = await MatchModel.create({
      group: new Types.ObjectId(groupId),
      participants: (participants ?? []).map((id) => new Types.ObjectId(id)),
      status: 'draft',
    });

    res.status(201).json({ ok: true, match });
  }

  // GET /api/matches/group/:groupId
  static async listByGroup(req: any, res: any) {
    const { groupId } = req.params;
    const matches = await MatchModel.find({ group: groupId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, matches });
  }

  // POST /api/matches/:matchId/participants
  static async addParticipant(req: any, res: any) {
    const { matchId } = req.params;
    const { playerId } = req.body as { playerId: string };

    const match = await MatchModel.findById(matchId);
    if (!match) return res.status(404).json({ ok: false, error: 'match_not_found' });

    const pid = new Types.ObjectId(playerId);
    if (!match.participants.some((p) => p.equals(pid))) {
      match.participants.push(pid);
    }
    await match.save();

    res.status(201).json({ ok: true, participants: match.participants });
  }

  // POST /api/matches/:matchId/generate-teams
  static async generateTeams(req: any, res: any) {
    const { matchId } = req.params;

    const match = await MatchModel.findById(matchId);
    if (!match) return res.status(404).json({ ok: false, error: 'match_not_found' });

    const ids = match.participants.map((p) => p.toString());
    const mixed = shuffle(ids);
    const mid = Math.ceil(mixed.length / 2);
    const A = mixed.slice(0, mid).map((id) => new Types.ObjectId(id));
    const B = mixed.slice(mid).map((id) => new Types.ObjectId(id));

    // TypeScript + Mongoose: casteamos al tipo del subdocumento
    const teams: IMatchTeam[] = [
      { name: 'A', players: A, score: 0 },
      { name: 'B', players: B, score: 0 },
    ];
    match.set('teams', teams as unknown as IMatchTeam[]); // casting seguro aquí

    match.status = 'generated';
    await match.save();

    res.json({ ok: true, teams: match.teams });
  }

  // POST /api/matches/:matchId/feedback
  static async feedback(req: any, res: any) {
    const { matchId } = req.params;
    const body = req.body as { playerId: string; vote: -1 | 0 | 1; note?: string };

    const match = await MatchModel.findById(matchId);
    if (!match) return res.status(404).json({ ok: false, error: 'match_not_found' });

    const pid = new Types.ObjectId(body.playerId);
    const idx = match.feedback.findIndex((f) => f.player.equals(pid));

    if (idx >= 0) {
      // mantenemos el ObjectId original, solo actualizamos campos mutables
      match.feedback[idx] = {
        player: match.feedback[idx]!.player,
        vote: body.vote,
        note: body.note ?? null,
      } as unknown as IMatchFeedback;
    } else {
      match.feedback.push({
        player: pid,
        vote: body.vote,
        note: body.note ?? null,
      } as unknown as IMatchFeedback);
    }

    await match.save();
    res.status(201).json({ ok: true, feedback: match.feedback });
  }

  // POST /api/matches/:matchId/finalize
  static async finalize(req: any, res: any) {
    const { matchId } = req.params;
    const { scoreA, scoreB } = req.body as { scoreA: number; scoreB: number };

    const match = await MatchModel.findById(matchId);
    if (!match) return res.status(404).json({ ok: false, error: 'match_not_found' });

    match.status = 'finalized';
    const winner = scoreA === scoreB ? 'draw' : scoreA > scoreB ? 'A' : 'B';
    match.result = { winner, scoreA, scoreB };

    // también reflejamos el score en los equipos si existen
    if (Array.isArray(match.teams) && match.teams.length === 2) {
      match.teams = [
        { ...match.teams[0]!, score: scoreA },
        { ...match.teams[1]!, score: scoreB },
      ] as unknown as IMatchTeam[];
    }

    await match.save();
    res.json({ ok: true, result: match.result });
  }
}
