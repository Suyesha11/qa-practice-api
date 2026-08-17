'use strict';

const path = require('path');
const express = require('express');

const { requestLogger } = require('./src/middleware');
const authRoutes = require('./src/routes/auth');
const bookingRoutes = require('./src/routes/bookings');
const userRoutes = require('./src/routes/users');
const productRoutes = require('./src/routes/products');
const webhookRoutes = require('./src/routes/webhooks');
const testingRoutes = require('./src/routes/testing');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain' }));
app.use(requestLogger);

// Handy for asserting on custom headers in tests.
app.use((req, res, next) => {
  res.set('X-Powered-By', 'qa-practice-api');
  res.set('X-Request-Id', Math.random().toString(36).slice(2, 12));
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', authRoutes);
app.use('/api', bookingRoutes);
app.use('/api', userRoutes);
app.use('/api', productRoutes);
app.use('/api', webhookRoutes);
app.use('/api', testingRoutes);

// Malformed JSON should read as a client error, not a server crash.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Request body is not valid JSON',
      detail: err.message,
    });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload Too Large', message: 'Request body exceeds the 1mb limit' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `No route matches ${req.method} ${req.originalUrl}`,
  });
});

app.listen(PORT, () => {
  console.log('');
  console.log('  QA Practice API');
  console.log(`  Dashboard   http://localhost:${PORT}`);
  console.log(`  API base    http://localhost:${PORT}/api`);
  console.log('');
  console.log('  Seed accounts');
  console.log('    admin  / admin123   (role: admin)');
  console.log('    tester / tester123  (role: user)');
  console.log('    other  / other123   (role: user)');
  console.log('');
  console.log('  Reset data at any time with  POST /api/reset');
  console.log('');
});
