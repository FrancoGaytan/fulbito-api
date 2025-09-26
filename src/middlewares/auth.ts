import type { Request, Response, NextFunction } from 'express'
import jwt, { type JwtPayload, type Secret } from 'jsonwebtoken'

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return next()

  const token = auth.slice(7).trim()

  const secret = process.env.JWT_SECRET
  if (!secret) {
    console.warn('JWT_SECRET no definido; attachUser no puede verificar tokens')
    return next()
  }

  try {
    const decoded = jwt.verify(token, secret as Secret)

    if (typeof decoded === 'object' && decoded) {
      const p = decoded as JwtPayload & Record<string, unknown>
      req.userId = String(p.sub ?? (p as any).userId ?? (p as any).id ?? '')
    }
  } catch {
    // token inválido → dejamos req.userId undefined
  }
  next()
}

/** Exige que exista req.userId, si no → 401 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ message: 'unauthorized' })
  next()
}
