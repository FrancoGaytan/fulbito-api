import express from 'express'
import cors from 'cors'

import groupsRouter from './routes/groups.routes.js'
import playersRouter from './routes/players.routes.js'
import matchesRouter from './routes/matches.routes.js'
import authRoutes from './routes/auth.routes.js'
import spacesRouter from './routes/spaces.routes.js'

import { attachUser, requireAuth } from './middlewares/auth.js'
import { requireSpace } from './middlewares/space.js'
import { errorHandler } from './middlewares/error.js'

export const buildApp = () => {
  const app = express()

  const allowed = ['https://fulbito-web.vercel.app']
  const isLocalOrigin = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)

  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || allowed.includes(origin) || isLocalOrigin(origin)) return cb(null, true)
        console.warn('[CORS] Origin not allowed:', origin)
        cb(null, false)
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-space-id'],
    })
  )

  app.use(express.json())

  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use(attachUser)
  app.use('/api/auth', authRoutes)
  app.use('/api/spaces', requireAuth, spacesRouter)
  app.use('/api', requireAuth, requireSpace, groupsRouter)
  app.use('/api', requireAuth, requireSpace, playersRouter)
  app.use('/api/matches', requireAuth, requireSpace, matchesRouter)
  app.use(errorHandler)

  return app
}
