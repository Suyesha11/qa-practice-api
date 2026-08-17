'use strict';

const express = require('express');
const crypto = require('crypto');
const { state, reset } = require('../store');
const { rateLimit } = require('../middleware');

const router = express.Router();

// --- Health & housekeeping ---------------------------------------------------

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    counts: {
      users: state.users.length,
      bookings: state.bookings.length,
      products: state.products.length,
      webhooks: state.webhooks.length,
    },
    requestsServed: state.counters.requests,
  });
});

router.post('/reset', (req, res) => {
  reset();
  res.json({ message: 'All data reset to seed state', at: new Date().toISOString() });
});

// --- Response-time behaviour (for performance testing) -----------------------

router.get('/slow', (req, res) => {
  const ms = Math.min(10000, Math.max(0, parseInt(req.query.ms, 10) || 2000));
  setTimeout(() => {
    res.json({ message: `Responded after ${ms}ms`, delayMs: ms });
  }, ms);
});

router.get('/variable-latency', (req, res) => {
  const ms = Math.floor(Math.random() * 1500) + 100;
  setTimeout(() => res.json({ message: 'Variable latency response', actualDelayMs: ms }), ms);
});

router.get('/flaky', (req, res) => {
  const failureRate = Math.min(1, Math.max(0, parseFloat(req.query.failureRate) || 0.3));
  if (Math.random() < failureRate) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'This endpoint fails randomly. Use it to practise retry logic.',
    });
  }
  res.json({ message: 'Success this time', failureRate });
});

// --- Status codes ------------------------------------------------------------

router.all('/status/:code', (req, res) => {
  const code = parseInt(req.params.code, 10);
  if (Number.isNaN(code) || code < 100 || code > 599) {
    return res.status(400).json({ error: 'Bad Request', message: 'Status code must be between 100 and 599' });
  }
  if (code === 204 || code === 304) return res.status(code).send();
  res.status(code).json({ requestedStatus: code, method: req.method });
});

router.get('/redirect', (req, res) => {
  const times = Math.min(5, Math.max(1, parseInt(req.query.times, 10) || 1));
  if (times === 1) return res.redirect(302, '/api/health');
  res.redirect(302, `/api/redirect?times=${times - 1}`);
});

// --- Rate limiting -----------------------------------------------------------

router.get('/limited', rateLimit({ windowMs: 60000, max: 5 }), (req, res) => {
  res.json({ message: 'Within the rate limit', limit: 5, windowSeconds: 60 });
});

// --- Caching -----------------------------------------------------------------

router.get('/cached', (req, res) => {
  const body = { message: 'This response is cacheable', generatedAt: '2026-01-01T00:00:00.000Z' };
  const etag = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex');

  res.set('Cache-Control', 'public, max-age=60');
  res.set('ETag', `"${etag}"`);

  if (req.get('If-None-Match') === `"${etag}"`) return res.status(304).send();
  res.json(body);
});

// --- Content types -----------------------------------------------------------

router.get('/xml', (req, res) => {
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>
<booking>
  <id>1</id>
  <firstname>Aditi</firstname>
  <lastname>Kulkarni</lastname>
  <totalPrice>90</totalPrice>
</booking>`
  );
});

router.get('/text', (req, res) => {
  res.type('text/plain').send('A plain text response. Assert on the raw body, not JSON.');
});

router.get('/large', (req, res) => {
  const count = Math.min(2000, Math.max(1, parseInt(req.query.count, 10) || 500));
  const data = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    reference: `REF-${String(i + 1).padStart(6, '0')}`,
    value: Math.round(Math.random() * 10000) / 100,
    active: i % 3 !== 0,
  }));
  res.json({ data, count });
});

router.post('/echo', (req, res) => {
  res.json({
    method: req.method,
    headers: req.headers,
    query: req.query,
    body: req.body,
    contentType: req.get('Content-Type') || null,
    receivedAt: new Date().toISOString(),
  });
});

// --- Deliberately fragile input handling -------------------------------------

/**
 * PRACTICE FLAW #4 — unhandled input.
 * Passing ?value= with a non-numeric string throws, returning a 500 where a
 * 400 would be correct. A negative number also slips through unvalidated.
 */
router.get('/calculate', (req, res) => {
  const value = req.query.value;
  const result = Number(value).toFixed(2);
  if (result === 'NaN') {
    throw new Error('Cannot convert value to a number');
  }
  res.json({ input: value, squareRoot: Math.sqrt(Number(value)), formatted: result });
});

// --- Live feed for the dashboard ---------------------------------------------

router.get('/_internal/activity', (req, res) => {
  res.json({
    requests: state.requestLog,
    counters: state.counters,
    counts: {
      users: state.users.length,
      bookings: state.bookings.length,
      products: state.products.length,
      webhooks: state.webhooks.length,
      deliveries: state.deliveries.length,
    },
    bookings: state.bookings.slice(-8).reverse(),
    products: state.products.slice(0, 8),
    users: state.users.map((u) => ({ id: u.id, username: u.username, role: u.role, email: u.email })),
    deliveries: state.deliveries.slice(0, 8),
  });
});

module.exports = router;
