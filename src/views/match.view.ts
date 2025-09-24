import { Types } from 'mongoose';
import type { IMatch } from '../models/match.model.js';

export function serializeMatch(m: IMatch) {
  return {
    id: String(m._id),
    groupId: String(m.groupId),
    participants: m.participants.map((p: Types.ObjectId) => ({
      playerId: String(p),
    })),
    teams: m.teams.map((t) => ({
      name: t.name,
      players: t.players.map(String),
      score: t.score,
    })),
    result: m.result ?? null,
    feedback: m.feedback.map((f) => ({
      playerId: String(f.playerId),
      vote: f.vote,
      note: f.note,
    })),
    finalized: m.result?.finalizedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
