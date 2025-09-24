import express from 'express';
import cors from 'cors';

import groupsRouter from './routes/groups.routes.js';
import playersRouter from './routes/players.routes.js';
import matchesRouter from './routes/matches.routes.js';
import authRoutes from './routes/auth.routes.js';
import { errorHandler } from './middlewares/error.js';

export const buildApp = () => {
  const app = express();

  // Middlewares globales
  app.use(cors({ origin: ['http://localhost:5173'], credentials: false }));
  app.use(express.json());

  // Endpoint simple de health check
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Rutas
  app.use('/api/groups', groupsRouter);
  app.use('/api/players', playersRouter);
  app.use('/api/matches', matchesRouter);
  app.use('/api/auth', authRoutes);

  app.use(errorHandler);

  return app;
};
