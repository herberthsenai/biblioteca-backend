const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.use(auth);

// ── List all residents with reading metrics ──────────────────────────────────
router.get('/', (req, res) => {
  const { search, status } = req.query;
  const now = Math.floor(Date.now() / 1000);

  let query = `
    SELECT 
      u.id, 
      u.name, 
      u.unit, 
      u.email, 
      u.cpf,
      u.whatsapp,
      u.role, 
      u.created_at,
      COUNT(l.id) AS total_loans,
      COALESCE(SUM(CASE WHEN l.status = 'active' THEN 1 ELSE 0 END), 0) AS active_loans,
      COALESCE(SUM(CASE WHEN l.status = 'active' AND l.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_loans,
      COALESCE(SUM(CASE WHEN l.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_loans
    FROM users u
    LEFT JOIN loans l ON l.user_id = u.id
    WHERE 1=1
  `;
  const params = [now];

  if (search) {
    query += ' AND (u.name LIKE ? OR u.unit LIKE ? OR u.email LIKE ? OR u.cpf LIKE ? OR u.whatsapp LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' GROUP BY u.id';

  if (status === 'active') {
    query += ' HAVING active_loans > 0';
  } else if (status === 'overdue') {
    query += ' HAVING overdue_loans > 0';
  } else if (status === 'clear') {
    query += ' HAVING active_loans = 0 AND overdue_loans = 0';
  }

  query += ' ORDER BY u.unit ASC, u.name ASC';

  try {
    const residents = db.prepare(query).all(...params);
    res.json(residents);
  } catch (err) {
    console.error('Erro ao listar moradores:', err);
    res.status(500).json({ error: 'Erro ao listar moradores.' });
  }
});

// ── Get detailed reading history for a resident ─────────────────────────────
router.get('/:id/history', (req, res) => {
  const resident = db.prepare('SELECT id, name, unit, email, cpf, whatsapp, role, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!resident) return res.status(404).json({ error: 'Morador não encontrado.' });

  const query = `
    SELECT 
      l.id, 
      l.book_id, 
      l.loaned_at, 
      l.returned_at, 
      l.due_date, 
      l.status,
      b.title AS book_title, 
      b.author AS book_author, 
      b.category AS book_category
    FROM loans l
    JOIN books b ON b.id = l.book_id
    WHERE l.user_id = ?
    ORDER BY l.loaned_at DESC
  `;

  const loans = db.prepare(query).all(req.params.id);

  res.json({
    resident,
    loans
  });
});

// ── Update resident details (unit / name) ───────────────────────────────────
router.put('/:id', (req, res) => {
  const { name, unit } = req.body;
  if (!name || !unit) {
    return res.status(400).json({ error: 'Nome e unidade são obrigatórios.' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Morador não encontrado.' });

  db.prepare('UPDATE users SET name = ?, unit = ? WHERE id = ?').run(name.trim(), unit.trim(), req.params.id);
  const updated = db.prepare('SELECT id, name, unit, email, role, created_at FROM users WHERE id = ?').get(req.params.id);

  res.json(updated);
});

// ── Delete resident (Admin only) ─────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas o administrador pode excluir moradores.' });
  }

  const residentId = parseInt(req.params.id, 10);
  if (residentId === req.user.id) {
    return res.status(400).json({ error: 'O administrador não pode excluir a sua própria conta.' });
  }

  const resident = db.prepare('SELECT id, name, unit, role FROM users WHERE id = ?').get(residentId);
  if (!resident) {
    return res.status(404).json({ error: 'Morador não encontrado.' });
  }

  // Check if resident has active or pending loans
  const pendingOrActive = db.prepare(
    "SELECT COUNT(*) as c FROM loans WHERE user_id = ? AND status IN ('active', 'pending')"
  ).get(residentId).c;

  if (pendingOrActive > 0) {
    return res.status(409).json({
      error: `Não é possível excluir ${resident.name}. O morador possui ${pendingOrActive} livro(s) em mãos ou pedidos pendentes. Registre a devolução antes de excluir.`
    });
  }

  // Delete past loans and user
  db.prepare('DELETE FROM loans WHERE user_id = ?').run(residentId);
  db.prepare('DELETE FROM users WHERE id = ?').run(residentId);

  res.json({ message: `Morador ${resident.name} (${resident.unit}) excluído com sucesso.` });
});

module.exports = router;
