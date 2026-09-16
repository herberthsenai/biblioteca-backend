const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/books', require('./routes/books'));
app.use('/api/loans', require('./routes/loans'));
app.use('/api/users', require('./routes/users'));

// ── Root & Health check ───────────────────────────────────────────────────────
app.get('/', (_, res) => {
  res.json({
    name: 'Biblioteca Residencial API',
    status: 'online',
    frontend: 'http://localhost:5173',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      books: '/api/books',
      loans: '/api/loans',
      users: '/api/users',
    },
  });
});

app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📚 Biblioteca Residencial — API pronta!\n`);
  console.log(`   Usuários demo:`);
  console.log(`   admin@biblioteca.com / admin123 (Administrador)`);
  console.log(`   maria@email.com / morador123 (Moradora)\n`);
});
