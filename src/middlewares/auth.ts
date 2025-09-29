import type { Request, Response, NextFunction } from 'express';
import jwt, { type JwtPayload, type Secret } from 'jsonwebtoken';

interface TokenClaims extends JwtPayload {
  sub?: string;
  userId?: string;
  id?: string;
  email?: string;
}

const JWT_SECRET: Secret | undefined = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[auth] JWT_SECRET no definido; no se validarán tokens');
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return next();
  if (!JWT_SECRET) return next();

  const token = auth.slice(7).trim();
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenClaims;
    const candidate = decoded.sub || decoded.userId || decoded.id;
    if (candidate) {
      req.userId = String(candidate);
      if (decoded.email) req.userEmail = decoded.email;
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[auth] token inválido:', (err as Error).message);
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ message: 'unauthorized' });
  next();
}