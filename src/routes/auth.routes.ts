import { Router } from 'express';
import { User } from '../models/user.model.js';
import { hashSha256, genSixDigitCode, genSessionToken, minutesFromNow } from '../utils/reset-password.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXP = '7d';

router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) return res.status(400).json({ message: 'email y password requeridos' });

    // Chequeo optimista (evita consulta extra si hay race)
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'Email ya registrado' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, passwordHash });

    const token = jwt.sign({ sub: user.id, email }, JWT_SECRET, { expiresIn: JWT_EXP });
    res.status(201).json({ token });
  } catch (err: any) {
    // Manejo de condición de carrera -> índice único Mongo
    if (err && err.code === 11000) {
      return res.status(409).json({ message: 'Email ya registrado' });
    }
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' });

    const token = jwt.sign({ sub: user.id, email }, JWT_SECRET, { expiresIn: JWT_EXP });
    res.json({ token });
  } catch (err) { next(err); }
});

/* ------------------------- Password Reset (6 digit code) ------------------------- */

// 1. Solicitar código (responde 200 siempre)
router.post('/request-reset-code', async (req, res, next) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(200).json({ ok: true, message: 'If the email exists, a reset code was generated.' });
    const user = await User.findOne({ email });
    if (user) {
      const code = genSixDigitCode();
      user.resetCodeHash = hashSha256(code);
      const ttlMin = Number(process.env.RESET_CODE_TTL_MINUTES || '15');
      user.resetCodeExpires = minutesFromNow(ttlMin);
      // invalidar session token anterior
      user.passwordResetSessionToken = null;
      await user.save();
      const payload: any = { ok: true, message: 'If the email exists, a reset code was generated.' };
      if (process.env.NODE_ENV !== 'production') payload.devCode = code;
      return res.status(200).json(payload);
    }
    return res.status(200).json({ ok: true, message: 'If the email exists, a reset code was generated.' });
  } catch (err) { next(err); }
});

// 2. Verificar código y devolver resetSessionToken
router.post('/verify-reset-code', async (req, res, next) => {
  try {
    const { email, code } = req.body as { email?: string; code?: string };
    if (!email || !code) return res.status(400).json({ message: 'Código inválido' });
    const user = await User.findOne({ email });
    if (!user || !user.resetCodeHash || !user.resetCodeExpires) {
      return res.status(400).json({ message: 'Código inválido' });
    }
    if (user.resetCodeExpires.getTime() < Date.now()) {
      return res.status(400).json({ message: 'Código expirado' });
    }
    const codeHash = hashSha256(code);
    if (codeHash !== user.resetCodeHash) {
      return res.status(400).json({ message: 'Código inválido' });
    }
    // generar session token
    const session = genSessionToken();
    user.passwordResetSessionToken = hashSha256(session);
    // invalidar código para que no se reutilice
    user.resetCodeHash = null;
    user.resetCodeExpires = null;
    await user.save();
    return res.json({ resetSessionToken: session });
  } catch (err) { next(err); }
});

// 3. Aplicar nueva contraseña
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, resetSessionToken, newPassword } = req.body as { email?: string; resetSessionToken?: string; newPassword?: string };
    if (!email || !resetSessionToken || !newPassword) {
      return res.status(400).json({ message: 'Datos faltantes' });
    }
    const user = await User.findOne({ email });
    if (!user || !user.passwordResetSessionToken) {
      return res.status(400).json({ message: 'Token inválido' });
    }
    const tokenHash = hashSha256(resetSessionToken);
    if (tokenHash !== user.passwordResetSessionToken) {
      return res.status(400).json({ message: 'Token inválido' });
    }
    // actualizar password
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    // limpiar session token
    user.passwordResetSessionToken = null;
    await user.save();
    // opcional: login automático
    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXP });
    return res.json({ ok: true, token });
  } catch (err) { next(err); }
});

export default router;
