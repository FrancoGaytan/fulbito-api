import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Group } from '../models/group.model.js';
import { Player } from '../models/player.model.js';
import { GroupMembership } from '../models/groupMembership.model.js';

const isHexId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s);

function extractGroupId(req: Request): string | null {
  const p = (req.params as any).id || (req.params as any).groupId;
  const header = req.header('x-group-id');
  const q = req.query.groupId as string | undefined;
  const candidate = p || header || q;
  if (candidate && isHexId(candidate)) return candidate;
  return null;
}

async function getMyPlayerId(userId: string | undefined) {
  if (!userId) return null;
  const me = await Player.findOne({ $or: [ { owner: userId }, { userId } ] }).select('_id').lean();
  return me?._id ? String(me._id) : null;
}

export async function requireGroupAccess(req: Request, res: Response, next: NextFunction) {
  try {
    if (!(req as any).userId) return res.status(401).json({ message: 'unauthorized' });
    const groupId = extractGroupId(req);
    if (!groupId) return res.status(400).json({ message: 'groupId faltante o inválido' });

    const group = await Group.findById(groupId).select('owner members').lean();
    if (!group) return res.status(404).json({ message: 'Grupo no encontrado' });

    const userId = (req as any).userId as string;
    const myPlayerId = await getMyPlayerId(userId);
    const isOwner = String(group.owner) === userId;
    const isMember = !!(myPlayerId && (group.members as any[]).some(m => String(m) === myPlayerId));

    if (!isOwner && !isMember) return res.status(403).json({ message: 'Sin permiso' });

    // Buscar membership contextual si existe
    let membership: any = null;
    if (myPlayerId) {
      membership = await GroupMembership.findOne({ groupId: new Types.ObjectId(groupId), playerId: new Types.ObjectId(myPlayerId) }).lean();
    }

    (req as any).groupContext = { groupId, isOwner, isMember, myPlayerId, membership };
    return next();
  } catch (err) {
    return res.status(500).json({ message: 'Error validando acceso al grupo', error: (err as Error).message });
  }
}

export function requireGroupOwner(req: Request, res: Response, next: NextFunction) {
  const ctx = (req as any).groupContext;
  if (!ctx || !ctx.isOwner) {
    return res.status(403).json({ message: 'Solo owner del grupo' });
  }
  return next();
}
