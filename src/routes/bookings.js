'use strict';

const express = require('express');
const { state, nextId } = require('../store');
const { requireBearer } = require('../auth');
const { validate, validationFailed } = require('../middleware');
const { fireWebhooks } = require('./webhooks');

const router = express.Router();

const ROOM_TYPES = ['single', 'double', 'twin', 'suite'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const bookingRules = [
  { field: 'firstname', required: true, type: 'string', maxLength: 40 },
  { field: 'lastname', required: true, type: 'string', maxLength: 40 },
  { field: 'totalPrice', required: true, type: 'number', min: 0 },
  { field: 'depositPaid', required: true, type: 'boolean' },
  { field: 'roomType', required: false, type: 'string', enum: ROOM_TYPES },
  { field: 'additionalNeeds', required: false, type: 'string', maxLength: 120 },
];

// --- List with pagination, filtering, sorting --------------------------------

router.get('/bookings', (req, res) => {
  let results = [...state.bookings];

  if (req.query.firstname) {
    results = results.filter((b) => b.firstname.toLowerCase() === String(req.query.firstname).toLowerCase());
  }
  if (req.query.lastname) {
    results = results.filter((b) => b.lastname.toLowerCase() === String(req.query.lastname).toLowerCase());
  }
  if (req.query.roomType) {
    results = results.filter((b) => b.roomType === req.query.roomType);
  }
  if (req.query.depositPaid !== undefined) {
    const wanted = req.query.depositPaid === 'true';
    results = results.filter((b) => b.depositPaid === wanted);
  }
  if (req.query.minPrice) {
    results = results.filter((b) => b.totalPrice >= Number(req.query.minPrice));
  }
  if (req.query.maxPrice) {
    results = results.filter((b) => b.totalPrice <= Number(req.query.maxPrice));
  }

  const sortBy = req.query.sortBy;
  if (sortBy) {
    const direction = req.query.order === 'desc' ? -1 : 1;
    results.sort((a, b) => (a[sortBy] > b[sortBy] ? direction : a[sortBy] < b[sortBy] ? -direction : 0));
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const total = results.length;
  const start = (page - 1) * limit;
  const pageItems = results.slice(start, start + limit);

  res.set('X-Total-Count', String(total));
  res.json({
    data: pageItems,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasNext: start + limit < total,
      hasPrevious: page > 1,
    },
  });
});

// --- Read a single booking ---------------------------------------------------

router.get('/bookings/:id', (req, res) => {
  const id = Number(req.params.id);
  const booking = state.bookings.find((b) => b.id === id);
  if (!booking) {
    return res.status(404).json({ error: 'Not Found', message: `No booking with id ${req.params.id}` });
  }
  res.json(booking);
});

// --- Create ------------------------------------------------------------------

router.post('/bookings', requireBearer, (req, res) => {
  const errors = validate(bookingRules, req.body || {});

  const dates = (req.body && req.body.bookingDates) || {};
  if (!dates.checkin) errors.push({ field: 'bookingDates.checkin', message: 'bookingDates.checkin is required' });
  else if (!DATE_PATTERN.test(dates.checkin)) errors.push({ field: 'bookingDates.checkin', message: 'checkin must be YYYY-MM-DD' });

  if (!dates.checkout) errors.push({ field: 'bookingDates.checkout', message: 'bookingDates.checkout is required' });
  else if (!DATE_PATTERN.test(dates.checkout)) errors.push({ field: 'bookingDates.checkout', message: 'checkout must be YYYY-MM-DD' });

  if (dates.checkin && dates.checkout && DATE_PATTERN.test(dates.checkin) && DATE_PATTERN.test(dates.checkout)) {
    if (new Date(dates.checkout) <= new Date(dates.checkin)) {
      errors.push({ field: 'bookingDates', message: 'checkout must be later than checkin' });
    }
  }

  if (errors.length) return validationFailed(res, errors);

  const booking = {
    id: nextId('booking'),
    firstname: req.body.firstname,
    lastname: req.body.lastname,
    totalPrice: req.body.totalPrice,
    depositPaid: req.body.depositPaid,
    roomType: req.body.roomType || 'single',
    bookingDates: { checkin: dates.checkin, checkout: dates.checkout },
    additionalNeeds: req.body.additionalNeeds || null,
    ownerId: req.user.id,
    createdAt: new Date().toISOString(),
  };
  state.bookings.push(booking);

  fireWebhooks('booking.created', booking);

  res.status(201).location(`/api/bookings/${booking.id}`).json(booking);
});

// --- Full update -------------------------------------------------------------

router.put('/bookings/:id', requireBearer, (req, res) => {
  const id = Number(req.params.id);
  const index = state.bookings.findIndex((b) => b.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Not Found', message: `No booking with id ${req.params.id}` });
  }

  const existing = state.bookings[index];
  if (existing.ownerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You can only modify bookings you created',
      bookingOwner: existing.ownerId,
      you: req.user.id,
    });
  }

  const errors = validate(bookingRules, req.body || {});
  if (errors.length) return validationFailed(res, errors);

  const dates = (req.body && req.body.bookingDates) || existing.bookingDates;
  const updated = {
    ...existing,
    firstname: req.body.firstname,
    lastname: req.body.lastname,
    totalPrice: req.body.totalPrice,
    depositPaid: req.body.depositPaid,
    roomType: req.body.roomType || existing.roomType,
    bookingDates: { checkin: dates.checkin, checkout: dates.checkout },
    additionalNeeds: req.body.additionalNeeds ?? null,
    updatedAt: new Date().toISOString(),
  };
  state.bookings[index] = updated;

  fireWebhooks('booking.updated', updated);
  res.json(updated);
});

// --- Partial update ----------------------------------------------------------

router.patch('/bookings/:id', requireBearer, (req, res) => {
  const id = Number(req.params.id);
  const index = state.bookings.findIndex((b) => b.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Not Found', message: `No booking with id ${req.params.id}` });
  }

  const existing = state.bookings[index];
  if (existing.ownerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'You can only modify bookings you created' });
  }

  const allowed = ['firstname', 'lastname', 'totalPrice', 'depositPaid', 'roomType', 'additionalNeeds', 'bookingDates'];
  const patch = {};
  for (const key of Object.keys(req.body || {})) {
    if (allowed.includes(key)) patch[key] = req.body[key];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'No updatable fields supplied',
      allowedFields: allowed,
    });
  }

  const errors = validate(
    bookingRules.map((r) => ({ ...r, required: false })),
    patch
  );
  if (errors.length) return validationFailed(res, errors);

  state.bookings[index] = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  res.json(state.bookings[index]);
});

// --- Delete ------------------------------------------------------------------

router.delete('/bookings/:id', requireBearer, (req, res) => {
  const id = Number(req.params.id);
  const index = state.bookings.findIndex((b) => b.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Not Found', message: `No booking with id ${req.params.id}` });
  }

  const existing = state.bookings[index];
  if (existing.ownerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'You can only delete bookings you created' });
  }

  state.bookings.splice(index, 1);
  fireWebhooks('booking.deleted', { id });
  res.status(204).send();
});

module.exports = router;
