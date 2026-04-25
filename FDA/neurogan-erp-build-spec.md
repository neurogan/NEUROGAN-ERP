# NEUROGAN-ERP — Claude Code Build Specification

**Target repo:** https://github.com/neurogan/NEUROGAN-ERP (`main`)
**Source-of-truth companions:**
- `Response Package - FDA Form 483.md` — what FDA cited, what we committed
- `erp-gap-analysis-and-roadmap.md` — why each ticket exists, coverage today, sizing
- `AGENTS.md` (repo root, to be committed by ticket **F-00**) — working rules for Claude Code inside the repo
- `validation-scaffold.md` — GAMP 5 Cat 5 URS / FRS / DS / IQ / OQ / PQ / VSR templates
- `seed-fixtures-plan.md` — deterministic test data

**Date:** 2026-04-21
**Spec author:** Frederik Hejlskov
**QA signatory (platform + every module IQ/OQ/PQ):** Carrie Treat, QC/PCQI
**Engineering owner:** Frederik + 1 owner + AI assistance

---

## 0. How to use this document

Claude Code should treat each subsection labelled `F-##` or `R-##-##` as a single atomic ticket. Pick **one** ticket, open a branch, execute it end-to-end (schema → storage → API → UI → tests → validation artifacts), and open a PR. Do not combine tickets in a single PR unless a dependency explicitly permits it.

Every ticket has the same shape:

1. **Title** and observation / citation traceability
2. **Preconditions** — other tickets that must be merged first
3. **Data model** — Drizzle schema changes (new tables, column changes, migrations)
4. **API contract** — endpoints, methods, request/response Zod shapes, status codes
5. **Business rules** — server-side invariants, state transitions
6. **Part 11 requirements** — identity, audit, e-signature, record lock
7. **UI requirements** — pages, components, role gates, user flows
8. **Acceptance criteria** — checklist the PR must satisfy
9. **Test plan** — Vitest unit, supertest integration, Playwright UI (as applicable)
10. **Validation hooks** — what URS / FRS / DS / OQ entries to add or update
11. **Regulated-code Definition of Done** — see §3; every ticket must meet all DoD items

The **regulated-code DoD in §3 is non-negotiable.** A ticket is not done until every DoD item is checked — not merged, not marked complete, not considered "ready for review".

---

## 1. Architectural decisions (locked 2026-04-21)

These decisions are frozen for Release 1. Changing any of them requires a change-control record.

| # | Decision | Rationale |
|---|---|---|
| D-01 | **Session-based auth** via `passport-local` + `express-session` + `connect-pg-simple` (already in `package.json`; not yet mounted) | Simplest legally-defensible auth for a server-rendered + SPA hybrid; deferring JWT until a mobile shop-floor app exists. |
| D-02 | **Passwords hashed with `argon2id`** (argon2 npm package). Minimum 12 chars; complexity + 90-day rotation + lockout-on-5. | NIST 800-63B current guidance, and defeats the cheap-GPU threat model. |
| D-03 | **QA sign-off on every platform + module IQ/OQ/PQ:** Carrie Treat, QC/PCQI | Single accountable QA signer simplifies Part 11 attribution and training gates. |
| D-04 | **Module order follows the FDA clock** — Foundation → Receiving → COA/Lab → Equipment/Cleaning → Labeling → Complaints/SAER → Specifications. Phase 2 = MMR + BPR + Finished-Goods QC. | Matches response-letter commitments; CAPA due dates drive sequence. |
| D-05 | **Paper-parallel rollout**: no ERP module replaces paper as legal record until module IQ/OQ/PQ is signed and one full operational cycle has run in parallel. | §111.605 retention + FDA's stance on self-validated custom software. |
| D-06 | **Release 1 scope** = Foundation + 6 modules above. Release 2 = Stability, EM, CAPA, Training gate, QBO, Extensiv automation. | 180-day capacity with 1.2 FTE + AI. |
| D-07 | **Audit trail is append-only at the database layer** (revoked UPDATE/DELETE on `audit_trail` to the application role; only INSERT granted). Any attempt to rewrite audit is a Part 11 event. | Closes the obvious Part 11 bypass. |
| D-08 | **Electronic signatures require re-entry of the signer's password** at signing time, plus a `meaning` code. Session cookie alone is not a signature. | 21 CFR 11.200 "two distinct identification components" requirement when the signing happens within a continuous controlled session. |
| D-09 | **Drizzle migrations run only via explicit CI step**, not on boot. `runMigrations()` is removed from `server/index.ts`. | Self-mutating schemas in a validated system are not defensible. |
| D-10 | **Regulated writes reject identity from the request body**; all regulated endpoints take identity from `req.user.id`. Middleware `rejectIdentityInBody` enforces this. | Eliminates the "cosmetic signatures" class of bug (§4.1 of roadmap). |
| D-11 | **Strict TypeScript** (`strict: true`, `noUncheckedIndexedAccess: true`). `any` is a code-review block. | Types are part of the Design Specification (DS); weak types create latent defects. |
| D-12 | **State machines live in the storage layer** (`server/db-storage.ts`), not in route handlers. One place to reason about transitions. | Route handlers are orchestrators, not rule owners. |
| D-13 | **Time is UTC at the database boundary.** Timestamps are `timestamp with time zone`. Display converts to `America/Los_Angeles` at the UI layer. | Facility is San Diego; audit reviewers will expect PT. |
| D-14 | **Deterministic test seed** (`pnpm seed:test`). The seed is defined in `seed-fixtures-plan.md`. Tests assume nothing about the non-seed environment. | OQ requires reproducible starting state. |

---

## 2. Global conventions

### 2.1 Naming

- Tables: `erp_<snake_case>` (already established in schema).
- Columns: snake_case in SQL, camelCase in Drizzle/TS.
- Enums: UPPER_SNAKE_CASE strings persisted as `text`. New enums are declared as Zod unions in `shared/schema.ts` alongside the table.
- API routes: `/api/<module>/<resource>[/:id][/<action>]`. Actions are kebab-case (`qc-review`, `release`, `disposition`, `escalate`).
- Filenames: kebab-case for TS files (`db-storage.ts`, `audit-trail.ts`). Component files are `PascalCase.tsx`.

### 2.2 Error handling

- API errors return structured JSON: `{ "error": { "code": "<CODE>", "message": "<human>", "details": {...}? } }`.
- Codes include `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_FAILED`, `ILLEGAL_TRANSITION`, `SIGNATURE_REQUIRED`, `RECORD_LOCKED`, `CALIBRATION_OVERDUE`, `TRAINING_EXPIRED`, `DISQUALIFIED_LAB`, `NOT_ON_APPROVED_REGISTRY`, `IDENTITY_SAME` (dual-verification violation).
- HTTP statuses: 400 validation, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict/illegal transition, 422 signature required, 423 record locked, 5xx server errors.
- Server logs error codes + request id + user id + route. PHI/PII never logged.

### 2.3 Zod first

- Every request body → Zod parse → typed handler. Zod schemas are exported from `shared/` so the client re-uses them.
- `drizzle-zod` generates insert/update schemas; regulated tables reject unsafe columns at parse time (`auditTrail` rejects `createdAt` / `userId` overrides; inserts derive those server-side).

### 2.4 Test conventions

- Unit tests: Vitest, colocated (`foo.ts` + `foo.test.ts`). Pure functions only. Target: 100% of state-transition logic and signature-ceremony utilities.
- Integration tests: `server/__tests__/**.test.ts`, run against a disposable Postgres (docker-compose or Testcontainers). Use `supertest` against the real Express app. Every regulated endpoint has an integration test that covers: happy path, missing auth (401), wrong role (403), illegal transition (409), missing signature (422), and audit-trail side effect (verify a row was written).
- UI tests: Playwright, a small critical-path suite covering login, QC review, e-signature ceremony, and record-lock attempt. Run on CI only.
- Test seed: `pnpm seed:test` is deterministic; tests use a transaction-per-test wrapper that rolls back. No test may leak state.

### 2.5 PR shape

- One ticket → one branch → one PR. Commit history is linear.
- PR description uses `AGENTS.md` PR template (see that doc).
- Screenshots required for any UI change.
- For any schema change, the PR must include a Drizzle migration file, the before/after schema comment, and the rollback command.

### 2.6 "Do not do" list

- Never accept identity from the request body on regulated endpoints.
- Never mutate a record in an APPROVED or RELEASED state. New version required.
- Never bypass the state-transition guard with a raw SQL update.
- Never write your own password hashing. Use `argon2`.
- Never rely on the session cookie as a signature.
- Never skip writing an audit trail row on a regulated write.
- Never add a free-text "verified by" string to a new schema. Use a user FK + an e-signature FK.
- Never run a migration on boot. Migrations are a deploy step.
- Never introduce `any`. If the type isn't known, model it.

---

## 3. Regulated-code Definition of Done

A ticket is not done until **all** of the following are true. PR merge is blocked if any item is unchecked.

- [ ] All new regulated endpoints require authentication; unauthenticated requests return 401.
- [ ] All new regulated endpoints are gated by role (one of ADMIN, QA, PRODUCTION, RECEIVING, VIEWER) and return 403 otherwise.
- [ ] All regulated writes (INSERT/UPDATE on a regulated table) produce a row in `audit_trail` with before/after JSON, user id, timestamp, route, and request id.
- [ ] All state transitions on `lots`, `receiving_records`, `production_batches`, `batch_production_records` (and any future regulated record) go through the storage-layer transition guard. Raw SQL transitions are impossible (role-gated at DB level).
- [ ] Every signing action (`QC Disposition`, `QA Release`, `Deviation Disposition`, `Return Disposition`, `Complaint Review`, `SAER Submit`) requires the signature ceremony: password re-entry + meaning code + manifestation on the target record.
- [ ] No free-text identity fields in new schema. Identity is a `users.id` FK. A signature is a `electronic_signatures.id` FK.
- [ ] No request-body identity on regulated endpoints. `rejectIdentityInBody` middleware is applied; tests verify it returns 400.
- [ ] Zod schemas for request, response, and DB-insert are exported from `shared/`.
- [ ] Integration tests: happy path, 401, 403, 409 illegal transition, 422 missing signature, audit-trail side-effect assert.
- [ ] State-machine unit tests cover every edge (legal + illegal).
- [ ] Drizzle migration committed, up and down both tested locally.
- [ ] Migration does not delete data. If data shape changes, migration preserves prior data in a `*_legacy` column, a new table, or a retained backup.
- [ ] No `any` types introduced. ESLint `@typescript-eslint/no-explicit-any` is `error`.
- [ ] URS / FRS / DS entries for the ticket appended to the validation scaffold in the same PR.
- [ ] OQ test case(s) referenced in the traceability matrix.
- [ ] PR description lists observation number(s) the ticket closes or partially closes.
- [ ] PR description lists the exit gate — i.e. what still blocks the module from going live.

---

## 4. Phase 0 — Foundation (tickets F-00 through F-10)

Goal: turn the current codebase into a platform that can truthfully claim Part 11 identity, attribution, signature, and audit.

No module in Phase 1 may begin until **all** Phase 0 tickets are merged, platform IQ/OQ/PQ is signed by Carrie Treat, and the platform validation summary report (VSR-PLATFORM) is on file.

### 4.0 F-00 — Repo hygiene and working rules (AGENTS.md, CI, scripts)

**Traceability:** Enables every later ticket. Not itself a Part 111 item.
**Preconditions:** none.

**Scope**
- Commit `AGENTS.md` (companion doc — contents defined separately).
- Add `pnpm` scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `seed:test`, `migrate:up`, `migrate:down`, `migrate:status`.
- Add ESLint + Prettier config; `@typescript-eslint/no-explicit-any: error`; `no-floating-promises: error`; `eqeqeq: error`.
- Add GitHub Actions CI: `lint`, `typecheck`, `test`, `test:integration`, `build`. Required to merge.
- Add `CODEOWNERS` — regulated paths (`shared/schema.ts`, `server/db-storage.ts`, `server/auth/*`, `server/audit/*`) require QA (Frederik) review.
- Delete `runMigrations()` call from `server/index.ts` (**D-09**).
- Add `VERSION` file or inject commit SHA into the `/api/health` response for IQ traceability.

**Acceptance**
- CI green on `main`.
- `runMigrations()` call removed; `pnpm migrate:up` is the only migration entry point.
- ESLint and typecheck pass with `--max-warnings 0`.

**Tests**
- CI config itself exercises the scripts.

**DoD:** §3 items 13 (no `any`), 11 (migrations not on boot), and PR template in place.

---

### 4.1 F-01 — Users, roles, role-gate middleware

**Traceability:** Prereq for §111 Obs 3, 4, 5, 7, 9, 11, 12, 13 (every QA / QC / production identity). Part 11 §11.10(d), §11.10(g).
**Preconditions:** F-00.

**Data model**

```ts
// shared/schema.ts (append)

export const userRoleEnum = z.enum(["ADMIN", "QA", "PRODUCTION", "WAREHOUSE", "VIEWER"]);

export const users = pgTable("erp_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  title: text("title"),                  // e.g. "QC / PCQI"
  passwordHash: text("password_hash").notNull(),              // argon2id
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  status: text("status").$type<"ACTIVE" | "DISABLED">().notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
});

export const userRoles = pgTable("erp_user_roles", {
  userId: uuid("user_id").notNull().references(() => users.id),
  role: text("role").$type<z.infer<typeof userRoleEnum>>().notNull(),
  grantedByUserId: uuid("granted_by_user_id").notNull().references(() => users.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  pk: primaryKey({ columns: [t.userId, t.role] }),
}));
```

**API contract**

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/users` | `{ email, fullName, title?, roles: UserRole[] }` | `201 UserResponse` | ADMIN only. Temporary password emailed (or shown once in admin UI). User must rotate on first login. |
| GET | `/api/users` | — | `200 UserResponse[]` | ADMIN, QA |
| GET | `/api/users/:id` | — | `200 UserResponse` | ADMIN, QA, self |
| PATCH | `/api/users/:id/roles` | `{ add?: UserRole[], remove?: UserRole[] }` | `200 UserResponse` | ADMIN only |
| PATCH | `/api/users/:id/status` | `{ status }` | `200 UserResponse` | ADMIN only; disables cannot delete |

`UserResponse` never includes `passwordHash`. `passwordChangedAt`, `lockedUntil`, `failedLoginCount` are ADMIN-only.

**Business rules**
- The last ADMIN cannot be removed (409).
- You cannot disable yourself (409).
- Role grants write an audit-trail row.

**Part 11**
- All user-admin actions are regulated writes. Audit trail on every grant/revoke.
- Admin deletion is disabled at the app level. Users are `DISABLED`, never deleted.

**UI**
- `/settings/users` — list, create, disable, role edit. ADMIN only. Role edit opens a dialog.
- `/profile` — user's own page; password rotation form; "force logout all sessions" button.

**Acceptance**
- Seed data includes 4 canonical users (see `seed-fixtures-plan.md`): `admin@neurogan.com` (ADMIN), `carrie.treat@neurogan.com` (QA + ADMIN), `prod@neurogan.com` (PRODUCTION), `recv@neurogan.com` (RECEIVING).
- Cannot create two users with the same email.
- Cannot demote the last ADMIN.

**Tests**
- Unit: `computeRoleDelta(add, remove)` idempotent.
- Integration: all 5 endpoints; 401/403 matrix; last-ADMIN constraint; self-disable constraint; audit row asserts.

**Validation**
- URS-F-01-01 "System shall maintain unique identification of every user who performs regulated actions."
- FRS-F-01-01 "`POST /api/users` creates a user with at least one role; email unique."
- OQ-F-01-01 "Create user. Verify audit row. Verify login with temporary password forces rotation."

---

### 4.2 F-02 — Authentication, sessions, password policy

**Traceability:** Part 11 §11.10(d), §11.10(g), §11.10(i), §11.200, §11.300.
**Preconditions:** F-01.

**Scope**
- Mount `express-session` with `connect-pg-simple` store, rolling cookie (secure, httpOnly, sameSite=lax), 15-minute idle timeout.
- Mount `passport` with `passport-local` strategy; serialize user id only.
- `argon2id` password hashing (memoryCost 64MiB, timeCost 3, parallelism 2).
- Password policy: ≥12 chars, at least one uppercase, lowercase, digit, symbol. Pre-login check blocks obvious reuse of previous 5 hashes.
- Failed-login lockout: 5 failures → 30-min lockout; lockout releases only via admin action or timeout.
- Password rotation: required at 90 days since `passwordChangedAt`; soft-gate at login until rotated.
- Login endpoint emits audit row (success + failure).
- `req.user` type-augmented globally via `server/types/express.d.ts`.

**API contract**

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `200 { user }` or 401 | Sets session cookie. 423 when locked. 200 but flagged `mustRotatePassword: true` when expired. |
| POST | `/api/auth/logout` | — | `204` | Destroys session. |
| POST | `/api/auth/rotate-password` | `{ currentPassword, newPassword }` | `204` | Requires active session. 422 if policy violation. |
| GET | `/api/auth/me` | — | `200 { user, roles, mustRotatePassword }` | — |

**Middleware**
- `requireAuth(req, res, next)` — 401 if no session.
- `requireRole(...roles)` — 403 if no matching role.
- `rejectIdentityInBody(fields: string[])` — 400 if any of `fields` are present in `req.body` (for regulated endpoints that used to accept `reviewedBy`, `performedBy`, `verifiedBy` from the body).

**Part 11**
- Login-success + login-failure audit rows carry `email` (not password), IP, user agent.
- Logout (user or session expiration) audits.
- Session secret from `SESSION_SECRET` env; rotated quarterly.
- Sessions in Postgres `session` table; cleanup runs daily.

**UI**
- `/login` page — email, password, submit. On `mustRotatePassword`, redirect to `/profile/rotate-password`.
- Inactivity warning dialog at 14 minutes; auto-logout at 15.

**Acceptance**
- `curl /api/products` without session returns 401 (previously 200).
- 6th wrong login returns 423 with `lockedUntil`.
- Password rotation enforced at 91 days.

**Tests**
- Integration: login success/failure; lockout; session cookie set; 401 everywhere post-logout; 90-day rotation gate.
- Vitest: password-policy unit tests.

**Validation**
- URS-F-02-01 "System authenticates users before any regulated action."
- URS-F-02-02 "System applies a password policy consistent with NIST 800-63B."
- OQ-F-02-01 (per-item tests in `validation-scaffold.md`).

---

### 4.3 F-03 — Audit trail (append-only)

**Traceability:** §111.180 (records), Part 11 §11.10(e). Supports every ticket.
**Preconditions:** F-01, F-02.

**Data model**

```ts
export const auditTrail = pgTable("erp_audit_trail", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").notNull().references(() => users.id),
  action: text("action").notNull(),     // "CREATE" | "UPDATE" | "DELETE_BLOCKED" | "TRANSITION" | "SIGN" | "LOGIN" | "LOGIN_FAILED" | "LOGOUT" | "ROLE_GRANT" | "ROLE_REVOKE"
  entityType: text("entity_type").notNull(),   // "lot", "receiving_record", ...
  entityId: text("entity_id"),           // nullable for LOGIN/LOGOUT
  before: jsonb("before"),               // nullable on CREATE
  after: jsonb("after"),                 // nullable on DELETE_BLOCKED or LOGIN
  route: text("route"),                  // "POST /api/coa/:id/qc-review"
  requestId: text("request_id"),
  meta: jsonb("meta"),                   // free-form (IP, UA, reason, linked signature id)
});

// Index on (entityType, entityId, occurredAt DESC) for record history view.
// Index on (userId, occurredAt DESC) for per-user audit.
```

**Database-level protection**
- Create a dedicated Postgres role `erp_app` that owns the schema; grant `INSERT` only on `erp_audit_trail`. REVOKE UPDATE/DELETE.
- Add `CHECK (occurred_at <= now() + interval '1 minute')` to prevent future-dating.
- Add migration that sets default grants for the app role and fails the boot if `SELECT has_table_privilege('erp_app','erp_audit_trail','UPDATE')` returns true.

**Storage layer**
- `withAudit<T>(entityType, entityId, action, before, fn): Promise<T>` wraps a regulated write; it computes `after` from the return value and writes the audit row inside the same transaction. All regulated writes go through this.

**API**
- `GET /api/audit?entityType=&entityId=&userId=&from=&to=&limit=&cursor=` — ADMIN, QA only. Cursor-paginated.
- `GET /api/audit/export?...` — ADMIN only; NDJSON stream for periodic QA review (§11.10(e) retention).

**UI**
- `/audit` — filterable list.
- On every regulated record page (lot, receiving record, BPR, COA, complaint, return), an "Audit" tab renders the history for that record.

**Acceptance**
- Every regulated test from earlier tickets finds a matching audit row.
- Attempt to UPDATE `erp_audit_trail` from app role fails at the DB level.

**Tests**
- Integration: create a product, verify audit row with before=null / after=product.
- Integration: attempt an UPDATE against `erp_audit_trail` from a test-harness using the `erp_app` role; assert permission error.

**Validation**
- URS-F-03-01 "System maintains a tamper-resistant audit trail of all regulated writes."
- OQ-F-03-01 (append-only enforcement test).

---

### 4.4 F-04 — Electronic signatures (ceremony + manifestation)

**Traceability:** Part 11 §11.50, §11.70, §11.100, §11.200, §11.300. Supports Obs 4, 5, 7, 12.
**Preconditions:** F-01, F-02, F-03.

**Data model**

```ts
export const signatureMeaningEnum = z.enum([
  "AUTHORED", "REVIEWED", "APPROVED", "REJECTED",
  "QC_DISPOSITION", "QA_RELEASE", "DEVIATION_DISPOSITION",
  "RETURN_DISPOSITION", "COMPLAINT_REVIEW", "SAER_SUBMIT",
  "MMR_APPROVAL", "SPEC_APPROVAL", "LAB_APPROVAL",
]);

export const electronicSignatures = pgTable("erp_electronic_signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").notNull().references(() => users.id),
  meaning: text("meaning").$type<z.infer<typeof signatureMeaningEnum>>().notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  commentary: text("commentary"),
  fullNameAtSigning: text("full_name_at_signing").notNull(),        // snapshot from users.fullName
  titleAtSigning: text("title_at_signing"),                         // snapshot from users.title
  requestId: text("request_id").notNull(),
  manifestationJson: jsonb("manifestation_json").notNull(),         // printable representation
});
```

**Ceremony (server)**
- Endpoint `POST /api/signatures` (used internally by other endpoints, not directly by UI).
- Input: `{ entityType, entityId, meaning, password, commentary? }`.
- Server verifies `password` against `users.passwordHash` (argon2 verify). Failed verification increments `failedLoginCount` and may lock.
- Server composes the manifestation JSON from the target record snapshot + `{ fullName, title, signedAt, meaning }`.
- Insert signature row inside the same transaction as the regulated state change.
- Audit row `action = "SIGN"` with `meta.signatureId`.

**API**
- Signature creation is always tied to another regulated endpoint, not exposed as a standalone UI.
- `GET /api/signatures?entityType=&entityId=` — ADMIN, QA.

**UI**
- Shared `<SignatureCeremony>` dialog component. Inputs: password, optional commentary. Shows the manifestation preview ("I, **Carrie Treat (QC / PCQI)**, hereby ___ this record on ___.") before submit. Submit button disabled until password is non-empty.
- On every regulated record page, signatures are listed under a "Signatures" tab with name, title-at-signing, meaning, time.

**Acceptance**
- A wrong password on signature returns 401 and does not advance record state.
- Signature row + state change + audit row land in the same transaction (integration test asserts all three or none).

**Tests**
- Integration: signature fails on wrong password; 5 wrong password attempts lock the user (per F-02).
- Integration: signature success → entity state transitions → audit row with `action=SIGN` exists → signature row exists, all in one transaction.

**Validation**
- URS-F-04-01 "Regulated state transitions require a Part 11 electronic signature."
- URS-F-04-02 "Electronic signatures contain name, title, meaning, and time."
- OQ-F-04-01 (ceremony atomicity test).

---

### 4.5 F-05 — Record lock + state-transition guard

**Traceability:** Part 11 §11.10(a), §111 §111.180; supports Obs 2 (MMR versioning), Obs 3 (BPR), Obs 4 (COA), Obs 5 (release), Obs 7 (complaints), Obs 12 (returns).
**Preconditions:** F-01, F-02, F-03.

**Scope**
- `server/state/transitions.ts` — a single module that defines the state graph for every regulated entity. Format:

```ts
type Transition<TState extends string> = {
  from: TState;
  to: TState;
  action: string;         // e.g. "QC_APPROVE"
  requiredRoles: UserRole[];
  requiredSignatureMeaning?: SignatureMeaning;
};

export const lotTransitions: Transition<LotStatus>[] = [
  { from: "QUARANTINED", to: "SAMPLING", action: "BEGIN_SAMPLING", requiredRoles: ["QA", "WAREHOUSE"] },
  { from: "SAMPLING",    to: "PENDING_QC", action: "SAMPLING_COMPLETE", requiredRoles: ["QA", "WAREHOUSE"] },
  { from: "PENDING_QC",  to: "APPROVED", action: "QC_APPROVE", requiredRoles: ["QA"], requiredSignatureMeaning: "QC_DISPOSITION" },
  { from: "PENDING_QC",  to: "REJECTED", action: "QC_REJECT", requiredRoles: ["QA"], requiredSignatureMeaning: "QC_DISPOSITION" },
  { from: "PENDING_QC",  to: "ON_HOLD", action: "QC_HOLD", requiredRoles: ["QA"], requiredSignatureMeaning: "QC_DISPOSITION" },
  // terminal: APPROVED, REJECTED — no transitions out (new lot required)
  { from: "ON_HOLD",     to: "PENDING_QC", action: "RELEASE_FROM_HOLD", requiredRoles: ["QA"], requiredSignatureMeaning: "QC_DISPOSITION" },
];
```
- `transition(entity, action, { userId, signatureId? })` is the only way to change a status column. It validates `from → to`, role, and signature. Returns the new state or throws `IllegalTransitionError`.
- Record lock: `lots.status in ("APPROVED","REJECTED")`, `batch_production_records.qcDisposition in ("APPROVED","REJECTED")`, `mmr_versions.status = "APPROVED"`, etc. trigger a lock. Any UPDATE attempt on a locked record throws `RECORD_LOCKED` (423). Exception: a few whitelisted "cosmetic" fields (e.g., storage location note) may be updated with an audit row; these are declared per-table in `server/state/locks.ts`.

**API**
- No new endpoints. Existing and future endpoints use `transition()` and `assertNotLocked()` from the storage layer.

**UI**
- Illegal transitions surface as an inline error toast with the specific reason. The "Approve" button is hidden unless the user's roles include those required for the transition from the current state.

**Acceptance**
- Attempt to PATCH a lot directly from `QUARANTINED` → `APPROVED` returns 409 `ILLEGAL_TRANSITION`.
- Attempt to UPDATE a locked MMR version returns 423 `RECORD_LOCKED`.

**Tests**
- Unit: every row of every state graph has legal and illegal transition tests.
- Integration: role mismatch returns 403; missing signature returns 422.

**Validation**
- URS-F-05-01 "Regulated records cannot be modified after locking."
- URS-F-05-02 "State transitions are restricted to authorized roles and require applicable e-signatures."

---

### 4.6 F-06 — Remove body-supplied identity across existing endpoints

**Traceability:** Direct prerequisite for Obs 3, 4, 5 compliance. Risk flag §4.1/§4.4 of roadmap.
**Preconditions:** F-01, F-02.

**Scope**
- Identify every existing endpoint that accepts `reviewedBy`, `performedBy`, `verifiedBy`, `weighedBy`, `addedBy`, `qcReviewedBy`, `approvedBy` in the request body. Starting set (grep-identified in roadmap §2.3):
  - `POST /api/receiving/:id/qc-review` — remove `reviewedBy` from body; use `req.user.id`.
  - `POST /api/coa/:id/qc-review` — same.
  - `POST /api/batch-production-records/:id/qc-review` — same.
  - `POST /api/bpr/:id/steps/:stepId/verify` — remove `verifiedBy`; use `req.user.id`.
  - Similar for weigh, addition, cleaning-verification endpoints.
- Apply `rejectIdentityInBody(["reviewedBy","performedBy","verifiedBy","weighedBy","addedBy","qcReviewedBy","approvedBy"])` middleware globally on regulated routes.
- Replace server-side reads of those fields with `req.user.id`.
- For dual verification, enforce in storage layer: `assertDistinctUsers(aUserId, bUserId)` throws `IDENTITY_SAME` (409) if equal.

**API contract changes**
- Request bodies lose identity fields. Response shapes gain structured `reviewedBy: { id, fullName, title }`.

**Part 11**
- QC review now writes a signature row (see F-04) in the same transaction.

**UI**
- Remove "Reviewed by" text inputs. Replaced by the signature ceremony (F-04) which uses the session user.

**Acceptance**
- A request that sets `reviewedBy` in the body to `"Jane"` returns 400 `VALIDATION_FAILED` and the record is unchanged.

**Tests**
- Integration: all above endpoints reject body identity; use `req.user.id`; dual-verification failure returns 409.

**Validation**
- URS-F-06-01 "Identity fields on regulated endpoints derive only from the authenticated session."

---

### 4.7 F-07 — Hardening: helmet, rate limit, CORS, CSP, request id

**Traceability:** Risk flag §4.7 of roadmap; not a 483 item but a production-readiness gate.
**Preconditions:** F-00.

**Scope**
- `helmet()` mounted with default + `frameguard: { action: 'deny' }` and a strict CSP.
- `express-rate-limit` on `/api/auth/*` (5 per minute per IP) and 60 per minute per session on the rest.
- CORS policy: allowlist Railway app origin + dev `localhost:5173`. No wildcard.
- `express-request-id` or equivalent — every request gets a UUID; logged and echoed in error responses.
- Boot fails if `SESSION_SECRET`, `DATABASE_URL` missing; boot fails if CSP allowlist is empty.

**Acceptance**
- `curl` with a wrong origin is rejected by CORS.
- 6th login attempt per minute returns 429.

**Tests**
- Integration: CORS reject; rate-limit at 6th login; request id round-trip.

**Validation**
- URS-F-07-01 "Platform applies defense-in-depth controls at the transport and request layers."

---

### 4.8 F-08 — Backup, restore, DR test

**Traceability:** §111.605 retention, Part 11 §11.10(c); platform IQ/OQ/PQ precondition.
**Preconditions:** F-00.

**Scope**
- Document Railway Postgres backup cadence (daily snapshot, 30-day retention minimum; escalate to weekly-off-site if not).
- Write `scripts/restore-check.ts` — spins up a disposable Postgres from the latest snapshot and runs a minimal "can we read lots / batches / audit trail" assertion.
- Schedule `restore-check` monthly in CI. QA signs the result.
- Document RTO/RPO in `docs/dr.md`. Commit.

**Acceptance**
- First successful restore-check run archived in the validation scaffold.
- DR doc in `docs/dr.md` with RTO, RPO, ownership, escalation.

**Tests**
- `restore-check.ts` is a test in itself and runs in CI as a scheduled job.

**Validation**
- URS-F-08-01 "Records are recoverable within RTO/RPO per DR plan."

---

### 4.9 F-09 — Seed & fixtures

**Traceability:** OQ reproducibility; not regulatory on its own.
**Preconditions:** F-01 through F-06.

**Scope**
- `pnpm seed:test` — loads deterministic users, roles, sample supplier, sample lab, sample products, one sample MMR draft, one sample lot, one sample complaint (AE & non-AE), one returned product.
- Used by integration tests via a transaction-per-test wrapper.
- Full spec in `seed-fixtures-plan.md`.

**Acceptance**
- `pnpm seed:test` is idempotent from an empty schema.
- `pnpm test:integration` runs green using only seed + test-created data.

---

### 4.10 F-10 — Platform Validation Package (URS, FRS, DS, IQ, OQ, PQ, VSR)

**Traceability:** GAMP 5 Category 5 mandatory deliverable. Signed by Carrie Treat.
**Preconditions:** F-01 through F-09.

**Scope**
- Populate the templates in `validation-scaffold.md` with all F-## entries.
- Draft IQ: Railway environment (Postgres version, app image hash, env vars, secrets vault).
- Draft OQ: the Vitest + supertest + Playwright suites already written.
- Draft PQ: a 5-working-day shadow run on non-production data, covering login, role changes, audit export, record-lock attempt, signature ceremony, rollback.
- Traceability Matrix: obs → URS → FRS → DS → OQ tests.
- Validation Summary Report (VSR-PLATFORM): Carrie Treat signs.

**Acceptance**
- VSR-PLATFORM signed and dated by Carrie Treat.
- Phase 1 modules can now begin.

---

## 5. Phase 1 — Release 1 modules

Order follows **D-04** (FDA clock). Each module owns a sub-numbering convention `R-##-##`, e.g. R-01-03.

### 5.1 R-01 — Receiving (Obs 1, 4, 6, 11, 13 + approved-materials)

**Traceability:** Obs 1 (specs), Obs 4 (COA review), Obs 6 (disqualified lab), Obs 11 (sampling), Obs 13 (approved materials).
**Preconditions:** F-10.

Tickets in this module:

#### R-01-01 — Approved-materials registry

- **Table:** `approved_materials` (itemName, supplierId FK, cfrCitation e.g. "21 CFR 177.1520", sdsUrl, expiresAt, addedByUserId, status ACTIVE/RETIRED).
- **API:** CRUD for ADMIN/QA; GET for PRODUCTION/RECEIVING.
- **Business rule:** PO line items for `category in (COMPONENT, PACKAGING, CONSUMABLE)` must cite an ACTIVE `approved_materials.id`. Enforced in PO-create endpoint; 422 `NOT_ON_APPROVED_REGISTRY` otherwise.
- **UI:** `/quality/approved-materials` CRUD page.
- **Tests:** PO creation rejected without registry match; accepted with match; ADMIN can retire an entry (audit row).
- **Validation:** URS-R-01-01-01.

#### R-01-02 — Labs registry (accredited / disqualified)

- **Table:** `labs` (name, accreditationNumber, status ACCREDITED/DISQUALIFIED/PENDING, scope text, disqualifiedReason, disqualifiedAt).
- **Seed:** Symbio Labs = DISQUALIFIED. Eurofins, Alkemist = ACCREDITED.
- **Business rule:** `coa_documents` FK to `labs.id`. COA acceptance rejected if lab status ≠ ACCREDITED (422 `DISQUALIFIED_LAB`).
- **UI:** `/quality/labs` CRUD (ADMIN/QA).
- **Tests:** COA acceptance blocked on DISQUALIFIED; allowed on ACCREDITED.
- **Validation:** URS-R-01-02-01.

#### R-01-03 — Component specifications v1

- **Tables:** `specifications` (scope: COMPONENT/IN_PROCESS/FINISHED, productId FK, ownerUserId, status DRAFT/APPROVED/RETIRED, approvedBySignatureId FK), `specification_versions`, `spec_limits` (attribute, method, min, max, unit, tolerance).
- **Business rule:** `labTestResults` FK to the specific `specification_versions.id` they were evaluated against. An OOS test result auto-opens a nonconformance (Release 2) or a Phase-1 interim `spec_oos_flags` row.
- **UI:** `/quality/specifications` list + editor. Approval triggers F-04 signature ceremony (`SPEC_APPROVAL` meaning).
- **Tests:** Spec approval requires QA role + signature; approved spec is locked (F-05); OOS flag created on test result import.
- **Validation:** URS-R-01-03-01.

#### R-01-04 — Receiving state hardening

- **Scope:** Remove any client-controlled status change on `lots` and `receiving_records`; route through `transition()` (F-05).
- **Default:** `products.quarantineStatus` default changed to `QUARANTINED` for `category IN (RAW, COMPONENT)`. Migration backfills existing `APPROVED` rows to `QUARANTINED` unless they have a signed QC disposition.
- **Tests:** All existing receiving tests updated; illegal transitions return 409.
- **Validation:** URS-R-01-04-01.

#### R-01-05 — Sampling plan generator (ANSI/ASQ Z1.4 GI L-II)

- **Tables:** `qc_sampling_plans` (ruleset ref), `qc_samples` (lotId FK, plannedQty, pulledQty, pulledByUserId, retentionLocation, retentionExpiresAt).
- **Algorithm:** Z1.4 General Inspection Level II tables; helper `computeSampleSize(lotSize, level): number` is pure and unit-tested against the table.
- **Business rule:** Lot cannot transition `QUARANTINED → SAMPLING` without a generated sampling plan. Lot cannot transition `SAMPLING → PENDING_QC` without `pulledQty ≥ plannedQty`.
- **UI:** Receiving detail page shows the generated plan; operator enters pulledQty + retention location.
- **Tests:** Unit tests for every lot-size bucket in the Z1.4 table (exhaustive); integration test for transition gating.
- **Validation:** URS-R-01-05-01.

#### R-01-06 — COA intake & attach

- **Scope:** Upload PDF → store on object storage (S3-compatible; Railway volume as fallback) → row in `coa_documents` → FK on `lots.coaDocumentId`. Lab FK enforced (R-01-02).
- **Business rule:** A lot may have multiple COAs (identity, strength, contaminants). Lot cannot transition to `APPROVED` unless all *required* COA categories for that component are present and QC-accepted.
- **UI:** Drag-drop upload; metadata form (labId, testTypes[], reportDate).
- **Tests:** Upload flow; lab disqualification block; multi-COA lot with one missing category cannot be approved.
- **Validation:** URS-R-01-06-01.

#### R-01-07 — QC disposition signature

- **Scope:** Rewire existing `POST /api/receiving/:id/qc-review` to take only `{ decision: APPROVED|REJECTED|ON_HOLD, commentary, password }`. Derive reviewer from session. Route through F-04 (`QC_DISPOSITION`) and F-05 `transition()`.
- **Tests:** Happy path; wrong role; wrong password; already-disposed lot is locked.
- **Validation:** URS-R-01-07-01.

#### R-01-08 — Receiving IQ/OQ/PQ

- Run module validation per `validation-scaffold.md`. Carrie Treat signs VSR-R-01.

**Module go-live rule (D-05):** Until VSR-R-01 signed, paper receiving log continues as legal record; ERP runs in parallel.

---

### 5.2 R-02 — COA / Lab (Obs 4, 6)

Many sub-tickets overlap R-01-02 and R-01-06. Additional items:

#### R-02-01 — Structured lab result capture

- **Table:** `lab_test_results` (coaDocumentId FK, specificationVersionId FK, attribute, method, value, unit, pass: boolean, measuredAt).
- **UI:** Table editor on COA detail page. Operator keys in values from the PDF; pass/fail computed from spec.
- **Tests:** OOS result triggers `spec_oos_flags` row; pass hides the flag.
- **Validation:** URS-R-02-01-01.

#### R-02-02 — Method validation record

- **Table:** `method_validations` (labId FK, method, version, validatedAt, validatedBySignatureId FK, documentUrl).
- **Business rule:** A lab + method combo must have a recent (≤3y) method-validation record before COAs using that method are acceptable.
- **Tests:** Missing method validation → COA acceptance blocked with 422.
- **Validation:** URS-R-02-02-01.

#### R-02-03 — Module IQ/OQ/PQ (VSR-R-02).

---

### 5.3 R-03 — Equipment & cleaning (part of Obs 3)

#### R-03-01 — Equipment master + qualifications

- **Tables:** `equipment` (assetTag, name, model, serial, location), `equipment_qualifications` (equipmentId, type IQ/OQ/PQ, status, signatureId, validFrom, validUntil).
- **UI:** `/equipment` CRUD.
- **Tests:** Only QA can promote an equipment qualification.
- **Validation:** URS-R-03-01-01.

#### R-03-02 — Calibration schedule + records

- **Tables:** `calibration_schedules` (equipmentId FK, frequencyDays, nextDueAt), `calibration_records` (equipmentId FK, performedAt, performedByUserId, result PASS/FAIL, certUrl, signatureId).
- **Business rule:** A BPR cannot START (transition DRAFT→IN_PROGRESS) if any in-use equipment has `nextDueAt < now()`. 409 `CALIBRATION_OVERDUE`.
- **UI:** Equipment detail page → calibration tab. Dashboard tile "Calibrations due this week."
- **Tests:** BPR start blocked on overdue calibration; recording a PASS unblocks.
- **Validation:** URS-R-03-02-01.

#### R-03-03 — Cleaning logs

- **Table:** `cleaning_logs` (equipmentId FK, cleanedAt, cleanedByUserId, verifiedByUserId, method, signatureId, priorProductId FK, nextProductId FK).
- **Migration:** Replace `batch_production_records.cleaning_record_reference` (text) with `cleaning_log_id` (FK). Backfill existing text references into a `cleaning_record_legacy_text` column (do not drop data).
- **Business rule:** `cleanedByUserId ≠ verifiedByUserId` (dual verification, F-05).
- **Tests:** BPR step referencing a non-existent cleaning log returns 422; same-user verify returns 409 `IDENTITY_SAME`.
- **Validation:** URS-R-03-03-01.

#### R-03-04 — Line clearance

- **Table:** `line_clearances` (equipmentId, productChangeFromId, productChangeToId, performedAt, performedByUserId, signatureId).
- **Business rule:** At a product changeover (BPR SKU ≠ prior BPR SKU on same equipment), BPR start blocked until a line-clearance record exists for that transition.
- **Validation:** URS-R-03-04-01.

#### R-03-05 — Module IQ/OQ/PQ (VSR-R-03).

---

### 5.4 R-04 — Labeling & reconciliation (Obs 9, 10)

#### R-04-01 — Artwork master + approval

- **Tables:** `label_artwork` (productId FK, version, artworkUrl, approvedBySignatureId, status DRAFT/APPROVED/RETIRED).
- **Business rule:** Only APPROVED artwork can be issued. Approval through F-04 (`APPROVED` meaning).
- **Validation:** URS-R-04-01-01.

#### R-04-02 — Label issuance log

- **Table:** `label_issuance_log` (bprId FK, artworkId FK, quantityIssued, issuedAt, issuedByUserId).
- **Business rule:** Issuance must be tied to a live BPR.
- **Validation:** URS-R-04-02-01.

#### R-04-03 — Reconciliation at BPR close

- **Table:** `label_reconciliations` (bprId FK, issued, applied, destroyed, returned, variance, toleranceExceeded, signatureId).
- **Invariant:** `issued - applied - destroyed - returned = variance`. If `|variance| > tolerance` (from SOP-PR-012 configurable in `app_settings`), `toleranceExceeded = true`.
- **Business rule:** BPR cannot transition `IN_PROGRESS → COMPLETE` without a reconciliation row. A `toleranceExceeded=true` reconciliation requires a deviation + QA disposition to close the BPR.
- **UI:** Reconciliation form at BPR close; red banner on out-of-tolerance.
- **Validation:** URS-R-04-03-01.

#### R-04-04 — Thermal printer integration

- Out of scope for spec — wraps existing printer path. Ticket's deliverable is: lot+expiry now written by the ERP into the print payload; printed proof scanned back or photographed and attached to `label_reconciliations.proofUrl`.

#### R-04-05 — Module IQ/OQ/PQ (VSR-R-04).

---

### 5.5 R-05 — Complaints / SAER (Obs 7, 8)

#### R-05-01 — Complaint intake

- **Tables:** `complaints` (source GORGIAS|MANUAL, sourceRef, customerEmail, customerName, intakeAt, assignedUserId, status INTAKE/TRIAGING/UNDER_REVIEW/CLOSED, lotId FK nullable, orderRef nullable), `complaint_reviews` (complaintId FK, reviewedByUserId, reviewedAt, decision, signatureId, commentary), `complaint_events` (ts, actorUserId, note).
- **Gorgias webhook:** `POST /api/webhooks/gorgias` — signature-verified; trigger words (`side effect`, `reaction`, `ER`, `hospital`, `allergic`, `severe`, `rash`, `vomit`, etc.) auto-create an `INTAKE` complaint. Keywords configurable in `app_settings`.
- **Business rule:** Complaint cannot close without a review (F-04 signature, `COMPLAINT_REVIEW`).
- **UI:** `/quality/complaints` list + detail. QA triages into AE vs non-AE.
- **Validation:** URS-R-05-01-01.

#### R-05-02 — Adverse event path + 15-day SAER clock

- **Tables:** `adverse_events` (complaintId FK, serious: boolean, seriousCriteria: jsonb, clockStartedAt, dueAt = clockStartedAt + 15 BUSINESS days, status OPEN/SUBMITTED/CLOSED).
- **Rule:** `serious=true` starts the SAER clock. Business-days calendar stored (US federal holidays + weekends). Daily job emits warnings at T-5d, T-2d, T-0.
- **UI:** AE badge on complaint; dashboard tile "SAER due in ≤2 business days."
- **Validation:** URS-R-05-02-01.

#### R-05-03 — MedWatch 3500A draft

- **Table:** `saer_submissions` (adverseEventId FK, draftJson, submittedAt, submittedBySignatureId, acknowledgmentRef).
- **Scope:** Form renders from complaint + AE + lot/batch data; outputs a 3500A-formatted PDF; operator reviews and submits via MedWatch portal; operator records the acknowledgement ref + attaches the submission receipt.
- **Tests:** Draft generation is deterministic; submission requires QA signature (`SAER_SUBMIT`).
- **Validation:** URS-R-05-03-01.

#### R-05-04 — Shopify → lot traceback

- **Scope:** Cloudflare Worker (or equivalent) on Shopify fulfilment webhook captures the fulfilled inventory lot code and writes it to the Shopify order + Klaviyo event properties. New endpoint `/api/lookup/order/:ref` resolves a Shopify order to lot(s).
- **Business rule:** Complaint intake requires a lot reference before close; intake allows `unknown` during triage, but QA cannot close without lot.
- **Tests:** Stubbed Shopify webhook flow end-to-end.
- **Validation:** URS-R-05-04-01.

#### R-05-05 — Module IQ/OQ/PQ (VSR-R-05).

---

### 5.6 R-06 — Returned product (Obs 12)

#### R-06-01 — Returns intake

- **Table:** `returns` (shopifyOrderRef, lotId FK, receivedAt, receivedByUserId, condition text, quarantineLocationId FK, status INTAKE/TRIAGE/DISPOSITIONED).
- **Business rule:** All returns default to quarantine location (`locations.status=QUARANTINE`). Cannot re-stock without disposition.
- **Validation:** URS-R-06-01-01.

#### R-06-02 — Disposition workflow

- **Table:** `return_dispositions` (returnId FK, decision DESTROY|SALVAGE_WITH_RETEST|REPROCESS|INVESTIGATE, signatureId, commentary, actionedAt).
- **Business rule:** `SALVAGE_WITH_RETEST` requires a linked COA pass; `REPROCESS` opens a new BPR; `INVESTIGATE` opens a nonconformance (R2) or Phase-1 stub `return_investigations` row. Signature meaning `RETURN_DISPOSITION`.
- **Validation:** URS-R-06-02-01.

#### R-06-03 — Returns-per-lot threshold trigger

- **Rule:** `return_count(lotId, window=90d) ≥ threshold` (configurable per product) automatically opens a `return_investigations` row and flags the lot `ON_HOLD`.
- **Tests:** Threshold trip opens investigation + transitions lot to ON_HOLD.
- **Validation:** URS-R-06-03-01.

#### R-06-04 — Module IQ/OQ/PQ (VSR-R-06).

---

## 6. Phase 2 — MMR + BPR + FG-QC (outline only; full spec in a follow-up)

Reserved IDs: `R-07` (MMR), `R-08` (BPR hardening), `R-09` (Finished-goods QC + Shopify release gate). Not expanded in this spec because Phase 1 has not begun. Full tickets will be written after VSR-R-01 is signed, informed by lessons from Phase 1.

Baseline requirements locked here:
- MMR edits forbidden after approval; new version required. `productionBatches.mmrVersionId` is a snapshot FK.
- BPR cannot start if equipment calibration overdue (R-03-02), cleaning log absent (R-03-03), or line clearance missing on changeover (R-03-04).
- FG-QC gate blocks Shopify availability; on HOLD, finished SKU goes unlisted.

---

## 7. Release 2 — deferred scope (placeholder)

Not expanded in this spec. Tickets will follow the same shape:
- `R2-01` Stability (§111.210(f))
- `R2-02` Environmental monitoring (§111.15)
- `R2-03` CAPA / QMS (§111.140)
- `R2-04` Training gate (§111.12–14) — regulated action requires non-expired training; integrates with every module.
- `R2-05` QBO integration
- `R2-06` Extensiv two-way sync
- `R2-07` Lab COA automated pickup

---

## 8. Observation → Ticket traceability matrix

| 483 Obs | Citation | Phase 0 / Cross | Phase 1 tickets | Phase 2 tickets | Release 2 |
|---|---|---|---|---|---|
| 1. Component specs | §111.70(b), §111.75 | F-04, F-05 | R-01-03, R-02-01 | — | R2-03 (OOS → CAPA) |
| 2. Master Manufacturing Records | §111.205, §111.210 | F-04, F-05 | — | R-07 (MMR) | — |
| 3. Batch Production Records | §111.255, §111.260 | F-04, F-05, F-06 | R-03-01/02/03/04 | R-08 (BPR hardening) | — |
| 4. QC review of COAs / OOS | §111.75, §111.103 | F-04, F-06 | R-01-02, R-01-06, R-01-07, R-02-01 | R-07/R-08 | R2-03 |
| 5. QC release gate | §111.123(a)(4) | F-04, F-05 | — | R-09 (FG-QC) | — |
| 6. Disqualified lab / invalid methods | §111.75(h)(1) | F-04 | R-01-02, R-02-02 | — | — |
| 7. Complaints + AE/SAE | §111.553, §111.560, 21 USC 379aa-1 | F-04 | R-05-01/02/03 | — | R2-03 |
| 8. Lot number on complaint | §111.570 | — | R-05-04 | — | — |
| 9. Label reconciliation | §111.415(f) | F-04, F-05 | R-04-01/02/03/04 | — | — |
| 10. Labeling/packaging SOPs | §111.415 | — | R-04 (ERP side); QMS work | — | — |
| 11. Sampling plan | §111.80 | — | R-01-05 | — | — |
| 12. Returned product | §111.503, §111.510 | F-04, F-05 | R-06 | — | — |
| 13. Approved food-grade materials | §111.20(b)(1) | — | R-01-01 | — | — |
| Cross: Auth + Part 11 | 21 CFR Part 11 | F-01..F-10 | applies everywhere | applies everywhere | applies everywhere |
| Cross: Training gate | §111.12–14 | — | — | — | R2-04 |
| Cross: Audit trail | §111.180 | F-03 | — | — | — |

---

## 9. Definition of "Release 1 ready"

All of the following are true:

1. VSR-PLATFORM (F-10) signed by Carrie Treat.
2. VSR-R-01 through VSR-R-06 signed by Carrie Treat.
3. Paper-parallel cycle completed for each module (one full operating cycle, with the audit trail review clean).
4. Training records exist for every user performing a regulated action in any of the six modules.
5. Restore-check (F-08) clean for the most recent month.
6. External Part 11 / GAMP 5 review (budgeted in roadmap §7) complete, with any findings closed or risk-accepted by Carrie Treat and Frederik.

When all six are true, Release 1 replaces paper for the six modules as the legal record; paper is retained per §111.605. Release 2 begins.

---

## 10. Open items parked for later

These were flagged during spec writing and need a decision before the relevant ticket starts:

- **Email provider for user creation / lockout notifications.** Needed by F-01. Candidates: SES, Postmark, Resend. Default: Resend (simplest).
- **Object storage for COAs and proofs.** Needed by R-01-06, R-04-03. Candidates: S3, R2, Railway volume. Default: Cloudflare R2.
- **Holiday calendar source for SAER business days.** Needed by R-05-02. Default: hard-code US federal holidays + update annually.
- **Thermal printer control path.** Needed by R-04-04. Depends on existing printer (model/driver). Needs a 30-minute discovery ticket before R-04-04.
- **Cloudflare Worker hosting for Shopify traceback.** Needed by R-05-04. Account + deploy path.

None of these block Phase 0.

---

**End of build spec.**
