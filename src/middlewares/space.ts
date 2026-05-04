import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { SpaceMembership } from '../models/space-membership.model.js';

/**
 * Middleware que lee el header `x-space-id`, verifica que el usuario sea miembro
 * y adjunta `req.spaceId` para uso en controllers.
 *
 * Si el header no viene → 400.
 * Si el usuario no es miembro → 403.
 */
export async function requireSpace(req: Request, res: Response, next: NextFunction) {
  const spaceId = req.headers['x-space-id'] as string | undefined;

  if (!spaceId || !Types.ObjectId.isValid(spaceId)) {
    return res.status(400).json({ message: 'Header x-space-id requerido y debe ser un id válido' });
  }

  const membership = await SpaceMembership.findOne({
    spaceId: new Types.ObjectId(spaceId),
    userId: new Types.ObjectId(req.userId!),
  }).lean();

  if (!membership) {
    return res.status(403).json({ message: 'No sos miembro de este space' });
  }

  req.spaceId = spaceId;
  next();
}
