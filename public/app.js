'use strict';

let activeTab = 'bookings';
let latest = null;

// --- Live polling ------------------------------------------------------------

async function poll() {
  try {
    const response = await fetch('/api/_internal/activity');
    latest = await response.json();
    renderFeed(latest.requests);
    renderCounters(latest.counters);
    renderTable();
    document.getElementById('pulse').textContent = 'listening';
  } catch {
    document.getElementById('pulse').textContent = 'server offline';
  }
}

function renderCounters(counters) {
  document.getElementById('stat-requests').textContent = counters.requests;
  document.getElementById('stat-errors').textContent = counters.errors;
}

function statusClass(status) {
  if (status >= 500) return 'bad';
  if (status >= 400) return 'warn';
  return 'ok';
}

function renderFeed(requests) {
  const feed = document.getElementById('feed');
  if (!requests || requests.length === 0) {
    feed.innerHTML =
      '<li class="feed-empty">Nothing yet. Send a request to <code>http://localhost:3000/api/health</code> and it will appear here.</li>';
    return;
  }

  feed.innerHTML = requests
    .map(
      (r) => `
      <li class="feed-row">
        <span class="verb verb-${r.method}">${r.method}</span>
        <span class="route" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</span>
        <span class="code-chip ${statusClass(r.status)}">${r.status}</span>
        <span class="timing">${r.durationMs}ms</span>
      </li>`
    )
    .join('');
}

// --- Data inspector ----------------------------------------------------------

function renderTable() {
  const container = document.getElementById('data-body');
  if (!latest) return;

  const renderers = { bookings: bookingsTable, users: usersTable, products: productsTable, deliveries: deliveriesTable };
  container.innerHTML = renderers[activeTab]();
}

function bookingsTable() {
  const rows = latest.bookings || [];
  if (!rows.length) return emptyState('No bookings stored. Create one with POST /api/bookings.');
  return table(
    ['ID', 'Guest', 'Room', 'Price', 'Deposit', 'Dates'],
    rows.map((b) => [
      `<td class="key">${b.id}</td>`,
      `<td>${escapeHtml(b.firstname)} ${escapeHtml(b.lastname)}</td>`,
      `<td>${escapeHtml(b.roomType || '—')}</td>`,
      `<td>${b.totalPrice}</td>`,
      `<td><span class="pill ${b.depositPaid ? 'pill-yes' : 'pill-no'}">${b.depositPaid ? 'paid' : 'unpaid'}</span></td>`,
      `<td>${b.bookingDates.checkin} → ${b.bookingDates.checkout}</td>`,
    ])
  );
}

function usersTable() {
  const rows = latest.users || [];
  return table(
    ['ID', 'Username', 'Email', 'Role'],
    rows.map((u) => [
      `<td class="key">${u.id}</td>`,
      `<td>${escapeHtml(u.username)}</td>`,
      `<td>${escapeHtml(u.email)}</td>`,
      `<td><span class="pill pill-${u.role}">${u.role}</span></td>`,
    ])
  );
}

function productsTable() {
  const rows = latest.products || [];
  return table(
    ['ID', 'Name', 'Category', 'Price', 'Stock'],
    rows.map((p) => [
      `<td class="key">${p.id}</td>`,
      `<td>${escapeHtml(p.name)}</td>`,
      `<td>${escapeHtml(p.category)}</td>`,
      `<td>${p.price}</td>`,
      `<td><span class="pill ${p.inStock ? 'pill-yes' : 'pill-no'}">${p.stock}</span></td>`,
    ])
  );
}

function deliveriesTable() {
  const rows = latest.deliveries || [];
  if (!rows.length) {
    return emptyState('No webhook deliveries yet. Register a webhook, then create a booking to trigger one.');
  }
  return table(
    ['ID', 'Event', 'Target', 'Status'],
    rows.map((d) => [
      `<td class="key">${d.id}</td>`,
      `<td>${escapeHtml(d.event)}</td>`,
      `<td>${escapeHtml(d.targetUrl)}</td>`,
      `<td><span class="pill ${d.status === 'delivered' ? 'pill-yes' : d.status === 'failed' ? 'pill-no' : 'pill-user'}">${d.status}</span></td>`,
    ])
  );
}

function table(headers, rows) {
  return `<table>
    <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((cells) => `<tr>${cells.join('')}</tr>`).join('')}</tbody>
  </table>`;
}

function emptyState(message) {
  return `<p class="empty-state">${message}</p>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// --- Endpoint reference ------------------------------------------------------

const REFERENCE = [
  {
    group: 'Authentication',
    lines: [
      ['POST', '/api/auth/register', 'Create a user'],
      ['POST', '/api/auth/login', 'Returns access + refresh token'],
      ['POST', '/api/auth/login-short', 'Token expires in 10s'],
      ['POST', '/api/auth/refresh', 'Rotate the refresh token'],
      ['POST', '/api/auth/logout', 'Revokes refresh tokens'],
      ['GET', '/api/auth/me', 'Current user + token claims'],
    ],
  },
  {
    group: 'Auth schemes',
    lines: [
      ['GET', '/api/basic-protected', 'HTTP Basic'],
      ['GET', '/api/apikey-protected', 'x-api-key header or ?api_key='],
      ['POST', '/api/oauth/token', 'OAuth2 client_credentials'],
      ['GET', '/api/oauth/protected', 'Requires read scope'],
      ['POST', '/api/oauth/protected-write', 'Requires write scope'],
    ],
  },
  {
    group: 'Bookings (CRUD)',
    lines: [
      ['GET', '/api/bookings', 'page, limit, sortBy, filters'],
      ['GET', '/api/bookings/:id', ''],
      ['POST', '/api/bookings', 'Bearer required'],
      ['PUT', '/api/bookings/:id', 'Owner or admin'],
      ['PATCH', '/api/bookings/:id', 'Partial update'],
      ['DELETE', '/api/bookings/:id', 'Returns 204'],
    ],
  },
  {
    group: 'Users (RBAC)',
    lines: [
      ['GET', '/api/users', 'Admin only'],
      ['GET', '/api/users/:id', ''],
      ['GET', '/api/users/:id/profile', ''],
      ['PATCH', '/api/users/:id', ''],
      ['DELETE', '/api/users/:id', 'Admin only'],
    ],
  },
  {
    group: 'Products',
    lines: [
      ['GET', '/api/products', 'search, category, inStock'],
      ['GET', '/api/products/categories', ''],
      ['GET', '/api/products/:id', ''],
      ['POST', '/api/products', 'Admin only'],
      ['PUT', '/api/products/:id', 'Admin only'],
      ['DELETE', '/api/products/:id', 'Admin only'],
    ],
  },
  {
    group: 'Webhooks (async)',
    lines: [
      ['POST', '/api/webhooks', 'Subscribe to events'],
      ['GET', '/api/webhooks', ''],
      ['GET', '/api/webhooks/deliveries', 'Poll for async results'],
      ['POST', '/api/webhooks/receiver', 'A target to point hooks at'],
      ['DELETE', '/api/webhooks/:id', ''],
    ],
  },
  {
    group: 'Response behaviour',
    lines: [
      ['GET', '/api/slow?ms=2000', 'Fixed delay'],
      ['GET', '/api/variable-latency', 'Random 100–1600ms'],
      ['GET', '/api/flaky?failureRate=0.3', 'Fails randomly'],
      ['ALL', '/api/status/:code', 'Returns any status'],
      ['GET', '/api/redirect?times=3', 'Chained redirects'],
      ['GET', '/api/limited', '5 requests per minute'],
    ],
  },
  {
    group: 'Payloads & caching',
    lines: [
      ['GET', '/api/cached', 'ETag + If-None-Match → 304'],
      ['GET', '/api/xml', 'application/xml'],
      ['GET', '/api/text', 'text/plain'],
      ['GET', '/api/large?count=500', 'Big JSON payload'],
      ['POST', '/api/echo', 'Echoes headers, query, body'],
      ['GET', '/api/calculate?value=9', 'Fragile input handling'],
    ],
  },
  {
    group: 'Housekeeping',
    lines: [
      ['GET', '/api/health', 'Status + record counts'],
      ['POST', '/api/reset', 'Restore seed data'],
    ],
  },
];

function renderReference() {
  document.getElementById('ref-grid').innerHTML = REFERENCE.map(
    (section) => `
      <div class="ref-group">
        <h3>${section.group}</h3>
        ${section.lines
          .map(
            ([verb, path, note]) => `
          <div class="ref-line">
            <span class="ref-verb verb-${verb === 'ALL' ? 'GET' : verb}">${verb}</span>
            <span class="ref-path">${escapeHtml(path)}${note ? `<span class="ref-note">${escapeHtml(note)}</span>` : ''}</span>
          </div>`
          )
          .join('')}
      </div>`
  ).join('');
}

// --- Wiring ------------------------------------------------------------------

document.getElementById('tabs').addEventListener('click', (event) => {
  const button = event.target.closest('.tab');
  if (!button) return;
  activeTab = button.dataset.tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === button));
  renderTable();
});

document.getElementById('reset-btn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.textContent = 'Resetting…';
  await fetch('/api/reset', { method: 'POST' });
  await poll();
  button.textContent = 'Reset data';
});

renderReference();
poll();
setInterval(poll, 2000);
