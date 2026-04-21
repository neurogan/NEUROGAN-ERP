# AGENTS.md — working rules for Claude Code in NEUROGAN-ERP

This file lives at the repo root (`NEUROGAN-ERP/AGENTS.md`). It is read by Claude Code (and any other AI agent or human) before working in this repo. If you are an agent and you did not read this file, stop and read it.

The controlling specification is `neurogan-erp-build-spec.md` (lives in the `FDA/` response-package folder, delivered alongside this file). Everything here exists to make that spec easy to execute.

---

## 1. What this repo is

Neurogan's custom ERP/MRP for dietary-supplement manufacturing at 8821 Production Ave, San Diego. Target compliance: **21 CFR Part 111** (cGMP for dietary supplements) and **21 CFR Part 11** (electronic records and electronic signatures). We received an FDA Form 483 on 2026-04-17 with 13 observations; this ERP is one arm of the CAPA response.

**This repo holds regulated code.** That changes how you work in it:

- Every regulated write needs an authenticated identity, an audit-trail row, and (for state changes) an electronic signature.
- Once a record is APPROVED, RELEASED, or SUBMITTED, it is locked. No edits. New version required.
- Migrations do not run on boot. Schema drift is not acceptable.
- Tests aren't a nice-to-have. They *are* the OQ body of the validation package.

If a change feels like a shortcut, it is. Write the URS entry; ship the test; take the extra hour.

---

## 2. One-time setup (humans)

```bash
pnpm install
cp .env.example .env.local            # fill in DATABASE_URL, SESSION_SECRET, RESEND_API_KEY, R2_*
pnpm migrate:up
pnpm seed:test                         # loads deterministic fixture data
pnpm dev                               # app on :3000, vite on :5173
```

Required env (boot fails otherwise): `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV`, `APP_ORIGIN`.

Optional envs have documented defaults in `server/config.ts`.

---

## 3. Day-to-day scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Express + Vite dev servers |
| `pnpm build` | Type-check + bundle client + server |
| `pnpm start` | Run built server |
| `pnpm lint` | ESLint. `--max-warnings 0` in CI. |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm test:integration` | Supertest against disposable Postgres |
| `pnpm test:e2e` | Playwright critical flows |
| `pnpm seed:test` | Load deterministic fixtures. Idempotent. |
| `pnpm migrate:up` | Apply pending Drizzle migrations |
| `pnpm migrate:down` | Roll back last migration (local only; prod has change control) |
| `pnpm migrate:status` | Show applied/pending migrations |
| `pnpm restore:check` | Restore from latest Railway snapshot and smoke-test |

---

## 4. Agent working rules (Claude Code read this carefully)

### 4.1 Plan before you write

For any ticket from `neurogan-erp-build-spec.md`:
1. Read the ticket end to end.
2. Read the linked companions: the observation text in `Response Package - FDA Form 483.md`, the roadmap section, and any prior ticket marked as a precondition.
3. List the files you'll touch. Get confirmation if the list is surprising.
4. Only then start editing.

If the ticket doesn't match reality (e.g., a file has moved, a column is gone), **stop and ask**. Do not infer intent.

### 4.2 One ticket, one branch, one PR

- Branch: `ticket/<id>-<slug>` (e.g., `ticket/F-03-audit-trail`), created from the current tip of `FDA-EQMS-feature-package`.
- Commits are small and coherent. Prefer a few labelled commits over one dump.
- PR opens against `FDA-EQMS-feature-package` (the integration branch for this build), **not** `main`. No stacked branches. If a ticket depends on another, wait for the parent to merge. See §6 for the full branch model.

### 4.3 Regulated-code Definition of Done

Copy this checklist into every PR description. All boxes must be checked.

- [ ] Authentication required on every new regulated endpoint (401 on unauth)
- [ ] Role-gated (403 on wrong role)
- [ ] All regulated writes produce an `audit_trail` row (before/after, user, route, request id)
- [ ] State transitions go through the storage-layer transition guard; raw SQL transitions impossible
- [ ] Signing actions require the signature ceremony (password re-entry + meaning code)
- [ ] Identity fields on regulated endpoints derived only from `req.user.id`, never the body
- [ ] Zod schemas in `shared/`, re-used by the client
- [ ] Integration tests: happy, 401, 403, 409, 422, audit-row side-effect
- [ ] State-machine unit tests cover every legal and illegal transition
- [ ] Drizzle migration committed; up + down tested locally; no data deletion
- [ ] No `any` types; ESLint clean; typecheck clean
- [ ] URS / FRS / DS entries for the ticket appended to `validation-scaffold.md`
- [ ] OQ test case(s) referenced in the traceability matrix
- [ ] PR lists which 483 observation(s) the ticket closes or partially closes
- [ ] PR lists the remaining exit gates for the module this ticket is in

### 4.4 Things that are not allowed

- Accepting identity from the request body on a regulated endpoint.
- Mutating an APPROVED / RELEASED / SUBMITTED record. Make a new version.
- Bypassing the state-transition guard with a raw SQL update.
- Writing your own password hashing. Use `argon2`.
- Treating the session cookie as a signature. Signatures require password re-entry and a meaning code.
- Skipping an audit-trail row on a regulated write.
- Adding a free-text "reviewedBy" / "performedBy" / "verifiedBy" field to a new schema. Use a user FK + a signature FK.
- Running migrations on boot. Migrations are a CI/deploy step.
- Introducing `any`. If a type isn't known, model it.
- Deleting data in a migration. Preserve prior data (new column, new table, retained backup).
- Merging without a passing CI run.
- Rebasing or force-pushing a branch after review has started.

### 4.5 Things that are encouraged

- Writing the test *first* when the change is a behaviour change.
- Asking for the ticket to be split if it's growing past ~400 lines of diff.
- Noting "parked" items in the PR description (things you discovered but did not fix) so they don't get lost.
- Leaving code comments that cite the CFR. `// §111.123(a)(4): release gate` is more useful than you think, for auditors.

---

## 5. Code conventions

### 5.1 TypeScript

- `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`.
- No default exports. Named exports only (except React components at the file level).
- Prefer `type` for unions / primitives, `interface` for object shapes.
- No implicit `any`, no `@ts-ignore`. `@ts-expect-error` allowed temporarily with a comment that cites the ticket.

### 5.2 Drizzle & schema

- All tables declared in `shared/schema.ts` (no table modules scattered elsewhere).
- Tables prefixed `erp_`. Columns snake_case. Enums are `text` with a Zod union, not Postgres enums (easier to evolve).
- Every table has `id`, `created_at`, `created_by_user_id` (for regulated tables) or equivalent.
- Indices declared alongside the table, not in migrations.
- Migrations generated by `pnpm drizzle-kit generate`, then hand-reviewed. No blind acceptance of generated SQL.
- `drizzle-zod` generates `insert` / `select` schemas; regulated tables override to reject unsafe columns.

### 5.3 Storage layer

- Business rules live in `server/db-storage.ts` (or module-specific files under `server/storage/`), not in route handlers.
- All regulated writes go through `withAudit(...)` and, for state changes, `transition(...)`.
- No direct `db.update(...)` / `db.delete(...)` on regulated tables from anywhere other than the storage layer. Enforced by an ESLint rule.

### 5.4 API / routes

- Route handlers are thin: parse → authorize → delegate to storage → format response.
- Every request body runs through a Zod parse; typed handler from parse output.
- Error responses: `{ error: { code, message, details? } }` with codes from `server/errors.ts`.
- Every route handler wrapped by `asyncHandler` so thrown errors route to the error middleware with a request id.

### 5.5 Client

- React 18 + Vite, `wouter` router, TanStack Query for server state.
- UI primitives from shadcn/ui; Tailwind only.
- Form validation uses the Zod schemas exported from `shared/`.
- No local duplication of types the server also uses.
- `useAuth()` hook gates pages; pages call `useRoles(["QA","ADMIN"])` if role-gated.

### 5.6 Tests

- Unit tests colocated (`foo.ts` + `foo.test.ts`). Unit = pure functions.
- Integration tests under `server/__tests__/`. Disposable Postgres per run. Transaction-per-test wrapper.
- E2E under `e2e/` (Playwright). Critical flows only: login, QC disposition ceremony, record-lock attempt, audit export.
- Every regulated endpoint has the 6-case suite: happy, 401, 403, 409, 422, audit-row assertion.
- Snapshot tests are fine for response shapes; updating a snapshot requires a brief "why" in the PR.

### 5.7 Logging & errors

- Structured logs (`pino` preferred). Every log line has `requestId` and `userId` when authenticated.
- Never log passwords, full session tokens, PII beyond email, or COA contents.
- Error middleware catches thrown errors, emits a structured response, logs server-side with stack.

---

## 6. Branching, reviews, releases

### 6.1 Branch model (integration train for the FDA/EQMS build)

During the FDA/EQMS feature build, work flows through a long-lived integration branch `FDA-EQMS-feature-package`:

1. **Tickets.** Every ticket from `neurogan-erp-build-spec.md` gets its own branch `ticket/<id>-<slug>` (e.g. `ticket/F-03-audit-trail`), created from the current tip of `FDA-EQMS-feature-package`.
2. **Ticket PRs target `FDA-EQMS-feature-package`,** not `main`.
3. **Module PRs to `main`.** Once every ticket in a module (e.g. R-01) is merged into `FDA-EQMS-feature-package` **and** the module's VSR (`VSR-R-0x`) is signed by Carrie Treat, a PR from `FDA-EQMS-feature-package` to `main` carries that module across. Merges into `main` happen **one module at a time**, never as a single big-bang merge.
4. **Weekly back-merge `main` → `FDA-EQMS-feature-package`** to keep the integration branch in sync with any hotfixes that land directly on `main`.
5. **Release = tag `rel-v1.x.y` on `main`** immediately after each module merge. IQ log for the release includes image digest + migration SHA.

### 6.2 Environments

- `FDA-EQMS-feature-package` auto-deploys to **Railway staging**. Carrie exercises the signature ceremony here against seeded-but-staging data as part of OQ/PQ.
- `main` auto-deploys to **Railway production**. This is the signed, validated record of truth.
- Ticket branches do **not** auto-deploy. Preview deploys are not used during this build.

### 6.3 Reviews — solo-developer control model

Current staffing for this build is a single developer (Frederik). The classic "two reviewers for regulated paths" rule assumes a multi-person team and is not operable today. The regulated-software controls that replace peer review are:

- **CI gatekeeping.** Every PR to `FDA-EQMS-feature-package` or `main` must have a green CI run: `pnpm lint --max-warnings 0`, `pnpm typecheck` (tsc --noEmit), `pnpm test` (unit), `pnpm test:integration` (including the 6-case suite — happy / 401 / 403 / 409 / 422 / audit-row assertion — for every regulated endpoint). Branch protection blocks merges with red CI.
- **Signature ceremony as separation-of-duties.** Regulated record state changes (APPROVE, RELEASE, SUBMIT) do not become law when a developer merges a PR. They become law when a QA-role user (Carrie Treat) completes the ceremony defined in F-04: password re-entry, meaning code, manifestation-of-identity row. The developer cannot sign a record they produced — the ceremony requires the QA role, which the developer account does not hold. This is the 21 CFR Part 11 separation-of-duties control. Peer PR approval is not.
- **CODEOWNERS** remains in place for `shared/schema.ts`, `server/db-storage.ts`, `server/auth/*`, `server/audit/*`, `server/state/*`. It surfaces review-worthy PRs but does not block self-merge in a solo-dev setup (`require_code_owner_reviews: false` on branch protection).

When a second developer joins, branch protection on `main` and `FDA-EQMS-feature-package` tightens: `required_approving_review_count` becomes `1` (or `2` for regulated paths), `require_code_owner_reviews` flips to `true`. Until then, CI + the signature ceremony are the gates.

### 6.4 Merge hygiene

- **Squash-merge** on ticket → `FDA-EQMS-feature-package`. First line of the PR description becomes the squash commit body so that the squashed commit captures the full rationale.
- **Merge commit (no squash)** on `FDA-EQMS-feature-package` → `main` at module completion. The module merge is a material event; preserving the full sequence of ticket commits in `main`'s history makes the traceability matrix self-evidencing for the FDA.
- **Conventional-commit style subject** on all PR titles. Example: `feat(audit): durable audit_trail table with before/after JSON (F-03)`.
- **No rebasing or force-pushing** a branch after a reviewer (human or automation) has started reading it. Branch protection blocks force-push to `main` and `FDA-EQMS-feature-package` regardless.

### 6.5 Frozen legacy branches

`dev`, `eQMS-Layer`, and `claude/create-eqms-layer-QbOLi` contain the Perplexity-built prototype that preceded this build. They are explicitly not Part 11 compliant (see the "Part 11 TODO" banners left in the code by the prior developer) and are retained **only** as historical reference for the validation audit trail. They have branch protection (PR required, no direct pushes, no force-push, no deletion) and must not receive new work.

---

## 7. Environment & secrets

- `.env.local` for development; never committed.
- Railway project variables for staging/prod. Rotated quarterly.
- `SESSION_SECRET` at least 64 hex chars. Rotating it invalidates all sessions — do it deliberately.
- No secret ever printed in logs or surfaced via an endpoint. Add an ESLint rule to catch `process.env` reads outside `server/config.ts`.

---

## 8. Validation & FDA paperwork this repo is part of

Every PR contributes to the validation package. The scaffold lives in `validation-scaffold.md` (in the FDA/ folder). When your ticket adds a URS line, the PR adds the corresponding FRS, DS, and OQ entries in the same PR. Traceability must hold.

**Platform validation summary report (VSR-PLATFORM)** is signed by Carrie Treat (QC / PCQI) after Phase 0 completes. No Phase 1 module begins until that signature exists.

**Module VSRs (VSR-R-01 .. VSR-R-06)** are signed by Carrie Treat after each module's IQ/OQ/PQ. No module becomes the legal record until its VSR is signed **and** paper-parallel has run a full cycle.

This is not optional ceremony. It is how the FDA evaluates custom software under GAMP 5 Category 5.

---

## 9. PR description template

Paste into every PR:

```markdown
## Ticket
<F-## or R-##-##> — <one-line summary>

## 483 observation(s) addressed
- Obs <n> (§<cfr>): <how this ticket advances closure>

## Scope of this PR
<what changed — 5-8 lines>

## Regulated-code Definition of Done
- [ ] Authentication required on every new regulated endpoint (401 on unauth)
- [ ] Role-gated (403 on wrong role)
- [ ] All regulated writes produce an audit_trail row
- [ ] State transitions via storage-layer guard
- [ ] Signing via signature ceremony (password + meaning + manifestation)
- [ ] No request-body identity on regulated endpoints
- [ ] Zod schemas in shared/
- [ ] Integration tests: happy, 401, 403, 409, 422, audit-row side-effect
- [ ] State-machine unit tests for all legal + illegal edges
- [ ] Drizzle migration committed; up + down tested; no data loss
- [ ] No `any`; ESLint + typecheck clean
- [ ] URS / FRS / DS / OQ entries appended to validation-scaffold.md
- [ ] PR lists remaining exit gates for the module

## Tests
<summary of what was added; why they're sufficient>

## Screenshots
<if UI changed>

## Remaining exit gates for this module
<bullet list; helps the next ticket pick up>

## Parked items
<things discovered but not fixed; create followups>
```

---

## 10. The presentation-only PR lane

The full regulated-code DoD in §4.3 is correct for any ticket that touches schema, storage, a regulated endpoint, or a state machine. A copy tweak, a button restyle, or a layout adjustment does not need "state-machine unit tests for all legal and illegal edges."

**Presentation-only PRs** are PRs whose diff touches **none** of:
- route handlers (`server/routes.ts`, future `server/routes/**`)
- schema (`shared/schema.ts` or generated migration files)
- storage layer (`server/db-storage.ts`, future `server/storage/**`)
- state machines (`server/state/**`)
- middleware (`server/auth/**`, `server/audit/**`, anything mounted in `server/index.ts`)
- migrations (`drizzle/**`, migration runner)

### 10.1 What a presentation-only PR may skip

- state-machine unit tests
- integration-test 401 / 403 / 409 / 422 / audit-row suite
- migration review
- validation-scaffold entries (no URS / FRS / DS / OQ update required)

### 10.2 What a presentation-only PR must still include

- ESLint clean, `--max-warnings 0`
- `tsc --noEmit` clean
- no `any` introduced
- all existing tests still passing on CI
- screenshots for any visible UI change
- a PR description that states **explicitly** "no regulated paths touched" and lists every file changed

### 10.3 The CODEOWNERS kill-switch

**If any file in the diff is covered by `CODEOWNERS`, the PR is not presentation-only.** Full regulated-code DoD applies, regardless of how the author framed the PR. `CODEOWNERS` is the authoritative list of regulated paths — human judgement does not override it.

When in doubt, default back to the full DoD. The cost of over-documenting is trivial; the cost of sneaking a regulated change through the presentation lane is a Part 11 finding.

---

**End of AGENTS.md.**
