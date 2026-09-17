const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'biblioteca_residencial_secret_2024';

// ── Register (Morador) ────────────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { name, unit, email, password, cpf, whatsapp } = req.body;
  if (!name || !unit || !email || !password || !cpf || !whatsapp)
    return res.status(400).json({ error: 'Todos os campos são obrigatórios (Nome, Unidade, E-mail, Senha, CPF e WhatsApp).' });

  const cleanEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing)
    return res.status(409).json({ error: 'E-mail já cadastrado.' });

  const password_hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (name, unit, email, password_hash, cpf, whatsapp, role) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name.trim(), unit.trim(), cleanEmail, password_hash, cpf.trim(), whatsapp.trim(), 'resident');

  const user = db.prepare('SELECT id, name, unit, email, cpf, whatsapp, role FROM users WHERE id = ?').get(lastInsertRowid);
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user });
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Credenciais inválidas.' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password_hash, reset_token, reset_token_expires, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// ── Forgot Password ───────────────────────────────────────────────────────────
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: 'E-mail é obrigatório.' });

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  // Always return success to avoid user enumeration
  if (user) {
    const token = uuidv4();
    const expires = Date.now() + 3600_000; // 1 hour
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
      .run(token, expires, user.id);
    // Simulate email — in production, send via nodemailer
    console.log(`[RESET TOKEN] ${email} → ${token}`);
  }

  res.json({ message: `Se o e-mail ${email} estiver cadastrado, você receberá as instruções em breve.`, simulatedToken: user ? db.prepare('SELECT reset_token FROM users WHERE email = ?').get(email)?.reset_token : null });
});

// ── Reset Password ────────────────────────────────────────────────────────────
router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password)
    return res.status(400).json({ error: 'Token e nova senha são obrigatórios.' });

  const user = db.prepare(
    'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > ?'
  ).get(token, Date.now());

  if (!user)
    return res.status(400).json({ error: 'Token inválido ou expirado.' });

  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
    .run(password_hash, user.id);

  res.json({ message: 'Senha redefinida com sucesso.' });
});

// ── Me ────────────────────────────────────────────────────────────────────────
const authMiddleware = require('../middleware/auth');
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, name, unit, email, role, cpf, whatsapp, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

module.exports = router;
