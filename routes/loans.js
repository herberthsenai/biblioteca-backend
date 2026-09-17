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
      u.id as user_id, u.name as user_name, u.unit as user_unit, u.email as user_email,
      u.cpf as user_cpf, u.whatsapp as user_whatsapp
    FROM loans l
    JOIN books b ON b.id = l.book_id
    JOIN users u ON u.id = l.user_id
  `;
  const params = [];
  if (status) { query += ' WHERE l.status = ?'; params.push(status); }
  query += ' ORDER BY CASE l.status WHEN \'pending\' THEN 1 WHEN \'active\' THEN 2 ELSE 3 END, l.loaned_at DESC';

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
    ORDER BY CASE l.status WHEN 'pending' THEN 1 WHEN 'active' THEN 2 ELSE 3 END, l.due_date ASC, l.loaned_at DESC
  `).all(req.user.id);
  res.json(loans);
});

// ── Lend or request a book ───────────────────────────────────────────────────
router.post('/', (req, res) => {
  let { book_id, user_id, due_days = 14 } = req.body;
  const isAdmin = req.user.role === 'admin';

  // If not admin, user can only request for themselves
  if (!isAdmin) {
    user_id = req.user.id;
  }

  if (!book_id || !user_id)
    return res.status(400).json({ error: 'book_id e user_id são obrigatórios.' });

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(book_id);
  if (!book) return res.status(404).json({ error: 'Livro não encontrado.' });
  if (book.available_copies < 1)
    return res.status(409).json({ error: 'Nenhum exemplar disponível no momento.' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'Morador não encontrado.' });

  // Check if user already has an active or pending loan for this book
  const existingLoan = db.prepare(
    "SELECT id, status FROM loans WHERE book_id = ? AND user_id = ? AND status IN ('active', 'pending')"
  ).get(book_id, user_id);
  if (existingLoan) {
    if (existingLoan.status === 'pending')
      return res.status(409).json({ error: 'Você já possui uma solicitação pendente para este livro.' });
    return res.status(409).json({ error: 'Este morador já possui um exemplar ativo deste livro.' });
  }

  const days = parseInt(due_days, 10) || 14;
  const now = Math.floor(Date.now() / 1000);
  const due_date = now + days * 86400;

  // If admin creates, status is 'active'; if resident requests, status is 'pending'
  const initialStatus = isAdmin ? 'active' : 'pending';

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO loans (book_id, user_id, loaned_at, due_date, status) VALUES (?, ?, ?, ?, ?)'
  ).run(book_id, user_id, now, due_date, initialStatus);

  // Reserve copy
  db.prepare('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?').run(book_id);

  const loan = db.prepare(`
    SELECT l.*, b.title as book_title, u.name as user_name, u.unit as user_unit, u.cpf as user_cpf, u.whatsapp as user_whatsapp
    FROM loans l JOIN books b ON b.id=l.book_id JOIN users u ON u.id=l.user_id
    WHERE l.id = ?
  `).get(lastInsertRowid);

  res.status(201).json(loan);
});

// ── Approve a loan request (Admin only) ───────────────────────────────────────
router.put('/:id/approve', (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Apenas o administrador pode aprovar empréstimos.' });

  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (loan.status !== 'pending')
    return res.status(400).json({ error: `Esta solicitação já está com status "${loan.status}".` });

  const now = Math.floor(Date.now() / 1000);
  // Recalculate 14 days from approval time
  const due_date = now + 14 * 86400;

  db.prepare("UPDATE loans SET status = 'active', loaned_at = ?, due_date = ? WHERE id = ?")
    .run(now, due_date, loan.id);

  const updated = db.prepare(`
    SELECT l.*, b.title as book_title, u.name as user_name, u.unit as user_unit, u.cpf as user_cpf, u.whatsapp as user_whatsapp
    FROM loans l JOIN books b ON b.id=l.book_id JOIN users u ON u.id=l.user_id
    WHERE l.id = ?
  `).get(loan.id);

  res.json(updated);
});

// ── Reject a loan request (Admin only) ────────────────────────────────────────
router.put('/:id/reject', (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Apenas o administrador pode recusar empréstimos.' });

  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (loan.status !== 'pending')
    return res.status(400).json({ error: `Esta solicitação não está mais pendente (status atual: "${loan.status}").` });

  db.prepare("UPDATE loans SET status = 'rejected' WHERE id = ?").run(loan.id);

  // Restore copy availability
  db.prepare('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?').run(loan.book_id);

  const updated = db.prepare(`
    SELECT l.*, b.title as book_title, u.name as user_name, u.unit as user_unit, u.cpf as user_cpf, u.whatsapp as user_whatsapp
    FROM loans l JOIN books b ON b.id=l.book_id JOIN users u ON u.id=l.user_id
    WHERE l.id = ?
  `).get(loan.id);

  res.json(updated);
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
    SELECT l.*, b.title as book_title, u.name as user_name, u.unit as user_unit, u.cpf as user_cpf, u.whatsapp as user_whatsapp
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
