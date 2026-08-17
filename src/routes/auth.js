'use strict';

const express = require('express');
const { state, nextId } = require('../store');
const {
  sign, issueRefreshToken, requireBearer, requireBasic, requireApiKey,
  requireOAuthScope, OAUTH_CLIENTS, ACCESS_TOKEN_TTL_SECONDS,
} = require('../auth');
const { validate, validationFailed, rateLimit } = require('../middleware');

const router = express.Router();

// --- Registration -----------------------------------------------------------

router.post('/auth/register', (req, res) => {
  const errors = validate([
    { field: 'username', required: true, type: 'string', maxLength: 30 },
    { field: 'password', required: true, type: 'string' },
    { field: 'email', required: true, type: 'string', pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ },
  ], req.body);

  if (errors.length) return validationFailed(res, errors);

  if (state.users.some((u) => u.username === req.body.username)) {
    return res.status(409).json({
      error: 'Conflict',
      message: `Username '${req.body.username}' is already taken`,
    });
  }
  if (String(req.body.password).length < 6) {
    return validationFailed(res, [{ field: 'password', message: 'password must be at least 6 characters' }]);
  }

  const user = {
    id: nextId('user'),
    username: req.body.username,
    password: req.body.password,
    email: req.body.email,
    role: 'user',
    apiKey: `qap_user_key_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  state.users.push(user);

  res.status(201).json({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    apiKey: user.apiKey,
    createdAt: user.createdAt,
  });
});

// --- Login / refresh / logout ----------------------------------------------

// Deliberately rate limited: 10 attempts per minute, so brute-force protection
// can be tested.
router.post('/auth/login', rateLimit({ windowMs: 60000, max: 10 }), (req, res) => {
  const errors = validate([
    { field: 'username', required: true, type: 'string' },
    { field: 'password', required: true, type: 'string' },
  ], req.body);
  if (errors.length) return validationFailed(res, errors);

  const user = state.users.find(
    (u) => u.username === req.body.username && u.password === req.body.password
  );
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Username or password is incorrect' });
  }

  res.json({
    accessToken: sign({ sub: user.id, username: user.username, role: user.role, type: 'access' }),
    refreshToken: issueRefreshToken(user.id),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// Short-lived token endpoint: useful for practising token-expiry handling
// without waiting 15 minutes.
router.post('/auth/login-short', (req, res) => {
  const user = state.users.find(
    (u) => u.username === req.body.username && u.password === req.body.password
  );
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Username or password is incorrect' });
  }
  res.json({
    accessToken: sign({ sub: user.id, username: user.username, role: user.role, type: 'access' }, 10),
    tokenType: 'Bearer',
    expiresIn: 10,
    note: 'This token expires in 10 seconds. Use it to test expiry handling.',
  });
});

router.post('/auth/refresh', (req, res) => {
  const token = req.body.refreshToken;
  if (!token) {
    return validationFailed(res, [{ field: 'refreshToken', message: 'refreshToken is required' }]);
  }
  const userId = state.refreshTokens.get(token);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Refresh token is invalid or has been revoked' });
  }
  const user = state.users.find((u) => u.id === userId);
  state.refreshTokens.delete(token); // rotate

  res.json({
    accessToken: sign({ sub: user.id, username: user.username, role: user.role, type: 'access' }),
    refreshToken: issueRefreshToken(user.id),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
});

router.post('/auth/logout', requireBearer, (req, res) => {
  for (const [token, userId] of state.refreshTokens.entries()) {
    if (userId === req.user.id) state.refreshTokens.delete(token);
  }
  res.status(204).send();
});

router.get('/auth/me', requireBearer, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
    role: req.user.role,
    tokenIssuedAt: new Date(req.tokenPayload.iat * 1000).toISOString(),
    tokenExpiresAt: new Date(req.tokenPayload.exp * 1000).toISOString(),
  });
});

// --- OAuth 2.0 client credentials -------------------------------------------

router.post('/oauth/token', (req, res) => {
  let { grant_type: grantType, client_id: clientId, client_secret: clientSecret, scope } = req.body || {};

  // Credentials may also arrive via Basic auth, as the spec allows.
  const header = req.get('Authorization') || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    clientId = decoded.slice(0, idx);
    clientSecret = decoded.slice(idx + 1);
  }

  if (grantType !== 'client_credentials') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only client_credentials is supported by this server',
    });
  }

  const client = OAUTH_CLIENTS.find((c) => c.clientId === clientId && c.clientSecret === clientSecret);
  if (!client) {
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Client authentication failed',
    });
  }

  const requested = scope ? String(scope).split(' ') : client.scopes;
  const granted = requested.filter((s) => client.scopes.includes(s));

  res.json({
    access_token: sign({ sub: client.clientId, type: 'oauth', scope: granted.join(' ') }, 3600),
    token_type: 'Bearer',
    expires_in: 3600,
    scope: granted.join(' '),
  });
});

router.get('/oauth/protected', requireOAuthScope('read'), (req, res) => {
  res.json({
    message: 'You reached an OAuth-protected resource',
    client: req.oauth.sub,
    scope: req.oauth.scope,
  });
});

router.post('/oauth/protected-write', requireOAuthScope('write'), (req, res) => {
  res.status(201).json({ message: 'Write accepted', client: req.oauth.sub, received: req.body });
});

// --- Other auth schemes ------------------------------------------------------

router.get('/basic-protected', requireBasic, (req, res) => {
  res.json({ message: 'Basic authentication succeeded', user: req.user.username, role: req.user.role });
});

router.get('/apikey-protected', requireApiKey, (req, res) => {
  res.json({ message: 'API key accepted', user: req.user.username, role: req.user.role });
});

module.exports = router;
