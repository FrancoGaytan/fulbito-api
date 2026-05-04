import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Space } from '../models/space.model.js';
import { SpaceMembership } from '../models/space-membership.model.js';
import { SpacePlayer } from '../models/space-player.model.js';
import { User } from '../models/user.model.js';
import { Player } from '../models/player.model.js';

/** Al unirse/crear un space, crea SpacePlayer desde cero (rating 1000, gamesPlayed 0) */
async function initSpacePlayer(userId: Types.ObjectId, spaceId: Types.ObjectId): Promise<void> {
  const existing = await SpacePlayer.findOne({ spaceId, userId }).lean();
  if (existing) return; // ya tiene perfil en este space, no pisar
  // Usar el nombre del Player global si existe, sino el email
  const player = await Player.findOne({ userId }).lean();
  const user = player ? null : await User.findById(userId).select('email').lean();
  const name = (player as any)?.name ?? user?.email?.split('@')[0] ?? 'jugador';
  const nickname = (player as any)?.nickname;
  await SpacePlayer.create({ spaceId, userId, name, nickname, rating: 1000, gamesPlayed: 0 });
}

/* ---- helpers ---- */

/** Convierte req.userId (string) a ObjectId con cast explícito */
function uid(req: Request): Types.ObjectId {
  return new Types.ObjectId(req.userId!);
}

function genInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = genInviteCode();
    const exists = await Space.findOne({ inviteCode: code });
    if (!exists) return code;
  }
  throw new Error('No se pudo generar un código único');
}

/* ---- API ---- */

/** POST /api/spaces — crear space */
export async function createSpace(req: Request, res: Response) {
  try {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name?.trim()) return res.status(400).json({ message: 'name requerido' });

    const inviteCode = await uniqueCode();
    const space = await Space.create({
      name: name.trim(),
      description: description?.trim(),
      owner: uid(req),
      inviteCode,
    });

    await SpaceMembership.create({ spaceId: space._id, userId: uid(req), role: 'admin' });
    await initSpacePlayer(uid(req), space._id as Types.ObjectId);

    return res.status(201).json(space);
  } catch (err) {
    return res.status(500).json({ message: 'Error creando space', error: (err as Error).message });
  }
}

/** GET /api/spaces — listar spaces donde soy miembro */
export async function listMySpaces(req: Request, res: Response) {
  try {
    const memberships = await SpaceMembership.find({ userId: uid(req) }).lean();
    const spaceIds = memberships.map(m => m.spaceId);

    if (!spaceIds.length) return res.json([]);

    const [spaces, counts] = await Promise.all([
      Space.find({ _id: { $in: spaceIds } }).lean(),
      SpaceMembership.aggregate([
        { $match: { spaceId: { $in: spaceIds } } },
        { $group: { _id: '$spaceId', count: { $sum: 1 } } },
      ]),
    ]);

    const countMap = new Map(counts.map((c: any) => [c._id.toString(), c.count as number]));
    const membershipMap = new Map(memberships.map(m => [m.spaceId.toString(), m]));

    return res.json(spaces.map(s => {
      const role = membershipMap.get(s._id.toString())?.role ?? 'member';
      const isAdmin = role === 'admin';
      return {
        ...s,
        inviteCode: isAdmin ? (s as any).inviteCode : undefined,
        role,
        isAdmin,
        memberCount: countMap.get(s._id.toString()) ?? 0,
      };
    }));
  } catch (err) {
    return res.status(500).json({ message: 'Error listando spaces', error: (err as Error).message });
  }
}

/** GET /api/spaces/:id — detalle de un space (sólo miembros) */
export async function getSpace(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'id inválido' });
    const oid = new Types.ObjectId(id);

    const [space, membership] = await Promise.all([
      Space.findById(oid).lean(),
      SpaceMembership.findOne({ spaceId: oid, userId: uid(req) }).lean(),
    ]);

    if (!space) return res.status(404).json({ message: 'Space no encontrado' });
    if (!membership) return res.status(403).json({ message: 'No sos miembro de este space' });

    const memberCount = await SpaceMembership.countDocuments({ spaceId: oid });
    const isAdmin = membership.role === 'admin';

    return res.json({
      ...space,
      inviteCode: isAdmin ? (space as any).inviteCode : undefined,
      role: membership.role,
      isAdmin,
      memberCount,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error obteniendo space', error: (err as Error).message });
  }
}

/** POST /api/spaces/join — unirse con código de invitación */
export async function joinSpace(req: Request, res: Response) {
  try {
    const { inviteCode } = req.body as { inviteCode?: string };
    if (!inviteCode?.trim()) return res.status(400).json({ message: 'inviteCode requerido' });

    const space = await Space.findOne({ inviteCode: inviteCode.trim().toUpperCase() });
    if (!space) return res.status(404).json({ message: 'Código inválido o expirado' });

    const existing = await SpaceMembership.findOne({ spaceId: space._id, userId: uid(req) }).lean();
    if (existing) return res.status(409).json({ message: 'Ya sos miembro de este space', space });

    await SpaceMembership.create({ spaceId: space._id, userId: uid(req), role: 'member' });
    await initSpacePlayer(uid(req), space._id as Types.ObjectId);

    return res.status(201).json({ message: 'Te uniste al space', space });
  } catch (err) {
    return res.status(500).json({ message: 'Error uniéndose al space', error: (err as Error).message });
  }
}

/** GET /api/spaces/:id/members — listar miembros */
export async function listSpaceMembers(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'id inválido' });
    const oid = new Types.ObjectId(id);

    const access = await SpaceMembership.findOne({ spaceId: oid, userId: uid(req) }).lean();
    if (!access) return res.status(403).json({ message: 'No sos miembro de este space' });

    const memberships = await SpaceMembership.find({ spaceId: oid }).lean();
    const userIds = memberships.map(m => m.userId);

    const [users, players] = await Promise.all([
      User.find({ _id: { $in: userIds } }).select('email').lean(),
      SpacePlayer.find({ spaceId: oid, userId: { $in: userIds } }).lean(),
    ]);

    const userMap = new Map(users.map(u => [u._id.toString(), u]));
    const playerMap = new Map(players.map(p => [p.userId.toString(), p]));

    return res.json(memberships.map(m => ({
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      email: userMap.get(m.userId.toString())?.email,
      player: playerMap.get(m.userId.toString()) ?? null,
    })));
  } catch (err) {
    return res.status(500).json({ message: 'Error listando miembros', error: (err as Error).message });
  }
}

/** PATCH /api/spaces/:id — editar space (sólo admin) */
export async function updateSpace(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'id inválido' });
    const oid = new Types.ObjectId(id);

    const membership = await SpaceMembership.findOne({ spaceId: oid, userId: uid(req) }).lean();
    if (!membership) return res.status(403).json({ message: 'No sos miembro de este space' });
    if (membership.role !== 'admin') return res.status(403).json({ message: 'Solo admins pueden editar el space' });

    const { name, description } = req.body as { name?: string; description?: string };
    const update: Record<string, string> = {};
    if (name?.trim()) update.name = name.trim();
    if (description !== undefined) update.description = description?.trim() ?? '';

    const space = await Space.findByIdAndUpdate(oid, { $set: update }, { new: true });
    if (!space) return res.status(404).json({ message: 'Space no encontrado' });

    return res.json(space);
  } catch (err) {
    return res.status(500).json({ message: 'Error actualizando space', error: (err as Error).message });
  }
}

/** POST /api/spaces/:id/regenerate-code (sólo admin) */
export async function regenerateInviteCode(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'id inválido' });
    const oid = new Types.ObjectId(id);

    const membership = await SpaceMembership.findOne({ spaceId: oid, userId: uid(req) }).lean();
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ message: 'Solo admins pueden regenerar el código' });
    }

    const inviteCode = await uniqueCode();
    const space = await Space.findByIdAndUpdate(oid, { $set: { inviteCode } }, { new: true });

    return res.json({ inviteCode: space?.inviteCode });
  } catch (err) {
    return res.status(500).json({ message: 'Error regenerando código', error: (err as Error).message });
  }
}

/* ---- SpacePlayer ---- */

/** GET /api/spaces/:id/me */
export async function getMySpaceProfile(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'id inválido' });
    const oid = new Types.ObjectId(id);

    const access = await SpaceMembership.findOne({ spaceId: oid, userId: uid(req) }).lean();
    if (!access) return res.status(403).json({ message: 'No sos miembro de este space' });

    const profile = await SpacePlayer.findOne({ spaceId: oid, userId: uid(req) }).lean({ getters: true });
    return res.json(profile ?? null);
  } catch (err) {
    return res.status(500).json({ message: 'Error obteniendo perfil', error: (err as Error).message });
  }
}

/** PUT /api/spaces/:id/me */
export async function upsertMySpaceProfile(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'id inválido' });
    const oid = new Types.ObjectId(id);

    const access = await SpaceMembership.findOne({ spaceId: oid, userId: uid(req) }).lean();
    if (!access) return res.status(403).json({ message: 'No sos miembro de este space' });

    const { name, nickname, abilities } = req.body as { name?: string; nickname?: string; abilities?: Record<string, number> };
    if (!name?.trim()) return res.status(400).json({ message: 'name requerido' });

    const profile = await SpacePlayer.findOneAndUpdate(
      { spaceId: oid, userId: uid(req) },
      {
        $set: { name: name.trim(), nickname: nickname?.trim(), ...(abilities ? { abilities } : {}) },
        $setOnInsert: { rating: 1000, gamesPlayed: 0 },
      },
      { upsert: true, new: true },
    );

    return res.json(profile);
  } catch (err) {
    return res.status(500).json({ message: 'Error actualizando perfil', error: (err as Error).message });
  }
}

/** GET /api/spaces/:id/players */
export async function listSpacePlayers(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'id inválido' });
    const oid = new Types.ObjectId(id);

    const access = await SpaceMembership.findOne({ spaceId: oid, userId: uid(req) }).lean();
    if (!access) return res.status(403).json({ message: 'No sos miembro de este space' });

    const players = await SpacePlayer.find({ spaceId: oid }).sort({ name: 1 }).lean({ getters: true });
    return res.json(players);
  } catch (err) {
    return res.status(500).json({ message: 'Error listando players del space', error: (err as Error).message });
  }
}
