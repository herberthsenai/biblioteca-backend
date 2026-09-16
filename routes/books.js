const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// All book routes require authentication
router.use(auth);

// ── List all books ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { search, category } = req.query;
  let query = 'SELECT * FROM books WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (title LIKE ? OR author LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }
  query += ' ORDER BY title ASC';

  const books = db.prepare(query).all(...params);
  res.json(books);
});

// ── Get categories ────────────────────────────────────────────────────────────
router.get('/categories', (req, res) => {
  const categories = db.prepare('SELECT DISTINCT category FROM books ORDER BY category').all();
  res.json(categories.map(r => r.category));
});

// ── Get single book ───────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Livro não encontrado.' });
  res.json(book);
});

// ── Create book ───────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { title, author, category, total_copies } = req.body;
  if (!title || !author || !category || !total_copies)
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });

  const copies = parseInt(total_copies, 10);
  if (isNaN(copies) || copies < 1)
    return res.status(400).json({ error: 'Quantidade de exemplares inválida.' });

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO books (title, author, category, total_copies, available_copies) VALUES (?, ?, ?, ?, ?)'
  ).run(title.trim(), author.trim(), category.trim(), copies, copies);

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(lastInsertRowid);
  res.status(201).json(book);
});

// ── Update book ───────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Livro não encontrado.' });

  const { title, author, category, total_copies } = req.body;
  const copies = parseInt(total_copies, 10);
  if (isNaN(copies) || copies < 1)
    return res.status(400).json({ error: 'Quantidade de exemplares inválida.' });

  // Recalculate available copies when total changes
  const borrowed = book.total_copies - book.available_copies;
  const newAvailable = Math.max(0, copies - borrowed);

  db.prepare(
    'UPDATE books SET title = ?, author = ?, category = ?, total_copies = ?, available_copies = ? WHERE id = ?'
  ).run(title?.trim() || book.title, author?.trim() || book.author, category?.trim() || book.category, copies, newAvailable, book.id);

  const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(book.id);
  res.json(updated);
});

// ── Delete book ───────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Livro não encontrado.' });

  const activeLoans = db.prepare("SELECT COUNT(*) as c FROM loans WHERE book_id = ? AND status = 'active'").get(book.id).c;
  if (activeLoans > 0)
    return res.status(409).json({ error: 'Livro possui empréstimos ativos. Devolva antes de excluir.' });

  db.prepare('DELETE FROM books WHERE id = ?').run(book.id);
  res.json({ message: 'Livro excluído com sucesso.' });
});

module.exports = router;
