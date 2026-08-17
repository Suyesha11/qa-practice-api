'use strict';

// ---------------------------------------------------------------------------
// In-memory data store. Everything resets when the server restarts, or when
// POST /api/reset is called. No database, no files, no setup.
// ---------------------------------------------------------------------------

let nextIds = { user: 1, booking: 1, product: 1, webhook: 1, delivery: 1 };

const state = {
  users: [],
  bookings: [],
  products: [],
  webhooks: [],
  deliveries: [],
  refreshTokens: new Map(), // token -> userId
  requestLog: [],           // recent requests, newest first (capped)
  counters: { requests: 0, errors: 0 },
};

function nextId(kind) {
  return nextIds[kind]++;
}

const FIRST_NAMES = ['Aditi', 'Marcus', 'Yuki', 'Priya', 'Tomas', 'Lena', 'Omar', 'Sofia'];
const LAST_NAMES = ['Kulkarni', 'Weber', 'Tanaka', 'Nair', 'Novak', 'Fischer', 'Haddad', 'Rossi'];
const ROOMS = ['single', 'double', 'suite', 'twin'];

function seed() {
  nextIds = { user: 1, booking: 1, product: 1, webhook: 1, delivery: 1 };
  state.users = [];
  state.bookings = [];
  state.products = [];
  state.webhooks = [];
  state.deliveries = [];
  state.refreshTokens = new Map();

  // --- users -------------------------------------------------------------
  // Two fixed accounts so collections stay reproducible across resets.
  state.users.push({
    id: nextId('user'),
    username: 'admin',
    password: 'admin123',
    email: 'admin@qapractice.dev',
    role: 'admin',
    apiKey: 'qap_admin_key_2f8b91',
    createdAt: new Date().toISOString(),
  });
  state.users.push({
    id: nextId('user'),
    username: 'tester',
    password: 'tester123',
    email: 'tester@qapractice.dev',
    role: 'user',
    apiKey: 'qap_user_key_7c1d40',
    createdAt: new Date().toISOString(),
  });
  state.users.push({
    id: nextId('user'),
    username: 'other',
    password: 'other123',
    email: 'other@qapractice.dev',
    role: 'user',
    apiKey: 'qap_user_key_9a3e22',
    createdAt: new Date().toISOString(),
  });

  // --- bookings ----------------------------------------------------------
  for (let i = 0; i < 12; i++) {
    const checkin = new Date(Date.now() + i * 86400000);
    const checkout = new Date(Date.now() + (i + 3) * 86400000);
    state.bookings.push({
      id: nextId('booking'),
      firstname: FIRST_NAMES[i % FIRST_NAMES.length],
      lastname: LAST_NAMES[i % LAST_NAMES.length],
      totalPrice: 90 + (i * 17) % 400,
      depositPaid: i % 3 !== 0,
      roomType: ROOMS[i % ROOMS.length],
      bookingDates: {
        checkin: checkin.toISOString().slice(0, 10),
        checkout: checkout.toISOString().slice(0, 10),
      },
      additionalNeeds: i % 2 === 0 ? 'Breakfast' : null,
      ownerId: i % 2 === 0 ? 2 : 3,
      createdAt: new Date().toISOString(),
    });
  }

  // --- products ----------------------------------------------------------
  const catalogue = [
    ['Laptop Stand', 'accessories', 51.25, 4.4, 120],
    ['Mechanical Keyboard', 'accessories', 139.0, 4.7, 38],
    ['27" 4K Monitor', 'displays', 429.99, 4.5, 12],
    ['USB-C Hub', 'accessories', 64.5, 4.1, 0],
    ['Ergonomic Chair', 'furniture', 289.0, 4.6, 7],
    ['Standing Desk', 'furniture', 549.0, 4.8, 3],
    ['Webcam 1080p', 'peripherals', 79.99, 3.9, 45],
    ['Noise-cancelling Headset', 'peripherals', 199.0, 4.3, 21],
    ['Desk Lamp', 'furniture', 39.9, 4.0, 88],
    ['Cable Organiser', 'accessories', 12.0, 3.6, 210],
  ];
  for (const [name, category, price, rating, stock] of catalogue) {
    state.products.push({
      id: nextId('product'),
      name,
      category,
      price,
      rating,
      stock,
      inStock: stock > 0,
      createdAt: new Date().toISOString(),
    });
  }
}

function logRequest(entry) {
  state.counters.requests++;
  if (entry.status >= 400) state.counters.errors++;
  state.requestLog.unshift(entry);
  if (state.requestLog.length > 60) state.requestLog.length = 60;
}

function reset() {
  seed();
  state.requestLog = [];
  state.counters = { requests: 0, errors: 0 };
}

seed();

module.exports = { state, nextId, seed, reset, logRequest };
