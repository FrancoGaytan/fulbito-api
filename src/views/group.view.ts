import { Group } from '../models/groups/group.model.js';
import { serializePlayer } from './player.view.js';

export function serializeGroup(g: Group & { members?: any[] }) {
  return {
    id: String(g._id),
    name: g.name,
    members: Array.isArray(g.members)
      ? g.members.map(serializePlayer)
      : undefined,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}
