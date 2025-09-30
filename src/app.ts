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

  const allowed = [
    'http://localhost:5173',
    'https://fulbito-web.vercel.app',
  ]
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || allowed.includes(origin)) return cb(null, true)
        cb(new Error('CORS not allowed: ' + origin))
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  )

  app.use(express.json())

  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use(attachUser)
  app.use('/api/auth', authRoutes)
  app.use('/api', requireAuth, groupsRouter)
  app.use('/api', requireAuth, playersRouter)
  app.use('/api/matches', requireAuth, matchesRouter)
  app.use(errorHandler)

  return app
}
