import type { PlayerDoc } from '../models/player.model.js';

export function serializePlayer(p: PlayerDoc) {
  return {
    id: String(p._id),
    name: p.name,
    abilities: p.abilities,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
