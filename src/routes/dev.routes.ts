import { Router } from 'express';
import { runSeedByOwnerId } from '../dev/seed.js';

export const devRouter = Router();

// Simple guard: solo si no es producción y si opcionalmente pasás un token
devRouter.post('/seed', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Dev routes disabled in production' });
    }
    const token = req.query.token ?? req.headers['x-dev-token'];
    if (process.env.DEV_TOKEN && token !== process.env.DEV_TOKEN) {
      return res.status(401).json({ error: 'Invalid dev token' });
    }

    const summary = await runSeedByOwnerId(req.userId!, { wipe: true });
    res.status(201).json({ ok: true, summary });
  } catch (e) {
    next(e);
  }
});
