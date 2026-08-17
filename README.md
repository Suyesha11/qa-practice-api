# QA Practice API

A local API and dashboard built for practising everything in the **Postman Deep Dive** —
variables, scripting, chaining, every common auth scheme, data-driven runs, mocking,
schema validation, rate limits, webhooks and async behaviour.

Data lives in memory. Restart the server, or call `POST /api/reset`, and you're back
to a clean seed state — so you can run destructive tests as often as you like.

---

## Run it

```bash
npm install
npm start
```

- Dashboard: **http://localhost:3000**
- API base: **http://localhost:3000/api**

The dashboard shows a live feed of every request that hits the API. Keep it open on a
second monitor while you work in Postman — you'll see each call land, with its status
code and response time.

### Seed accounts

| Username | Password    | Role  | API key                |
|----------|-------------|-------|------------------------|
| `admin`  | `admin123`  | admin | `qap_admin_key_2f8b91` |
| `tester` | `tester123` | user  | `qap_user_key_7c1d40`  |
| `other`  | `other123`  | user  | `qap_user_key_9a3e22`  |

`other` exists so you can test cross-user authorisation: `tester` should not be able
to modify a booking owned by `other`.

### OAuth 2.0 clients

| client_id            | client_secret         | scopes       |
|----------------------|-----------------------|--------------|
| `qa-practice-client` | `s3cr3t-client-value` | read, write  |
| `readonly-client`    | `readonly-secret`     | read         |

---

## Endpoints

### Authentication
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | 201 on success, 409 on duplicate username, 422 on bad input |
| POST | `/api/auth/login` | Returns `accessToken` (15 min) + `refreshToken`. Rate limited to 10/min |
| POST | `/api/auth/login-short` | Same, but the token expires in **10 seconds** |
| POST | `/api/auth/refresh` | Rotates the refresh token — reusing an old one returns 401 |
| POST | `/api/auth/logout` | 204, revokes refresh tokens |
| GET | `/api/auth/me` | Current user plus token issue/expiry timestamps |

### Other auth schemes
| Method | Path | Notes |
|---|---|---|
| GET | `/api/basic-protected` | HTTP Basic |
| GET | `/api/apikey-protected` | `x-api-key` header **or** `?api_key=` query param |
| POST | `/api/oauth/token` | `client_credentials` grant; accepts creds in body or via Basic |
| GET | `/api/oauth/protected` | Requires `read` scope |
| POST | `/api/oauth/protected-write` | Requires `write` scope — returns 403 with a read-only token |

### Bookings — the main CRUD resource
| Method | Path | Notes |
|---|---|---|
| GET | `/api/bookings` | `page`, `limit`, `sortBy`, `order`, `firstname`, `lastname`, `roomType`, `depositPaid`, `minPrice`, `maxPrice` |
| GET | `/api/bookings/:id` | 404 when missing |
| POST | `/api/bookings` | Bearer required. 201 + `Location` header |
| PUT | `/api/bookings/:id` | Owner or admin only — 403 otherwise |
| PATCH | `/api/bookings/:id` | Partial update; 400 if no updatable fields sent |
| DELETE | `/api/bookings/:id` | 204 on success |

`roomType` must be one of `single`, `double`, `twin`, `suite`.
`checkout` must be later than `checkin`.

### Users — role-based access control
| Method | Path | Notes |
|---|---|---|
| GET | `/api/users` | **Admin only** |
| GET | `/api/users/:id` | |
| GET | `/api/users/:id/profile` | |
| PATCH | `/api/users/:id` | |
| DELETE | `/api/users/:id` | **Admin only** |

### Products — good for data-driven runs
| Method | Path | Notes |
|---|---|---|
| GET | `/api/products` | `search`, `category`, `inStock`, `minRating`, `page`, `limit` |
| GET | `/api/products/categories` | |
| GET | `/api/products/:id` | |
| POST · PUT · DELETE | `/api/products/:id` | **Admin only** |

### Webhooks — async behaviour
| Method | Path | Notes |
|---|---|---|
| POST | `/api/webhooks` | Subscribe to `booking.created`, `booking.updated`, `booking.deleted` |
| GET | `/api/webhooks/deliveries` | Delivery attempts. Fired ~800ms after the event, so tests must poll |
| POST | `/api/webhooks/receiver` | A local target you can point a webhook at |

### Response behaviour — for performance and resilience work
| Method | Path | Notes |
|---|---|---|
| GET | `/api/slow?ms=2000` | Fixed delay, up to 10s |
| GET | `/api/variable-latency` | Random 100–1600ms |
| GET | `/api/flaky?failureRate=0.3` | Fails randomly — practise retry logic |
| ALL | `/api/status/:code` | Returns whatever status you ask for |
| GET | `/api/redirect?times=3` | Chained 302s |
| GET | `/api/limited` | **5 requests per minute**, then 429 with `Retry-After` |

### Payloads and caching
| Method | Path | Notes |
|---|---|---|
| GET | `/api/cached` | Sends `ETag` + `Cache-Control`; returns 304 for a matching `If-None-Match` |
| GET | `/api/xml` | `application/xml` response |
| GET | `/api/text` | `text/plain` response |
| GET | `/api/large?count=500` | Large JSON array, up to 2000 items |
| POST | `/api/echo` | Echoes your headers, query and body back |
| GET | `/api/calculate?value=16` | Fragile input handling — see the flaws below |

### Housekeeping
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Status and record counts |
| POST | `/api/reset` | Restores seed data |

Every response carries `X-Request-Id` and `X-Powered-By` headers, so you always have
something to assert on beyond the body.

---

## Practice tasks, mapped to the deep dive

### 1 · Collection architecture
Create a collection `QA Practice API` with folders: **Auth**, **Bookings**, **Users**,
**Products**, **Webhooks**, **Utilities**. Add a collection description recording the
base URL and seed accounts.

### 2 · Variables
- Set `base_url` as a **collection** variable → `http://localhost:3000/api`
- Create **Dev** and **QA** environments with different `port` values
- Use `{{$randomFirstName}}`, `{{$randomInt}}` and `{{$isoTimestamp}}` in a booking body
  so every run creates unique data

### 3 · Scripting and assertions
On `GET /api/bookings`, assert: status is 200, `pagination.total` is a number,
`X-Total-Count` header is present, and response time is under 500ms.
Add a pre-request script that computes tomorrow's date and stores it as
`checkinDate` for the request body to use.

### 4 · Chaining
Build the full flow: **login → create booking → get by id → patch → delete**.
Store `accessToken` and `bookingId` from earlier responses and reference them later.
Then use `postman.setNextRequest()` to skip the delete when `depositPaid` is `false`.

### 5 · Authentication
- Bearer: log in, save the token, apply it at collection level so everything inherits it
- Basic: hit `/api/basic-protected` with the Authorization tab, then assert 401 with a wrong password
- API key: send it once as a header and once as `?api_key=`
- OAuth 2.0: configure a client-credentials token in Postman's Authorization tab
  against `/api/oauth/token`
- Expiry: use `/api/auth/login-short`, wait 10 seconds, assert 401 and check the
  error message names expiry
- Refresh: call `/api/auth/refresh`, then call it again with the same token and assert 401

### 6 · Authorization (the senior-level part)
- `tester` requests `GET /api/users` → assert 403
- `tester` tries to `DELETE` a booking owned by `other` → assert 403
- `admin` deletes the same booking → assert 204

### 7 · Collection Runner and data-driven testing
Build a CSV with 5 booking rows — include valid rows and deliberately broken ones
(missing `lastname`, `totalPrice` as a string, `roomType: "castle"`, checkout before
checkin). Run the collection against it and assert each row returns the status you expect.

### 8 · Schema validation
Write a JSON Schema for the booking object and validate `GET /api/bookings/:id`
against it with `pm.response.to.have.jsonSchema()`. Then patch a booking with a
string price and confirm your schema catches it.

### 9 · Newman and CI
```bash
newman run QA-Practice-API.postman_collection.json \
  -e local.postman_environment.json \
  -r htmlextra --reporter-htmlextra-export report.html
```
Then add it as a GitHub Actions step. Start the server in the workflow with
`npm start &` before the Newman step.

### 10 · Mock servers
Save example responses on `GET /api/bookings/:id` (a 200 and a 404), create a mock
server from the collection, then point a request at the mock URL and confirm the
saved example comes back instead of the real API.

### 11 · Rate limiting
Send `GET /api/limited` six times in a row. Assert the first five return 200 with a
decreasing `X-RateLimit-Remaining`, and the sixth returns 429 with a `Retry-After` header.

### 12 · Caching
Call `GET /api/cached`, capture the `ETag`, then send it back as `If-None-Match` and
assert a 304 with an empty body.

### 13 · Async and webhooks
Register a webhook pointing at `http://localhost:3000/api/webhooks/receiver`,
create a booking, then poll `GET /api/webhooks/deliveries` until status is
`delivered`. Write the polling logic with `setTimeout` and `postman.setNextRequest()`.

### 14 · Negative and destructive testing
- Malformed JSON body → 400
- `POST /api/bookings` with no auth → 401
- Booking id `99999` → 404, id `abc` → check what actually happens
- 1mb+ payload → 413
- Every field missing → 422 listing each error

### 15 · Performance groundwork
Use `/api/slow`, `/api/variable-latency` and `/api/flaky` to write assertions on
response time and to practise retry logic. These same endpoints are your first
k6 targets in week 5.

---

## Deliberate flaws to find

Four bugs are planted in the API. Try to find them before reading the answers — write
the failing test first, the way you would on a real product.

<details>
<summary>Reveal the flaws</summary>

1. **Broken object level authorisation (OWASP API1)** — `GET /api/users/:id` lets any
   authenticated user read any other user's record just by changing the id.
2. **Mass assignment (OWASP API6)** — `PATCH /api/users/:id` spreads the whole request
   body over the stored user, so sending `{"role": "admin"}` escalates your own privileges.
3. **Excessive data exposure (OWASP API3)** — `GET /api/users/:id/profile` returns
   `password` and `apiKey` in the response body.
4. **Unhandled input** — `GET /api/calculate?value=abc` throws and returns 500 where a
   400 would be correct.

</details>

---

## Notes

- Only dependency is Express. JWTs are signed with Node's built-in `crypto`, so
  `npm install` is quick and works offline afterwards.
- Tokens are signed with a hard-coded secret and passwords are stored in plain text.
  That is intentional for a practice tool and must never be copied into real code.
