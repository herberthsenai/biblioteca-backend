const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'library.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for better performance
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    unit                TEXT    NOT NULL,
    email               TEXT    NOT NULL UNIQUE,
    password_hash       TEXT    NOT NULL,
    cpf                 TEXT,
    whatsapp            TEXT,
    role                TEXT    NOT NULL DEFAULT 'resident',
    reset_token         TEXT,
    reset_token_expires INTEGER,
    created_at          INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS books (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT    NOT NULL,
    author           TEXT    NOT NULL,
    category         TEXT    NOT NULL,
    total_copies     INTEGER NOT NULL DEFAULT 1,
    available_copies INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS loans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    loaned_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    returned_at INTEGER,
    due_date    INTEGER NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'active'
  );
`);

// Migrations for existing databases
try { db.exec('ALTER TABLE users ADD COLUMN cpf TEXT;'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN whatsapp TEXT;'); } catch {}

// ── Admin user setup ──────────────────────────────────────────────────────────
const bcrypt = require('bcryptjs');

const adminEmail = 'herberthfaquimbrasil@gmail.com';
const adminPass = '8732#!Sp@2026';
const adminHash = bcrypt.hashSync(adminPass, 10);
const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

if (!existingAdmin) {
  db.prepare(`
    INSERT INTO users (name, unit, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('Herberth Brasil', 'Administração', adminEmail, adminHash, 'admin');
} else {
  db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?')
    .run(adminHash, 'admin', existingAdmin.id);
}

const bookCount = db.prepare('SELECT COUNT(*) as c FROM books').get().c;
if (bookCount === 0) {
  const books = [
    ['Dom Casmurro', 'Machado de Assis', 'Literatura Brasileira', 3, 3],
    ['O Senhor dos Anéis', 'J.R.R. Tolkien', 'Fantasia', 2, 2],
    ['Harry Potter e a Pedra Filosofal', 'J.K. Rowling', 'Fantasia', 4, 4],
    ['1984', 'George Orwell', 'Distopia', 2, 2],
    ['O Pequeno Príncipe', 'Antoine de Saint-Exupéry', 'Fábula', 5, 5],
    ['Sapiens', 'Yuval Noah Harari', 'História', 2, 2],
    ['A Revolução dos Bichos', 'George Orwell', 'Distopia', 3, 3],
    ['O Alquimista', 'Paulo Coelho', 'Ficção', 3, 3],
  ];
  const insert = db.prepare(
    'INSERT INTO books (title, author, category, total_copies, available_copies) VALUES (?, ?, ?, ?, ?)'
  );
  books.forEach(b => insert.run(...b));
}

const loanCount = db.prepare('SELECT COUNT(*) as c FROM loans').get().c;
if (loanCount === 0) {
  const maria = db.prepare('SELECT id FROM users WHERE email = ?').get('maria@email.com');
  const book = db.prepare('SELECT id FROM books WHERE title = ?').get('Dom Casmurro');
  if (maria && book) {
    const now = Math.floor(Date.now() / 1000);
    const due = now + 7 * 86400; // 7 days from now
    db.prepare(
      'INSERT INTO loans (book_id, user_id, loaned_at, due_date, status) VALUES (?, ?, ?, ?, ?)'
    ).run(book.id, maria.id, now - 86400 * 2, due, 'active');
    db.prepare('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?').run(book.id);
  }
}

module.exports = db;
