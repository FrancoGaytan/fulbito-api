import type { MatchDoc } from '../models/match.model.js';

export function serializeMatch(m: MatchDoc) {
  return {
    id: String(m._id),
    groupId: String(m.group),
    date: m.date,
    participants: m.participants.map((p) => ({
      playerId: String(p.player),
      status: p.status,
    })),
    teams: m.teams.map((t) => ({
      name: t.name,
      players: t.players.map(String),
      score: t.score,
    })),
    result: m.result ?? null,
    feedback: m.feedback.map((f) => ({
      playerId: String(f.player),
      vote: f.vote,
      note: f.note,
    })),
    finalized: m.finalized,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
