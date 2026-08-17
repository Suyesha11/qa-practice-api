'use strict';

const express = require('express');
const { state, nextId } = require('../store');
const { requireBearer } = require('../auth');

const router = express.Router();

/**
 * Delivers an event to every webhook subscribed to it. Delivery is recorded
 * either way, so a test can register a hook, trigger an event, then poll
 * GET /api/webhooks/deliveries to assert the async side-effect happened.
 */
function fireWebhooks(event, payload) {
  const subscribers = state.webhooks.filter((w) => w.events.includes(event) && w.active);

  for (const hook of subscribers) {
    const delivery = {
      id: nextId('delivery'),
      webhookId: hook.id,
      event,
      payload,
      targetUrl: hook.url,
      status: 'pending',
      attemptedAt: new Date().toISOString(),
    };
    state.deliveries.unshift(delivery);
    if (state.deliveries.length > 100) state.deliveries.length = 100;

    // Delivered asynchronously, so tests have to poll or wait rather than
    // assuming the side-effect is instant.
    setTimeout(async () => {
      try {
        const response = await fetch(hook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': event },
          body: JSON.stringify({ event, data: payload, deliveredAt: new Date().toISOString() }),
        });
        delivery.status = response.ok ? 'delivered' : 'failed';
        delivery.responseStatus = response.status;
      } catch (err) {
        delivery.status = 'failed';
        delivery.error = err.message;
      }
    }, 800);
  }
}

router.post('/webhooks', requireBearer, (req, res) => {
  const { url, events } = req.body || {};
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(422).json({
      error: 'Unprocessable Entity',
      errors: [{ field: 'url', message: 'url is required and must start with http:// or https://' }],
    });
  }
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(422).json({
      error: 'Unprocessable Entity',
      errors: [{ field: 'events', message: 'events must be a non-empty array' }],
    });
  }

  const webhook = {
    id: nextId('webhook'),
    url,
    events,
    active: true,
    ownerId: req.user.id,
    createdAt: new Date().toISOString(),
  };
  state.webhooks.push(webhook);
  res.status(201).json(webhook);
});

router.get('/webhooks', requireBearer, (req, res) => {
  res.json({ data: state.webhooks, total: state.webhooks.length });
});

router.get('/webhooks/deliveries', requireBearer, (req, res) => {
  res.json({ data: state.deliveries, total: state.deliveries.length });
});

router.delete('/webhooks/:id', requireBearer, (req, res) => {
  const index = state.webhooks.findIndex((w) => w.id === Number(req.params.id));
  if (index === -1) {
    return res.status(404).json({ error: 'Not Found', message: `No webhook with id ${req.params.id}` });
  }
  state.webhooks.splice(index, 1);
  res.status(204).send();
});

/** A target you can point a webhook at, to watch a full round trip locally. */
router.post('/webhooks/receiver', (req, res) => {
  res.status(200).json({ received: true, body: req.body, at: new Date().toISOString() });
});

module.exports = router;
module.exports.fireWebhooks = fireWebhooks;
