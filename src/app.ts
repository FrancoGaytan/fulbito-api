import express from 'express'
import cors from 'cors'

import groupsRouter from './routes/groups.routes.js'
import playersRouter from './routes/players.routes.js'
import matchesRouter from './routes/matches.routes.js'
import authRoutes from './routes/auth.routes.js'

import { attachUser, requireAuth } from './middlewares/auth.js'
import { errorHandler } from './middlewares/error.js'

export const buildApp = () => {
  const app = express()

  // CORS: local + Vercel (ajustá el dominio si cambia)
  const allowed = [
    'http://localhost:5173',
    'https://fulbito-web.vercel.app',
  ]
  app.use(
    cors({
      origin(origin, cb) {
        // Postman/cURL (sin origin) o permitido -> OK
        if (!origin || allowed.includes(origin)) return cb(null, true)
        cb(new Error('CORS not allowed: ' + origin))
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  )

  app.use(express.json())

  // Health check público
  app.get('/health', (_req, res) => res.json({ ok: true }))

  // Adjunta req.userId si hay token. NO bloquea.
  app.use(attachUser)

  // Rutas públicas de auth (login/register)
  app.use('/api/auth', authRoutes)

  // Resto protegido
  app.use('/api', requireAuth, groupsRouter)
  app.use('/api', requireAuth, playersRouter)
  app.use('/api/matches', requireAuth, matchesRouter)

  // Handler de errores
  app.use(errorHandler)

  return app
}
