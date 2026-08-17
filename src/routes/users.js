'use strict';

const express = require('express');
const { state } = require('../store');
const { requireBearer, requireAdmin } = require('../auth');

const router = express.Router();

function publicView(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

// Admin-only listing — the "happy path" for role-based access control.
router.get('/users', requireBearer, requireAdmin, (req, res) => {
  res.json({ data: state.users.map(publicView), total: state.users.length });
});

/**
 * PRACTICE FLAW #1 — Broken Object Level Authorisation (OWASP API1).
 * Any authenticated user can read any other user's record just by changing
 * the id in the URL. There is no check that req.user.id === requested id.
 * Find it by logging in as 'tester' (id 2) and requesting /api/users/1.
 */
router.get('/users/:id', requireBearer, (req, res) => {
  const user = state.users.find((u) => u.id === Number(req.params.id));
  if (!user) {
    return res.status(404).json({ error: 'Not Found', message: `No user with id ${req.params.id}` });
  }
  res.json(publicView(user));
});

/**
 * PRACTICE FLAW #2 — Mass assignment (OWASP API6).
 * The handler spreads the whole request body over the stored user, so a
 * caller can send {"role": "admin"} and escalate their own privileges.
 */
router.patch('/users/:id', requireBearer, (req, res) => {
  const index = state.users.findIndex((u) => u.id === Number(req.params.id));
  if (index === -1) {
    return res.status(404).json({ error: 'Not Found', message: `No user with id ${req.params.id}` });
  }
  if (state.users[index].id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'You can only edit your own profile' });
  }

  state.users[index] = { ...state.users[index], ...req.body, id: state.users[index].id };
  res.json(publicView(state.users[index]));
});

/**
 * PRACTICE FLAW #3 — Excessive data exposure (OWASP API3).
 * This endpoint leaks password and apiKey in the response body.
 */
router.get('/users/:id/profile', requireBearer, (req, res) => {
  const user = state.users.find((u) => u.id === Number(req.params.id));
  if (!user) {
    return res.status(404).json({ error: 'Not Found', message: `No user with id ${req.params.id}` });
  }
  res.json(user);
});

router.delete('/users/:id', requireBearer, requireAdmin, (req, res) => {
  const index = state.users.findIndex((u) => u.id === Number(req.params.id));
  if (index === -1) {
    return res.status(404).json({ error: 'Not Found', message: `No user with id ${req.params.id}` });
  }
  state.users.splice(index, 1);
  res.status(204).send();
});

module.exports = router;
