'use strict';

const crypto = require('crypto');
const { state } = require('./store');

const JWT_SECRET = 'qa-practice-api-secret-do-not-use-in-production';
const ACCESS_TOKEN_TTL_SECONDS = 900; // 15 minutes

// OAuth 2.0 client credentials — fixed so collections stay reproducible.
const OAUTH_CLIENTS = [
  { clientId: 'qa-practice-client', clientSecret: 's3cr3t-client-value', scopes: ['read', 'write'] },
  { clientId: 'readonly-client', clientSecret: 'readonly-secret', scopes: ['read'] },
];

// --- JWT (hand-rolled HS256, no external dependency) ------------------------

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sign(payload, ttlSeconds = ACCESS_TOKEN_TTL_SECONDS) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedBody}.${signature}`;
}

function verify(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };

  const [encodedHeader, encodedBody, signature] = parts;
  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (signature !== expected) return { valid: false, reason: 'bad_signature' };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedBody, 'base64').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, payload };
}

function issueRefreshToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  state.refreshTokens.set(token, userId);
  return token;
}

// --- Middleware -------------------------------------------------------------

function unauthorized(res, message, detail) {
  return res.status(401).json({ error: 'Unauthorized', message, detail });
}

/** Requires a valid Bearer token. Attaches req.user. */
function requireBearer(req, res, next) {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) {
    return unauthorized(res, 'Missing or malformed Authorization header. Expected: Bearer <token>');
  }
  const result = verify(header.slice(7).trim());
  if (!result.valid) {
    const messages = {
      expired: 'Access token has expired. Use POST /api/auth/refresh to get a new one.',
      bad_signature: 'Token signature does not match. The token has been altered.',
      malformed: 'Token is not a well-formed JWT.',
    };
    return unauthorized(res, messages[result.reason] || 'Invalid token', result.reason);
  }
  const user = state.users.find((u) => u.id === result.payload.sub);
  if (!user) return unauthorized(res, 'Token refers to a user that no longer exists');
  req.user = user;
  req.tokenPayload = result.payload;
  next();
}

/** Requires HTTP Basic credentials matching a real user. */
function requireBasic(req, res, next) {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="qa-practice-api"');
    return unauthorized(res, 'Missing Basic credentials. Expected: Basic <base64(username:password)>');
  }
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return unauthorized(res, 'Basic credentials are not valid base64');
  }
  const separatorIndex = decoded.indexOf(':');
  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  const user = state.users.find((u) => u.username === username && u.password === password);
  if (!user) {
    res.set('WWW-Authenticate', 'Basic realm="qa-practice-api"');
    return unauthorized(res, 'Username or password is incorrect');
  }
  req.user = user;
  next();
}

/** Requires an API key, sent as x-api-key header or ?api_key= query param. */
function requireApiKey(req, res, next) {
  const key = req.get('x-api-key') || req.query.api_key;
  if (!key) {
    return unauthorized(res, 'Missing API key. Send it as the x-api-key header or ?api_key= query parameter.');
  }
  const user = state.users.find((u) => u.apiKey === key);
  if (!user) return unauthorized(res, 'API key is not recognised');
  req.user = user;
  next();
}

/** Requires a Bearer token issued through the OAuth 2.0 token endpoint. */
function requireOAuthScope(scope) {
  return function (req, res, next) {
    const header = req.get('Authorization') || '';
    if (!header.startsWith('Bearer ')) {
      return unauthorized(res, 'Missing OAuth access token. Get one from POST /api/oauth/token');
    }
    const result = verify(header.slice(7).trim());
    if (!result.valid) return unauthorized(res, 'OAuth token is invalid or expired', result.reason);
    if (result.payload.type !== 'oauth') {
      return unauthorized(res, 'This endpoint requires an OAuth token, not a user login token');
    }
    const scopes = String(result.payload.scope || '').split(' ');
    if (!scopes.includes(scope)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Token is missing the required scope: ${scope}`,
        grantedScopes: scopes,
      });
    }
    req.oauth = result.payload;
    next();
  };
}

/** Requires req.user to have the admin role. Run after an auth middleware. */
function requireAdmin(req, res, next) {
  if (!req.user) return unauthorized(res, 'Authentication required');
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'This endpoint requires the admin role',
      yourRole: req.user.role,
    });
  }
  next();
}

module.exports = {
  sign,
  verify,
  issueRefreshToken,
  requireBearer,
  requireBasic,
  requireApiKey,
  requireOAuthScope,
  requireAdmin,
  OAUTH_CLIENTS,
  ACCESS_TOKEN_TTL_SECONDS,
};
