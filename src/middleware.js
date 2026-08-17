'use strict';

const { logRequest } = require('./store');

/** Records every API call so the dashboard can show a live request feed. */
function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api')) return;
    logRequest({
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
      auth: req.get('Authorization') ? req.get('Authorization').split(' ')[0] : null,
    });
  });
  next();
}

/**
 * Fixed-window rate limiter, keyed by IP.
 * Sends the standard X-RateLimit-* headers so they can be asserted in tests.
 */
function rateLimit({ windowMs = 60000, max = 5 } = {}) {
  const hits = new Map();
  return function (req, res, next) {
    const key = req.ip;
    const now = Date.now();
    let record = hits.get(key);

    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      hits.set(key, record);
    }
    record.count++;

    const remaining = Math.max(0, max - record.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)));

    if (record.count > max) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit of ${max} requests per ${windowMs / 1000}s exceeded.`,
        retryAfterSeconds: retryAfter,
      });
    }
    next();
  };
}

/** Collects field-level validation errors into a single 422 response. */
function validate(rules, body) {
  const errors = [];
  for (const rule of rules) {
    const value = body[rule.field];
    const missing = value === undefined || value === null || value === '';

    if (rule.required && missing) {
      errors.push({ field: rule.field, message: `${rule.field} is required` });
      continue;
    }
    if (missing) continue;

    if (rule.type === 'number' && typeof value !== 'number') {
      errors.push({ field: rule.field, message: `${rule.field} must be a number`, received: typeof value });
    }
    if (rule.type === 'string' && typeof value !== 'string') {
      errors.push({ field: rule.field, message: `${rule.field} must be a string`, received: typeof value });
    }
    if (rule.type === 'boolean' && typeof value !== 'boolean') {
      errors.push({ field: rule.field, message: `${rule.field} must be a boolean`, received: typeof value });
    }
    if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
      errors.push({ field: rule.field, message: `${rule.field} must be at least ${rule.min}` });
    }
    if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
      errors.push({ field: rule.field, message: `${rule.field} must be ${rule.maxLength} characters or fewer` });
    }
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push({ field: rule.field, message: `${rule.field} must be one of: ${rule.enum.join(', ')}` });
    }
    if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
      errors.push({ field: rule.field, message: `${rule.field} is not in the expected format` });
    }
  }
  return errors;
}

function validationFailed(res, errors) {
  return res.status(422).json({
    error: 'Unprocessable Entity',
    message: 'Request body failed validation',
    errors,
  });
}

module.exports = { requestLogger, rateLimit, validate, validationFailed };
