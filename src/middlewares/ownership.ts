import { Request, Response, NextFunction } from 'express';
import { Model } from 'mongoose';

export function enforceOwnership<T>(model: Model<T>, idParam = 'id') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const id = req.params[idParam];
    if (!userId) return res.status(401).json({ message: 'No autenticado' });

  const doc: any = await model.findById(id).select('owner');
    if (!doc) return res.status(404).json({ message: 'No encontrado' });
  if (doc?.owner?.toString() !== userId) {
      return res.status(403).json({ message: 'No tenés permisos sobre este recurso' });
    }
    next();
  };
}
