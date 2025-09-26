import express from 'express'
import cors from 'cors'

import groupsRouter from './routes/groups.routes.js'
import playersRouter from './routes/players.routes.js'
import matchesRouter from './routes/matches.routes.js'
import authRoutes from './routes/auth.routes.js'
import { errorHandler } from './middlewares/error.js'

export const buildApp = () => {
  const app = express()

  const allowedOrigins: (string | RegExp)[] = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://fulbito-web.vercel.app',
    /\.vercel\.app$/,
  ]

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true)
        const ok = allowedOrigins.some(o =>
          typeof o === 'string' ? o === origin : o.test(origin),
        )
        cb(ok ? null : new Error('Not allowed by CORS'), ok)
      },
      credentials: false,
    }),
  )

  app.use((req, res, next) => {
    const origin = req.headers.origin ?? ''
    const isAllowed =
      !origin ||
      allowedOrigins.some(o =>
        typeof o === 'string' ? o === origin : o.test(String(origin)),
      )

    if (isAllowed && origin) {
      res.header('Access-Control-Allow-Origin', origin)
    }
    res.header('Vary', 'Origin')
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.header(
      'Access-Control-Allow-Methods',
      'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    )

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204)
    }
    next()
  })

  app.use(express.json())

  app.get('/health', (_req, res) => res.json({ ok: true }))

  app.use('/api', groupsRouter)
  app.use('/api', playersRouter)
  app.use('/api/matches', matchesRouter)
  app.use('/api/auth', authRoutes)

  app.use(errorHandler)

  return app
}
