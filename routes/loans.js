const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.use(auth);

// ── List loans ────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT
      l.id, l.status, l.loaned_at, l.returned_at, l.due_date,
      b.id as book_id, b.title as book_title, b.author as book_author, b.category as book_category,
      u.id as user_id, u.name as user_name, u.unit as user_unit, u.email as user_email
    FROM loans l
    JOIN books b ON b.id = l.book_id
    JOIN users u ON u.id = l.user_id
  `;
  const params = [];
  if (status) { query += ' WHERE l.status = ?'; params.push(status); }
  query += ' ORDER BY l.loaned_at DESC';

  const loans = db.prepare(query).all(...params);
  res.json(loans);
});

// ── My loans (logged in resident) ─────────────────────────────────────────────
router.get('/my', (req, res) => {
  const loans = db.prepare(`
    SELECT
      l.id, l.status, l.loaned_at, l.returned_at, l.due_date,
      b.id as book_id, b.title as book_title, b.author as book_author, b.category as book_category
    FROM loans l
    JOIN books b ON b.id = l.book_id
    WHERE l.user_id = ?
    ORDER BY l.status = 'active' DESC, l.due_date ASC, l.loaned_at DESC
  `).all(req.user.id);
  res.json(loans);
});

// ── Lend a book ───────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { book_id, user_id, due_days = 14 } = req.body;
  if (!book_id || !user_id)
    return res.status(400).json({ error: 'book_id e user_id são obrigatórios.' });

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(book_id);
  if (!book) return res.status(404).json({ error: 'Livro não encontrado.' });
  if (book.available_copies < 1)
    return res.status(409).json({ error: 'Nenhum exemplar disponível para empréstimo.' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'Morador não encontrado.' });

  // Check if user already has this book active
  const alreadyActive = db.prepare(
    "SELECT id FROM loans WHERE book_id = ? AND user_id = ? AND status = 'active'"
  ).get(book_id, user_id);
  if (alreadyActive)
    return res.status(409).json({ error: 'Este morador já possui um exemplar deste livro emprestado.' });

  const due_date = Math.floor(Date.now() / 1000) + parseInt(due_days, 10) * 86400;

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO loans (book_id, user_id, due_date) VALUES (?, ?, ?)'
  ).run(book_id, user_id, due_date);

  db.prepare('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?').run(book_id);

  const loan = db.prepare(`
    SELECT l.*, b.title as book_title, u.name as user_name, u.unit as user_unit
    FROM loans l JOIN books b ON b.id=l.book_id JOIN users u ON u.id=l.user_id
    WHERE l.id = ?
  `).get(lastInsertRowid);

  res.status(201).json(loan);
});

// ── Return a book ─────────────────────────────────────────────────────────────
router.put('/:id/return', (req, res) => {
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Empréstimo não encontrado.' });
  if (loan.status === 'returned')
    return res.status(409).json({ error: 'Este empréstimo já foi devolvido.' });

  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE loans SET status = 'returned', returned_at = ? WHERE id = ?").run(now, loan.id);
  db.prepare('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?').run(loan.book_id);

  const updated = db.prepare(`
    SELECT l.*, b.title as book_title, u.name as user_name, u.unit as user_unit
    FROM loans l JOIN books b ON b.id=l.book_id JOIN users u ON u.id=l.user_id
    WHERE l.id = ?
  `).get(loan.id);
  res.json(updated);
});

// ── Get all users (for loan form dropdown) ────────────────────────────────────
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name, unit, email FROM users ORDER BY name').all();
  res.json(users);
});

module.exports = router;
