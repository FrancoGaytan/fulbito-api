import express from 'express';
import cors from 'cors';
import { groupRouter } from './modules/groups/group.routes';

export const buildApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // rutas de la primera iteración
  app.use('/api/groups', groupRouter);

  return app;
};