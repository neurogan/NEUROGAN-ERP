# T-01: RECEIVING → WAREHOUSE Role Rename

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `RECEIVING` role to `WAREHOUSE` everywhere — schema, migration, routes, state machine, storage, seed fixtures, tests, and UI — so that the role name reflects the full warehouse workflow (receiving, picking, packing, shipping).

**Architecture:** `userRoles` stores role as plain TEXT (`text("role").$type<UserRole>()`), no Postgres enum constraint. The rename is a data migration plus a string-replace across the codebase. No structural schema changes needed.

**Tech Stack:** Drizzle ORM + PostgreSQL, TypeScript, Vitest.

---

### Task 0: Migration + shared/schema.ts

**Goal:** Update the DB data and the canonical role enum so the rest of the codebase has a single source of truth to reference.

**Files:**
- Create: `migrations/0008_t01_warehouse_role_rename.sql`
- Modify: `shared/schema.ts`

**Acceptance Criteria:**
- [ ] Migration renames all `RECEIVING` rows to `WAREHOUSE` in `erp_user_roles`
- [ ] `userRoleEnum` in `shared/schema.ts` has `"WAREHOUSE"` instead of `"RECEIVING"`
- [ ] `pnpm migrate:up && pnpm typecheck` passes with 0 errors

**Verify:** `pnpm migrate:up && pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Write the migration**

Create `migrations/0008_t01_warehouse_role_rename.sql`:

```sql
-- T-01: Rename RECEIVING role to WAREHOUSE
-- Role is stored as plain TEXT; no Postgres enum to ALTER.
UPDATE erp_user_roles SET role = 'WAREHOUSE' WHERE role = 'RECEIVING';
```

- [ ] **Step 2: Update userRoleEnum in shared/schema.ts**

Line 33 — change:
```ts
export const userRoleEnum = z.enum(["ADMIN", "QA", "PRODUCTION", "RECEIVING", "VIEWER"]);
```
to:
```ts
export const userRoleEnum = z.enum(["ADMIN", "QA", "PRODUCTION", "WAREHOUSE", "VIEWER"]);
```

- [ ] **Step 3: Run migration + typecheck**

```bash
pnpm migrate:up && pnpm typecheck
```

Expected: migration runs, 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add migrations/0008_t01_warehouse_role_rename.sql shared/schema.ts
git commit -m "feat(t-01): add WAREHOUSE role migration and update userRoleEnum"
```

---

### Task 1: Server — state machine, storage, routes

**Goal:** Replace all `"RECEIVING"` string literals in server code with `"WAREHOUSE"`.

**Files:**
- Modify: `server/state/transitions.ts`
- Modify: `server/db-storage.ts`
- Modify: `server/routes.ts`

**Acceptance Criteria:**
- [ ] `grep -r '"RECEIVING"' server/` returns 0 matches (string literals only, not comments describing the page)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes

**Verify:** `grep -rn '"RECEIVING"' server/` → no output

**Steps:**

- [ ] **Step 1: Update server/state/transitions.ts**

Lines 27–29 — change all three `"RECEIVING"` entries in `requiredRoles` to `"WAREHOUSE"`:

```ts
  { from: "QUARANTINED",  to: "SAMPLING",    action: "BEGIN_SAMPLING",      requiredRoles: ["QA", "WAREHOUSE"] },
  { from: "QUARANTINED",  to: "PENDING_QC",  action: "SKIP_TO_PENDING_QC",  requiredRoles: ["QA", "WAREHOUSE", "ADMIN"] },
  { from: "SAMPLING",     to: "PENDING_QC",  action: "SAMPLING_COMPLETE",   requiredRoles: ["QA", "WAREHOUSE"] },
```

- [ ] **Step 2: Update server/db-storage.ts**

Line 2344 — change:
```ts
const isReceiving = roles.includes("RECEIVING") || roles.includes("ADMIN");
```
to:
```ts
const isReceiving = roles.includes("WAREHOUSE") || roles.includes("ADMIN");
```

Also update the comments on lines 2340–2341 to say `WAREHOUSE` instead of `RECEIVING`.

- [ ] **Step 3: Update server/routes.ts**

Use replace-all for `requireRole("RECEIVING"` → `requireRole("WAREHOUSE"` and `"RECEIVING"` → `"WAREHOUSE"` in all `requireRole(...)` calls. Affected lines: 354, 367, 443, 457, 503, 511, 558, 570, 578, 586, 596, 976, 1042, 1055, 1105, 1152. Every occurrence is inside a `requireRole(...)` argument — replace the string literal only.

- [ ] **Step 4: Typecheck + test**

```bash
pnpm typecheck && pnpm test
```

Expected: 0 type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/state/transitions.ts server/db-storage.ts server/routes.ts
git commit -m "feat(t-01): rename RECEIVING→WAREHOUSE in state machine, storage, routes"
```

---

### Task 2: Seed fixtures + tests

**Goal:** Replace `"RECEIVING"` in all test seed files and test files.

**Files:**
- Modify: `server/seed/test/fixtures/users.ts`
- Modify: `server/__tests__/r01-workflow-type.test.ts`
- Modify: `server/__tests__/r01-tasks.test.ts`

**Acceptance Criteria:**
- [ ] `grep -rn '"RECEIVING"' server/seed server/__tests__` returns 0 matches
- [ ] `pnpm test` passes

**Verify:** `pnpm test` → all tests pass

**Steps:**

- [ ] **Step 1: Update server/seed/test/fixtures/users.ts**

Line 43 — change:
```ts
{ userId: seedIds.users.recv, role: "RECEIVING", grantedByUserId: seedIds.users.admin },
```
to:
```ts
{ userId: seedIds.users.recv, role: "WAREHOUSE", grantedByUserId: seedIds.users.admin },
```

- [ ] **Step 2: Update server/__tests__/r01-workflow-type.test.ts**

Line 63 — change `["RECEIVING"]` to `["WAREHOUSE"]`:
```ts
const recv = await seedUser("recv@workflow.test", ["WAREHOUSE"], adminId);
```

- [ ] **Step 3: Update server/__tests__/r01-tasks.test.ts**

Line 61 — change `roles: ["RECEIVING"]` to `roles: ["WAREHOUSE"]`:
```ts
const recv = await storage.createUser({ email: "recv@tasks.test", fullName: "Warehouse User", title: null, passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["WAREHOUSE"], createdByUserId: adminId, grantedByUserId: adminId });
```

Line 85 — update test description:
```ts
it("WAREHOUSE user sees IDENTITY_CHECK tasks", async () => {
```

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/seed/test/fixtures/users.ts server/__tests__/r01-workflow-type.test.ts server/__tests__/r01-tasks.test.ts
git commit -m "feat(t-01): rename RECEIVING→WAREHOUSE in seed fixtures and tests"
```

---

### Task 3: UI — settings-users role list

**Goal:** Update the frontend role display so the Settings → Users page shows "Warehouse" instead of "Receiving".

**Files:**
- Modify: `client/src/pages/settings-users.tsx`

**Acceptance Criteria:**
- [ ] `ALL_ROLES` array uses `"WAREHOUSE"` not `"RECEIVING"`
- [ ] Role label displayed in UI reads "Warehouse" (check if there's a label map; if not, the raw value is already correct)
- [ ] `grep -n '"RECEIVING"' client/` returns 0 matches
- [ ] `pnpm typecheck` passes

**Verify:** `grep -rn '"RECEIVING"' client/` → no output; `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Update settings-users.tsx**

Line 58 — change:
```ts
const ALL_ROLES = ["ADMIN", "QA", "PRODUCTION", "RECEIVING", "VIEWER"] as const;
```
to:
```ts
const ALL_ROLES = ["ADMIN", "QA", "PRODUCTION", "WAREHOUSE", "VIEWER"] as const;
```

Check if the file has a role→label display map (e.g. `RECEIVING: "Receiving"`). If it does, update the key and value. If the raw value is rendered directly, the label will automatically become "WAREHOUSE" — which is acceptable for now.

- [ ] **Step 2: Grep client for any remaining RECEIVING literals**

```bash
grep -rn '"RECEIVING"' client/
```

Fix any found.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Final whole-repo grep**

```bash
grep -rn '"RECEIVING"' --include="*.ts" --include="*.tsx" --include="*.sql" .
```

Expected: 0 matches (comments and page titles that say "Receiving" as a route/page name are fine — only the role string literal matters).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/settings-users.tsx
git commit -m "feat(t-01): rename RECEIVING→WAREHOUSE in UI role list"
```

```json:metadata
{"files": ["migrations/0008_t01_warehouse_role_rename.sql", "shared/schema.ts", "server/state/transitions.ts", "server/db-storage.ts", "server/routes.ts", "server/seed/test/fixtures/users.ts", "server/__tests__/r01-workflow-type.test.ts", "server/__tests__/r01-tasks.test.ts", "client/src/pages/settings-users.tsx"], "verifyCommand": "pnpm typecheck && pnpm test && grep -rn '\"RECEIVING\"' --include='*.ts' --include='*.tsx' --include='*.sql' .", "acceptanceCriteria": ["Migration renames RECEIVING→WAREHOUSE in erp_user_roles", "userRoleEnum uses WAREHOUSE", "No '\"RECEIVING\"' string literals remain in .ts/.tsx/.sql files", "pnpm typecheck passes", "pnpm test passes"]}
```
