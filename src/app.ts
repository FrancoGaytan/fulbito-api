// src/app.ts
import express from 'express';
import cors from 'cors';

import { groupsRouter } from './routes/groups.routes.js';
import { playersRouter } from './routes/players.routes.js';
import { matchesRouter } from './routes/matches.routes.js';

export const buildApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Rutas
  app.use('/api/groups', groupsRouter);
  app.use('/api/players', playersRouter);
  app.use('/api/matches', matchesRouter);

  return app;
};
