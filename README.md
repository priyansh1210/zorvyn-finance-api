# Finance API

A role-based personal finance tracking REST API built with Express 5, TypeScript, and SQLite. Designed as a backend for a finance dashboard system where users interact with financial records based on their assigned role.

## Architecture & Design Decisions

### Why This Stack

| Choice | Rationale |
|---|---|
| **Express 5** | Mature, minimal framework. v5 natively catches thrown errors in sync handlers, eliminating the need for async wrappers. |
| **TypeScript (strict mode)** | Catches entire categories of bugs at compile time. Strict mode enforced — no implicit `any`, no unchecked nulls. |
| **SQLite (better-sqlite3)** | Zero-config embedded database. Synchronous API avoids callback/promise overhead for a single-server deployment. WAL mode enabled for concurrent read performance. |
| **Zod 4** | Runtime schema validation that produces typed outputs. Schemas serve as both validation and documentation of expected input shapes. |
| **JWT** | Stateless auth — no session store needed. Token carries role info, verified on every request. |

### Application Structure

The codebase follows a **modular service architecture** — each domain (auth, users, records, dashboard) is a self-contained module with its own controller, service, schema, and routes. This keeps business logic isolated from HTTP concerns:

- **Controllers** handle request/response — no business logic, no database calls.
- **Services** contain all business logic and database interaction.
- **Schemas** define and validate input shapes using Zod.
- **Routes** wire endpoints to middleware chains and controllers.

Cross-cutting concerns (auth, validation, rate limiting, error handling) live in `middleware/` and are applied declaratively at the route level.

```
src/
  server.ts                  # Entry point — starts HTTP server
  app.ts                     # Express app, middleware stack, error handler
  config/
    database.ts              # SQLite connection, schema creation, WAL + FK pragmas
    env.ts                   # Typed environment config with defaults
    seed.ts                  # Database seeder (3 users + 30 records)
  middleware/
    auth.ts                  # JWT verification, role authorization, role hierarchy
    rateLimiter.ts           # In-memory sliding window rate limiter
    validate.ts              # Zod schema validation middleware (body/query/params)
  modules/
    auth/                    # Register, login, me (public + authenticated)
    users/                   # User CRUD (admin/analyst restricted)
    records/                 # Financial records CRUD (role-gated)
    dashboard/               # Aggregated analytics (all authenticated users)
  utils/
    errors.ts                # Typed error classes (AppError, NotFound, Forbidden, etc.)
    response.ts              # Consistent JSON response helpers
tests/
  run.ts                     # Integration test suite (51 assertions)
```

### Access Control Model

Rather than simple role whitelisting, the system implements a **role hierarchy**:

```
viewer (level 1) < analyst (level 2) < admin (level 3)
```

Two authorization strategies are available:

- `authorize('admin')` — exact role match. Used for write operations (create/update/delete).
- `requireMinRole('analyst')` — hierarchical check. Any role at or above the specified level passes. Used for read operations where multiple roles should have access.

The auth middleware also verifies on every request that:
- The JWT is valid and not expired
- The user still exists in the database (handles deleted users with active tokens)
- The user's account status is `active` (handles deactivated accounts)

Self-protection rules prevent admins from:
- Deleting their own account
- Deactivating their own account
- Changing their own role

### Error Handling Strategy

All errors flow through a single global error handler in `app.ts`. The application uses typed error classes (`NotFoundError`, `ForbiddenError`, `ConflictError`, etc.) that carry HTTP status codes and machine-readable error codes. Zod validation errors are caught separately and transformed into a structured format with per-field messages.

No error leaks internal details — unhandled errors return a generic 500 with `INTERNAL_ERROR`.

### Data Modeling

**users**

| Column | Type | Constraints |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| email | TEXT | Unique, not null |
| password | TEXT | bcrypt hash, not null |
| name | TEXT | Not null |
| role | TEXT | CHECK: viewer, analyst, admin |
| status | TEXT | CHECK: active, inactive |
| created_at | TEXT | ISO datetime, auto-set |
| updated_at | TEXT | ISO datetime, auto-set |

**financial_records**

| Column | Type | Constraints |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| user_id | TEXT | FK → users.id (CASCADE delete) |
| amount | REAL | Not null |
| type | TEXT | CHECK: income, expense |
| category | TEXT | Not null |
| date | TEXT | YYYY-MM-DD format |
| description | TEXT | Nullable |
| is_deleted | INTEGER | 0 or 1 (soft delete flag) |
| created_at | TEXT | ISO datetime, auto-set |
| updated_at | TEXT | ISO datetime, auto-set |

Indexes exist on: `user_id`, `type`, `category`, `date`, `is_deleted`, `email`, `status`.

Records use **soft delete** (`is_deleted = 1`) — all queries filter on `is_deleted = 0` automatically. Users use **hard delete** with cascading foreign keys.

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
# Clone and install
npm install

# Copy environment config
cp .env.example .env

# Seed the database (creates 3 users + 30 sample records)
npm run seed

# Start development server (hot reload)
npm run dev
```

The server starts at `http://localhost:3000`.

### Available Scripts

| Script | Command | Description |
|---|---|---|
| `npm run dev` | `tsx watch src/server.ts` | Development server with hot reload |
| `npm run build` | `tsc` | Compile TypeScript to `dist/` |
| `npm start` | `node dist/server.js` | Run compiled production build |
| `npm run seed` | `tsx src/config/seed.ts` | Seed database with sample data |
| `npm test` | `tsx tests/run.ts` | Run integration test suite |

### Environment Variables

See `.env.example` for all required variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment name |
| `JWT_SECRET` | — | Secret key for signing JWTs (change in production) |
| `JWT_EXPIRES_IN` | 24h | Token expiration duration |
| `DB_PATH` | ./database/zorvyn.db | SQLite database file path |
| `BCRYPT_ROUNDS` | 10 | Password hashing cost factor |

## API Reference

All endpoints return JSON in a consistent envelope:

```json
// Success
{ "success": true, "data": { ... } }

// Success with pagination
{ "success": true, "data": [...], "pagination": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 } }

// Error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Financial record not found" } }

// Validation error
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "details": [{ "field": "email", "message": "Invalid email address" }] } }
```

### Health Check

```
GET /api/health
```

```json
{ "status": "ok", "timestamp": "2026-04-01T12:00:00.000Z" }
```

---

### Auth

#### Register

```
POST /api/auth/register
```

```json
// Request
{ "email": "user@example.com", "password": "Secure@123", "name": "John Doe" }

// Response (201)
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "user@example.com", "name": "John Doe", "role": "viewer", "status": "active", "created_at": "...", "updated_at": "..." },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

Password requirements: min 8 chars, 1 uppercase, 1 number, 1 special character.

#### Login

```
POST /api/auth/login
```

```json
// Request
{ "email": "admin@zorvyn.com", "password": "Admin@123" }

// Response (200)
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "admin@zorvyn.com", "name": "Admin User", "role": "admin", "status": "active", "created_at": "...", "updated_at": "..." },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

#### Get Current User

```
GET /api/auth/me
Authorization: Bearer <token>
```

```json
// Response (200)
{
  "success": true,
  "data": { "user": { "userId": "uuid", "email": "admin@zorvyn.com", "role": "admin" } }
}
```

---

### Financial Records

All record endpoints require authentication. Write operations (POST, PUT, DELETE) require admin role.

#### List Records

```
GET /api/records?page=1&limit=20&type=income&category=Salary&date_from=2026-01-01&date_to=2026-12-31&search=bonus&sort_by=date&sort_order=desc
Authorization: Bearer <token>
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 100) |
| `type` | string | — | Filter: `income` or `expense` |
| `category` | string | — | Filter by exact category |
| `date_from` | string | — | Filter: records on or after (YYYY-MM-DD) |
| `date_to` | string | — | Filter: records on or before (YYYY-MM-DD) |
| `search` | string | — | Search in description and category |
| `sort_by` | string | date | Sort field: `date`, `amount`, `created_at` |
| `sort_order` | string | desc | Sort direction: `asc` or `desc` |

```json
// Response (200)
{
  "success": true,
  "data": [
    { "id": "uuid", "user_id": "uuid", "amount": 2500, "type": "income", "category": "Salary", "date": "2026-04-01", "description": "Monthly salary", "is_deleted": 0, "created_at": "...", "updated_at": "..." }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
}
```

#### Get Record by ID

```
GET /api/records/:id
Authorization: Bearer <token>
```

#### Create Record

```
POST /api/records
Authorization: Bearer <admin-token>
```

```json
// Request
{ "amount": 2500, "type": "income", "category": "Bonus", "date": "2026-04-01", "description": "Quarterly bonus" }

// Response (201)
{ "success": true, "data": { "id": "uuid", "user_id": "uuid", "amount": 2500, "type": "income", "category": "Bonus", "date": "2026-04-01", "description": "Quarterly bonus", "is_deleted": 0, "created_at": "...", "updated_at": "..." } }
```

#### Update Record

```
PUT /api/records/:id
Authorization: Bearer <admin-token>
```

```json
// Request (all fields optional)
{ "amount": 3000, "description": "Updated bonus amount" }

// Response (200) — returns full updated record
```

#### Delete Record (Soft Delete)

```
DELETE /api/records/:id
Authorization: Bearer <admin-token>
```

Returns `204 No Content`. The record is not physically deleted — `is_deleted` is set to `1` and it no longer appears in any queries.

---

### Users

All user endpoints require authentication. Read operations require analyst or admin role. Write operations require admin role.

#### List Users

```
GET /api/users?page=1&limit=20&role=viewer&status=active&search=john
Authorization: Bearer <analyst-or-admin-token>
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 100) |
| `role` | string | — | Filter: `viewer`, `analyst`, `admin` |
| `status` | string | — | Filter: `active`, `inactive` |
| `search` | string | — | Search in name and email |

```json
// Response (200)
{
  "success": true,
  "data": [
    { "id": "uuid", "email": "admin@zorvyn.com", "name": "Admin User", "role": "admin", "status": "active", "created_at": "...", "updated_at": "..." }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 }
}
```

Note: `password` is never included in any response.

#### Create User

```
POST /api/users
Authorization: Bearer <admin-token>
```

```json
// Request
{ "email": "newuser@zorvyn.com", "password": "NewUser@123", "name": "New User", "role": "viewer" }

// Response (201) — returns user without password
```

#### Update User

```
PUT /api/users/:id
Authorization: Bearer <admin-token>
```

```json
// Request (all fields optional)
{ "name": "Updated Name", "role": "analyst", "status": "inactive" }
```

#### Delete User

```
DELETE /api/users/:id
Authorization: Bearer <admin-token>
```

Returns `204 No Content`. This is a hard delete with cascading removal of associated records.

---

### Dashboard

All dashboard endpoints require authentication. Any authenticated role (viewer, analyst, admin) can access all dashboard data.

#### Full Overview

```
GET /api/dashboard/overview
Authorization: Bearer <token>
```

```json
// Response (200)
{
  "success": true,
  "data": {
    "summary": { "total_income": 45230.50, "total_expenses": 18420.75, "net_balance": 26809.75, "record_count": 30 },
    "categoryTotals": [{ "category": "Salary", "type": "income", "total": 25000, "count": 6 }],
    "monthlyTrends": [{ "month": "2026-01", "income": 8500, "expenses": 3200, "net": 5300 }],
    "recentActivity": [{ "id": "uuid", "amount": 2500, "type": "income", "category": "Salary", "date": "2026-04-01", "description": "Monthly salary", "created_at": "..." }]
  }
}
```

#### Summary Only

```
GET /api/dashboard/summary
```

Returns just the `summary` object (total income, expenses, net balance, record count).

#### Category Totals

```
GET /api/dashboard/categories
```

Returns income and expense totals grouped by category, sorted by total descending.

#### Monthly Trends

```
GET /api/dashboard/trends?months=6
```

Returns monthly income/expense/net aggregations. Defaults to 12 months, configurable via `?months=N`.

#### Recent Activity

```
GET /api/dashboard/recent?limit=5
```

Returns the N most recently created records. Defaults to 10, configurable via `?limit=N`.

## Roles & Permissions Matrix

| Action | Viewer | Analyst | Admin |
|---|---|---|---|
| View dashboard | Yes | Yes | Yes |
| View records | Yes | Yes | Yes |
| Create/update/delete records | No (403) | No (403) | Yes |
| View users | No (403) | Yes | Yes |
| Create/update/delete users | No (403) | No (403) | Yes |
| Access without token | No (401) | No (401) | No (401) |

## Security Features

- **JWT authentication** on all protected routes, verified on every request
- **bcrypt password hashing** with configurable cost factor
- **Helmet** security headers (XSS, clickjacking, MIME sniffing protection)
- **CORS** enabled for cross-origin requests
- **Rate limiting** — 200 requests per minute per IP (in-memory sliding window)
- **JSON body size limit** — 10KB max to prevent payload abuse
- **Password never exposed** — stripped from all API responses
- **Token invalidation** — deleted/inactive users are rejected even with valid JWTs
- **Input validation** — all inputs validated with Zod before reaching business logic

## Testing

The project includes an integration test suite that tests the full HTTP request/response cycle against a running server.

```bash
# Terminal 1 — start the server
npm run dev

# Terminal 2 — run tests
npm test
```

### Test Coverage (51 assertions)

| Module | Tests | What's Covered |
|---|---|---|
| Auth | 9 | Register, duplicate prevention, login, JWT token, /me, no-token rejection, input validation |
| Records | 15 | List, pagination, type filtering, CRUD, role enforcement (viewer blocked), soft delete, 404 handling |
| Users | 11 | List, role-based access (viewer blocked, analyst allowed), CRUD, password not exposed, 404 handling |
| Dashboard | 10 | Overview, summary, category totals, monthly trends, recent activity, query params |
| Edge Cases | 6 | Health check, unknown routes (404), invalid JSON, empty body validation |

## Seed Data

Running `npm run seed` populates the database with test data:

| Email | Password | Role |
|---|---|---|
| admin@zorvyn.com | Admin@123 | admin |
| analyst@zorvyn.com | Analyst@123 | analyst |
| viewer@zorvyn.com | Viewer@123 | viewer |

Plus 30 randomly generated financial records (mix of income/expense across 10 categories) attached to the admin user, spanning January–June 2026.

## Assumptions & Tradeoffs

1. **Synchronous database operations** — better-sqlite3 is intentionally synchronous. For a single-server finance API this avoids unnecessary async complexity and is actually faster than async SQLite wrappers. This would not scale to high-concurrency multi-server deployments, where PostgreSQL or MySQL would be the right choice.

2. **In-memory rate limiting** — the rate limiter uses a simple `Map` with periodic cleanup. This is appropriate for single-process deployments. A production system would use Redis-backed rate limiting for multi-instance deployments.

3. **Soft delete for records, hard delete for users** — financial records are soft-deleted to preserve audit trails. Users are hard-deleted with cascading FK removal since the assignment doesn't require user audit history.

4. **Flat role hierarchy** — three roles (viewer < analyst < admin) with a numeric hierarchy. This is simpler than a full RBAC/permission system but covers the assignment requirements cleanly. Adding new roles only requires adding an entry to the hierarchy map.

5. **No refresh tokens** — JWTs expire after 24 hours with no refresh mechanism. Acceptable for a development/assessment context. Production would need a refresh token rotation flow.

6. **UUID primary keys** — UUIDs avoid sequential ID enumeration attacks and work well for distributed systems, at the cost of slightly larger indexes compared to auto-increment integers.

7. **Passwords validated on register, not on admin-created users** — the register endpoint enforces strong password rules (uppercase, number, special char). The admin user creation endpoint requires only 8+ characters, since admins may set temporary passwords for new users.

8. **All dashboard queries are global** — dashboard endpoints aggregate across all records regardless of which user created them. This is a deliberate design choice for a shared finance dashboard. Per-user filtering could be added by scoping queries to `user_id`.

## Tech Stack

| Component | Technology | Version |
|---|---|---|
| Runtime | Node.js + TypeScript | TS 6 (strict) |
| Framework | Express | 5.x |
| Database | SQLite | better-sqlite3 |
| Authentication | JWT | jsonwebtoken |
| Password Hashing | bcryptjs | 3.x |
| Validation | Zod | 4.x |
| Security Headers | Helmet | 8.x |
| Logging | Morgan | 1.x |
