# T-09 Email Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temp-password-in-dialog workflow with an email invite flow using Resend — admins create users, the system emails a signed link, the user clicks it to set their own password.

**Architecture:** New `PENDING_INVITE` user status + `invite_token_hash`/`invite_token_expires_at` DB columns. Raw token travels in the invite URL (hash fragment); argon2id hash stored in DB; cleared on redemption. `POST /api/auth/accept-invite` validates and activates the account. Client `/set-password` page is public (outside AuthGate).

**Tech Stack:** Resend SDK (`resend` npm package), existing argon2id hashing (`server/auth/password.ts`), Drizzle ORM, wouter hash routing.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `migrations/0022_t09_email_invite.sql` | Create | Add invite_token_hash + invite_token_expires_at to erp_users |
| `migrations/meta/_journal.json` | Modify | Register migration 0022 |
| `shared/schema.ts` | Modify | Add PENDING_INVITE to userStatusEnum; add invite columns to users table; add INVITE_ACCEPTED + INVITE_RESENT to auditActionEnum |
| `server/auth/password.ts` | Modify | Add generateInviteToken() |
| `server/email/resend.ts` | Create | sendInviteEmail(to, rawToken) — Resend API wrapper |
| `server/storage.ts` | Modify | Extend CreateUserInput; add acceptInvite + renewInviteToken to IStorage |
| `server/db-storage.ts` | Modify | Implement new storage methods; update createUser to accept status + invite columns |
| `server/auth/auth-routes.ts` | Modify | Add POST /accept-invite; block PENDING_INVITE at login |
| `server/routes.ts` | Modify | Rewrite POST /api/users (invite instead of temp password); add POST /api/users/:id/resend-invite |
| `server/__tests__/users.test.ts` | Modify | Update assertions: status=PENDING_INVITE, no temporaryPassword |
| `server/__tests__/t09-invite.test.ts` | Create | Integration tests for invite lifecycle |
| `client/src/pages/set-password.tsx` | Create | Public page — validates token, sets password, then logs in |
| `client/src/App.tsx` | Modify | Add /set-password as a public route (outside AuthGate) |
| `client/src/pages/settings-users.tsx` | Modify | Remove temp-password dialog; add PENDING badge; add Resend invite button |

---

### Task 0: DB migration + schema types

**Goal:** Add invite columns to erp_users and update Drizzle schema + Zod enums so the server can store and type invite state.

**Files:**
- Create: `migrations/0022_t09_email_invite.sql`
- Modify: `migrations/meta/_journal.json`
- Modify: `shared/schema.ts` (lines 37–38 for userStatusEnum; line 826 for users table; line 899–952 for auditActionEnum)

**Acceptance Criteria:**
- [ ] `npx tsc --noEmit` passes with no errors
- [ ] `userStatusEnum` includes `"PENDING_INVITE"`
- [ ] `users` Drizzle table has `inviteTokenHash` and `inviteTokenExpiresAt` fields
- [ ] `auditActionEnum` includes `"INVITE_ACCEPTED"` and `"INVITE_RESENT"`

**Verify:** `npx tsc --noEmit` → no output (clean)

**Steps:**

- [ ] **Step 1: Create migration SQL**

Create `migrations/0022_t09_email_invite.sql`:

```sql
ALTER TABLE erp_users
  ADD COLUMN invite_token_hash       TEXT,
  ADD COLUMN invite_token_expires_at TIMESTAMPTZ;
```

- [ ] **Step 2: Add journal entry**

In `migrations/meta/_journal.json`, append to the `"entries"` array (after the idx 21 entry):

```json
    ,{
      "idx": 22,
      "version": "7",
      "when": 1777420800000,
      "tag": "0022_t09_email_invite",
      "breakpoints": true
    }
```

- [ ] **Step 3: Extend userStatusEnum in shared/schema.ts**

Current (line 37):
```typescript
export const userStatusEnum = z.enum(["ACTIVE", "DISABLED"]);
```

Replace with:
```typescript
export const userStatusEnum = z.enum(["ACTIVE", "DISABLED", "PENDING_INVITE"]);
```

- [ ] **Step 4: Add invite columns to users Drizzle table**

The `users` table currently ends with `createdByUserId`. Add two nullable columns after it:

```typescript
export const users = pgTable("erp_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  title: text("title"),
  passwordHash: text("password_hash").notNull(),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  status: text("status").$type<UserStatus>().notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  inviteTokenHash: text("invite_token_hash"),
  inviteTokenExpiresAt: timestamp("invite_token_expires_at", { withTimezone: true }),
});
```

- [ ] **Step 5: Add INVITE_ACCEPTED and INVITE_RESENT to auditActionEnum**

Find the `auditActionEnum` in `shared/schema.ts` (around line 899). Add the two new actions before the closing `]);`:

```typescript
  "RETURN_INVESTIGATION_CLOSED",
  "INVITE_ACCEPTED",
  "INVITE_RESENT",
]);
```

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no output (clean exit).

- [ ] **Step 7: Commit**

```bash
git add migrations/0022_t09_email_invite.sql migrations/meta/_journal.json shared/schema.ts
git commit -m "feat(t09): add invite_token columns + PENDING_INVITE status + audit actions"
```

---

### Task 1: Token generator + Resend email module

**Goal:** Add `generateInviteToken()` to the existing password module and create a thin Resend wrapper that sends the invite email.

**Files:**
- Modify: `server/auth/password.ts`
- Create: `server/email/resend.ts`
- Modify: `package.json` (add `resend` dependency)

**Acceptance Criteria:**
- [ ] `generateInviteToken()` returns a 64-character hex string
- [ ] `sendInviteEmail` constructs a URL with `?token=` and `?email=` in the hash fragment
- [ ] `sendInviteEmail` throws if `RESEND_API_KEY` is unset
- [ ] `npx tsc --noEmit` passes

**Verify:** `npx tsc --noEmit` → no output

**Steps:**

- [ ] **Step 1: Install resend**

```bash
npm install resend
```

Expected: `package.json` now lists `"resend": "^..."` in dependencies.

- [ ] **Step 2: Add generateInviteToken to password.ts**

In `server/auth/password.ts`, the file already imports `randomBytes` from `crypto`. Add `generateInviteToken` after `generateTemporaryPassword`:

```typescript
// Generate a cryptographically random invite token. 32 bytes → 64 hex chars.
// Never stored plain — callers hash it with hashPassword before persisting.
export function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}
```

- [ ] **Step 3: Create server/email/resend.ts**

```typescript
import { Resend } from "resend";

// Send the first-login invite email. Reads env vars at call time so that:
//   - Tests can mock this module without needing the env vars
//   - Missing vars surface as clear errors rather than silent undefined
//
// URL format: ${APP_URL}/#/set-password?token=<raw>&email=<encoded>
// The hash fragment is required by the app's wouter hash-based router.
export async function sendInviteEmail(to: string, rawToken: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "noreply@neurogan.com";
  const appUrl = (process.env.APP_URL ?? "http://localhost:5000").replace(/\/$/, "");

  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  const inviteUrl = `${appUrl}/#/set-password?token=${rawToken}&email=${encodeURIComponent(to)}`;
  const resend = new Resend(apiKey);

  await resend.emails.send({
    from: fromAddress,
    to,
    subject: "You've been invited to Neurogan ERP",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p>You have been invited to access <strong>Neurogan ERP</strong>.</p>
        <p style="margin:24px 0">
          <a href="${inviteUrl}"
             style="background:#000;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-size:14px;">
            Set your password
          </a>
        </p>
        <p style="color:#666;font-size:12px;">This link expires in 7 days. If you did not expect this invitation, you can ignore this email.</p>
      </div>
    `,
    text: `You have been invited to Neurogan ERP.\n\nSet your password here:\n${inviteUrl}\n\nThis link expires in 7 days.`,
  });
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add server/auth/password.ts server/email/resend.ts package.json package-lock.json
git commit -m "feat(t09): add generateInviteToken and Resend email module"
```

---

### Task 2: Storage layer extensions

**Goal:** Extend `CreateUserInput` to carry invite fields, and add `acceptInvite` / `renewInviteToken` to the storage interface and its implementation.

**Files:**
- Modify: `server/storage.ts` (lines 98–110 for CreateUserInput; IStorage interface)
- Modify: `server/db-storage.ts` (createUser implementation; add new methods)

**Acceptance Criteria:**
- [ ] `CreateUserInput` accepts `status`, `inviteTokenHash`, `inviteTokenExpiresAt`
- [ ] `storage.createUser(...)` passes those fields through to the DB insert
- [ ] `storage.acceptInvite(userId, hash)` sets passwordHash + passwordChangedAt=now + status=ACTIVE + clears token columns
- [ ] `storage.renewInviteToken(userId, hash, expiresAt)` overwrites the two token columns
- [ ] `npx tsc --noEmit` passes

**Verify:** `npx tsc --noEmit` → no output

**Steps:**

- [ ] **Step 1: Extend CreateUserInput in server/storage.ts**

Find `CreateUserInput` (around line 102). Replace the interface:

```typescript
export interface CreateUserInput {
  email: string;
  fullName: string;
  title?: string | null;
  passwordHash: string;
  status?: UserStatus;
  inviteTokenHash?: string | null;
  inviteTokenExpiresAt?: Date | null;
  roles: readonly UserRole[];
  createdByUserId: string | null;
  grantedByUserId: string | null;
}
```

- [ ] **Step 2: Add new methods to IStorage interface in server/storage.ts**

Find the IStorage interface block containing `getUserById`, `getUserByEmail`, `createUser`. Add after `createUser`:

```typescript
  acceptInvite(userId: string, passwordHash: string): Promise<void>;
  renewInviteToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
```

- [ ] **Step 3: Update createUser in server/db-storage.ts**

Find `createUser` in `db-storage.ts` (around line 2619). Update the `tx.insert(schema.users).values(...)` call to pass the new optional fields:

```typescript
const [user] = await tx
  .insert(schema.users)
  .values({
    email: data.email.toLowerCase().trim(),
    fullName: data.fullName.trim(),
    title: data.title ?? null,
    passwordHash: data.passwordHash,
    passwordChangedAt: new Date(0),
    status: data.status ?? "ACTIVE",
    inviteTokenHash: data.inviteTokenHash ?? null,
    inviteTokenExpiresAt: data.inviteTokenExpiresAt ?? null,
    createdByUserId: data.createdByUserId,
  })
  .returning();
```

- [ ] **Step 4: Implement acceptInvite in db-storage.ts**

Add the method to the `DatabaseStorage` class, after `updateUserStatus`:

```typescript
async acceptInvite(userId: string, passwordHash: string): Promise<void> {
  await db
    .update(schema.users)
    .set({
      passwordHash,
      passwordChangedAt: new Date(),
      status: "ACTIVE",
      inviteTokenHash: null,
      inviteTokenExpiresAt: null,
    })
    .where(eq(schema.users.id, userId));
}
```

- [ ] **Step 5: Implement renewInviteToken in db-storage.ts**

Add after `acceptInvite`:

```typescript
async renewInviteToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  await db
    .update(schema.users)
    .set({ inviteTokenHash: tokenHash, inviteTokenExpiresAt: expiresAt })
    .where(eq(schema.users.id, userId));
}
```

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add server/storage.ts server/db-storage.ts
git commit -m "feat(t09): extend storage layer with invite token methods"
```

---

### Task 3: Server routes + tests

**Goal:** Wire up all three route changes (create user, accept-invite, resend-invite, login block for PENDING_INVITE) and ship integration tests covering the full invite lifecycle.

**Files:**
- Modify: `server/routes.ts`
- Modify: `server/auth/auth-routes.ts`
- Modify: `server/__tests__/users.test.ts`
- Create: `server/__tests__/t09-invite.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/users` returns `{ user }` with `status: "PENDING_INVITE"`, no `temporaryPassword`
- [ ] `POST /api/auth/login` with a PENDING_INVITE user returns 401 `INVITE_PENDING` (no failedLoginCount increment)
- [ ] `POST /api/auth/accept-invite` with valid token → 200, user status=ACTIVE
- [ ] `POST /api/auth/accept-invite` with expired token → 400 `INVITE_INVALID`
- [ ] `POST /api/auth/accept-invite` with wrong token → 400 `INVITE_INVALID`
- [ ] `POST /api/users/:id/resend-invite` → 204, new token hash written
- [ ] All tests pass: `pnpm test` → no failures

**Verify:** `pnpm test 2>&1 | grep -E "FAIL|PASS|Error"` → all PASS lines, no FAIL

**Steps:**

- [ ] **Step 1: Write failing tests for POST /api/users changes**

Update `server/__tests__/users.test.ts`. Find the `"201: creates user + returns one-time temporaryPassword"` test and replace it:

```typescript
it("201: creates user with status PENDING_INVITE; no temporaryPassword in response", async () => {
  const res = await request(app)
    .post("/api/users")
    .set("X-Test-User-Id", adminId)
    .send({
      email: "alice@test.local",
      fullName: "Alice Example",
      title: "Operator",
      roles: ["PRODUCTION"],
    });

  expect(res.status).toBe(201);
  expect(res.body.user.email).toBe("alice@test.local");
  expect(res.body.user.status).toBe("PENDING_INVITE");
  expect(res.body.user.passwordHash).toBeUndefined();
  expect(res.body.temporaryPassword).toBeUndefined();
});
```

- [ ] **Step 2: Run users tests to verify they fail**

```bash
DATABASE_URL=$DATABASE_URL pnpm test server/__tests__/users.test.ts
```
Expected: test `"201: creates user..."` FAILS (still returns temporaryPassword).

- [ ] **Step 3: Update POST /api/users in server/routes.ts**

Find the `app.post("/api/users", ...)` handler. Replace the body:

```typescript
app.post("/api/users", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const body = createUserBody.parse(req.body);
    const rawToken = generateInviteToken();
    const tokenHash = await hashPassword(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const user = await withAudit(
      {
        userId: req.user!.id,
        action: "CREATE",
        entityType: "user",
        entityId: (result) => (result as { id: string }).id,
        before: null,
        route: `${req.method} ${req.path}`,
        requestId: req.requestId,
      },
      (tx) => storage.createUser({
        email: body.email,
        fullName: body.fullName,
        title: body.title ?? null,
        passwordHash: "$invite_pending$",
        status: "PENDING_INVITE",
        inviteTokenHash: tokenHash,
        inviteTokenExpiresAt: expiresAt,
        roles: body.roles,
        createdByUserId: req.user!.id,
        grantedByUserId: req.user!.id,
      }, tx),
    );

    await sendInviteEmail(body.email, rawToken);
    return res.status(201).json({ user });
  } catch (err) {
    const pgErr = err as { code?: string } | undefined;
    if (pgErr?.code === "23505") {
      const email = (req.body as { email?: string } | undefined)?.email ?? "";
      return next(errors.duplicateEmail(email));
    }
    return next(err);
  }
});
```

Add imports at the top of `server/routes.ts` (remove `generateTemporaryPassword`, add `generateInviteToken` and `sendInviteEmail`):

```typescript
import { hashPassword, generateInviteToken } from "./auth/password";
import { sendInviteEmail } from "./email/resend";
```

Remove `generateTemporaryPassword` from the import.

- [ ] **Step 4: Add POST /api/users/:id/resend-invite in server/routes.ts**

Add after the `GET /api/users` block:

```typescript
// POST /api/users/:id/resend-invite — ADMIN only. Generates a fresh invite token
// and resends the invite email. Only valid when user.status === 'PENDING_INVITE'.
app.post("/api/users/:id/resend-invite", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const user = await storage.getUserById(req.params.id);
    if (!user) return next(errors.notFound("User"));
    if (user.status !== "PENDING_INVITE") {
      return res.status(400).json({
        error: { code: "VALIDATION_FAILED", message: "User has already accepted their invite." },
      });
    }

    const rawToken = generateInviteToken();
    const tokenHash = await hashPassword(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await storage.renewInviteToken(user.id, tokenHash, expiresAt);

    await writeAuditRow({
      userId: req.user!.id,
      action: "INVITE_RESENT",
      entityType: "user",
      entityId: user.id,
      route: `${req.method} ${req.path}`,
      requestId: req.requestId,
    });

    await sendInviteEmail(user.email, rawToken);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});
```

- [ ] **Step 5: Block PENDING_INVITE at login in server/auth/auth-routes.ts**

In `POST /api/auth/login`, add an early check BEFORE `passport.authenticate`. Find the line `const emailRaw = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";` and add right after it (before the `try {` that calls passport):

```typescript
// Reject pending-invite users before passport runs (avoids incrementing
// failedLoginCount for accounts that haven't set a password yet).
const preCheckUser = await storage.getUserByEmail(emailRaw).catch(() => null);
if (preCheckUser?.status === "PENDING_INVITE") {
  return res.status(401).json({
    error: {
      code: "INVITE_PENDING",
      message: "Your account has a pending invite. Check your email to set your password.",
    },
  });
}
```

Actually, looking at the login route structure, the `try {` block is where passport runs. The check should go BEFORE `passport.authenticate`. Concretely:

```typescript
router.post("/login", async (req, res, next) => {
  const body = req.body as { email?: string; password?: string };
  const emailRaw = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";

  // Reject pending-invite users before passport runs (avoids incrementing
  // failedLoginCount for accounts that haven't set a password yet).
  const preCheckUser = await storage.getUserByEmail(emailRaw).catch(() => null);
  if (preCheckUser?.status === "PENDING_INVITE") {
    return res.status(401).json({
      error: {
        code: "INVITE_PENDING",
        message: "Your account has a pending invite. Check your email to set your password.",
      },
    });
  }

  try {
    // ... existing passport.authenticate code unchanged ...
  }
});
```

- [ ] **Step 6: Add POST /api/auth/accept-invite in server/auth/auth-routes.ts**

Add before `export { router as authRouter }`:

```typescript
// POST /api/auth/accept-invite — public. Validates invite token and activates account.
// Body: { token: string; email: string; password: string }
// On success: returns the activated UserResponse so the client can immediately
// POST /api/auth/login with the same credentials to establish a session.
const acceptInviteBody = z.object({
  token: z.string().min(1),
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(1),
});

router.post("/accept-invite", async (req, res, next) => {
  try {
    const body = acceptInviteBody.parse(req.body);

    const user = await storage.getUserByEmail(body.email);
    const INVALID = { error: { code: "INVITE_INVALID", message: "This invite link has expired or is invalid." } };

    if (
      !user ||
      user.status !== "PENDING_INVITE" ||
      !user.inviteTokenHash ||
      !user.inviteTokenExpiresAt
    ) {
      return res.status(400).json(INVALID);
    }

    if (user.inviteTokenExpiresAt < new Date()) {
      return res.status(400).json(INVALID);
    }

    const tokenMatches = await verifyPassword(user.inviteTokenHash, body.token);
    if (!tokenMatches) {
      return res.status(400).json(INVALID);
    }

    const complexityResult = validatePasswordComplexity(body.password);
    if (!complexityResult.valid) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_FAILED",
          message: "Password does not meet complexity requirements.",
          details: { violations: complexityResult.violations },
        },
      });
    }

    const newHash = await hashPassword(body.password);
    await storage.acceptInvite(user.id, newHash);

    await writeAuditRow({
      userId: user.id,
      action: "INVITE_ACCEPTED",
      entityType: "user",
      entityId: user.id,
      route: `${req.method} ${req.path}`,
      requestId: req.requestId,
    });

    const userResponse = await storage.getUserById(user.id);
    if (!userResponse) return next(new Error("User not found after invite acceptance"));

    return res.status(200).json({ user: userResponse });
  } catch (err) {
    return next(err);
  }
});
```

- [ ] **Step 7: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 8: Write t09-invite.test.ts**

Create `server/__tests__/t09-invite.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import * as schema from "@shared/schema";
import { db } from "../db";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";

// Mock the Resend email module so tests never hit the real API.
vi.mock("../email/resend", () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mock so we get the mocked version.
import { sendInviteEmail } from "../email/resend";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("T-09 — invite lifecycle", () => {
  let app: Express;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    vi.mocked(sendInviteEmail).mockClear();

    await db.delete(schema.auditTrail);
    await db.delete(schema.passwordHistory);
    await db.delete(schema.userRoles);
    await db.delete(schema.users);

    const hashedPw = await hashPassword("SeedPassword1!");
    const admin = await storage.createUser({
      email: "admin@test.local",
      fullName: "Admin Seed",
      title: null,
      passwordHash: hashedPw,
      roles: ["ADMIN"],
      createdByUserId: null,
      grantedByUserId: null,
    });
    adminId = admin.id;
  });

  // ─── POST /api/users ───────────────────────────────────────────────────

  describe("POST /api/users", () => {
    it("201: creates PENDING_INVITE user; calls sendInviteEmail; no temporaryPassword", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", adminId)
        .send({ email: "alice@test.local", fullName: "Alice", roles: ["PRODUCTION"] });

      expect(res.status).toBe(201);
      expect(res.body.user.status).toBe("PENDING_INVITE");
      expect(res.body.temporaryPassword).toBeUndefined();
      expect(vi.mocked(sendInviteEmail)).toHaveBeenCalledOnce();
      expect(vi.mocked(sendInviteEmail).mock.calls[0][0]).toBe("alice@test.local");
    });
  });

  // ─── POST /api/auth/login (PENDING_INVITE block) ───────────────────────

  describe("POST /api/auth/login — PENDING_INVITE block", () => {
    it("401 INVITE_PENDING: pending-invite user cannot log in", async () => {
      // Create invite user
      await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", adminId)
        .send({ email: "bob@test.local", fullName: "Bob", roles: ["QA"] });

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "bob@test.local", password: "anything" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVITE_PENDING");
    });
  });

  // ─── POST /api/auth/accept-invite ─────────────────────────────────────

  describe("POST /api/auth/accept-invite", () => {
    async function createInvitedUser(email: string): Promise<string> {
      await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", adminId)
        .send({ email, fullName: "Test User", roles: ["VIEWER"] });
      // Capture rawToken from the mock call
      const rawToken = vi.mocked(sendInviteEmail).mock.calls.at(-1)![1] as string;
      vi.mocked(sendInviteEmail).mockClear();
      return rawToken;
    }

    it("200: valid token → status=ACTIVE, returns user, token columns cleared", async () => {
      const rawToken = await createInvitedUser("carol@test.local");

      const res = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: rawToken, email: "carol@test.local", password: "MyNewPass1!" });

      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe("ACTIVE");
      expect(res.body.user.email).toBe("carol@test.local");

      // Verify token columns are cleared in DB
      const [dbUser] = await db
        .select({ inviteTokenHash: schema.users.inviteTokenHash })
        .from(schema.users)
        .where(db.fn ? undefined : undefined); // use raw query check below
      // Simpler: just verify the user can no longer use the same token
      const reuse = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: rawToken, email: "carol@test.local", password: "AnotherPass1!" });
      expect(reuse.status).toBe(400);
      expect(reuse.body.error.code).toBe("INVITE_INVALID");
    });

    it("400 INVITE_INVALID: wrong token", async () => {
      await createInvitedUser("dave@test.local");

      const res = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: "wrongtoken000000000000000000000000000000000000000000000000000000", email: "dave@test.local", password: "MyNewPass1!" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVITE_INVALID");
    });

    it("400 INVITE_INVALID: unknown email", async () => {
      const res = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: "sometoken", email: "nobody@test.local", password: "MyNewPass1!" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVITE_INVALID");
    });

    it("422 VALIDATION_FAILED: password too short", async () => {
      const rawToken = await createInvitedUser("eve@test.local");

      const res = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: rawToken, email: "eve@test.local", password: "short" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  // ─── POST /api/users/:id/resend-invite ────────────────────────────────

  describe("POST /api/users/:id/resend-invite", () => {
    it("204: resends invite with new token; old token invalidated", async () => {
      // Create invite user and get the first token
      await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", adminId)
        .send({ email: "frank@test.local", fullName: "Frank", roles: ["VIEWER"] });
      const firstToken = vi.mocked(sendInviteEmail).mock.calls.at(-1)![1] as string;
      vi.mocked(sendInviteEmail).mockClear();

      // Get the user id
      const listRes = await request(app).get("/api/users").set("X-Test-User-Id", adminId);
      const frank = listRes.body.find((u: { email: string }) => u.email === "frank@test.local");

      // Resend
      const resendRes = await request(app)
        .post(`/api/users/${frank.id}/resend-invite`)
        .set("X-Test-User-Id", adminId);
      expect(resendRes.status).toBe(204);
      expect(vi.mocked(sendInviteEmail)).toHaveBeenCalledOnce();

      const secondToken = vi.mocked(sendInviteEmail).mock.calls.at(-1)![1] as string;
      expect(secondToken).not.toBe(firstToken);

      // Old token is invalid
      const oldRes = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: firstToken, email: "frank@test.local", password: "MyNewPass1!" });
      expect(oldRes.status).toBe(400);

      // New token works
      const newRes = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: secondToken, email: "frank@test.local", password: "MyNewPass1!" });
      expect(newRes.status).toBe(200);
    });

    it("400: cannot resend to already-active user", async () => {
      const res = await request(app)
        .post(`/api/users/${adminId}/resend-invite`)
        .set("X-Test-User-Id", adminId);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("403: non-admin cannot resend invite", async () => {
      const hashedPw = await hashPassword("SeedPassword1!");
      const qa = await storage.createUser({
        email: "qa@test.local",
        fullName: "QA",
        title: null,
        passwordHash: hashedPw,
        roles: ["QA"],
        createdByUserId: adminId,
        grantedByUserId: adminId,
      });

      const res = await request(app)
        .post(`/api/users/${adminId}/resend-invite`)
        .set("X-Test-User-Id", qa.id);
      expect(res.status).toBe(403);
    });
  });
});
```

Note: The token-cleared check test above has a placeholder for the DB verification — replace that inner block with a direct Drizzle query. Specifically, replace the middle lines of the "200: valid token" test with:

```typescript
// Verify DB: token columns are NULL after acceptance
const [dbRow] = await db
  .select({ hash: schema.users.inviteTokenHash, exp: schema.users.inviteTokenExpiresAt })
  .from(schema.users)
  .where(eq(schema.users.email, "carol@test.local"))
  .limit(1);
// Import eq from drizzle-orm at the top of the file
expect(dbRow.hash).toBeNull();
expect(dbRow.exp).toBeNull();
```

Add `import { eq } from "drizzle-orm";` at the top.

- [ ] **Step 9: Run all tests**

```bash
DATABASE_URL=$DATABASE_URL pnpm test
```
Expected: all test suites pass. Pay attention to:
- `users.test.ts` — the updated `201` test must pass
- `t09-invite.test.ts` — all lifecycle tests pass
- No regressions in `auth.test.ts`

- [ ] **Step 10: Commit**

```bash
git add server/routes.ts server/auth/auth-routes.ts server/__tests__/users.test.ts server/__tests__/t09-invite.test.ts
git commit -m "feat(t09): invite routes (create, accept, resend) + integration tests"
```

---

### Task 4: Client — set-password page + App.tsx + settings-users overhaul

**Goal:** Add the public `/set-password` page, wire it as a public route in App.tsx, and update settings-users.tsx to remove the temp-password dialog and add PENDING_INVITE UX.

**Files:**
- Create: `client/src/pages/set-password.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/settings-users.tsx`

**Acceptance Criteria:**
- [ ] `/set-password` route is reachable without auth (outside AuthGate)
- [ ] Set-password page with wrong token shows error message (no form submit loop)
- [ ] Set-password page with valid token sets password and redirects to login
- [ ] Settings Users page no longer shows temp-password dialog
- [ ] PENDING_INVITE users show amber "Pending" badge in the users table
- [ ] PENDING_INVITE users show "Resend invite" button; Disable button is hidden for them
- [ ] `npx tsc --noEmit` passes

**Verify:** `npx tsc --noEmit` → no output

**Steps:**

- [ ] **Step 1: Create client/src/pages/set-password.tsx**

The app uses wouter with hash-based routing. Query params are embedded in the hash fragment:
`/#/set-password?token=<raw>&email=<encoded>`

Read them via `window.location.hash`. On success, redirect to `#/login`.

```tsx
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import neuroganLogo from "@/assets/neurogan-logo.jpg";

function getHashParams(): { token: string | null; email: string | null } {
  const hash = window.location.hash; // e.g. "#/set-password?token=abc&email=x%40y.com"
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return { token: null, email: null };
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return { token: params.get("token"), email: params.get("email") };
}

export default function SetPassword() {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { token, email } = getHashParams();

  useEffect(() => {
    if (!token || !email) {
      navigate("/login", { replace: true });
    }
  }, [token, email, navigate]);

  if (!token || !email) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, email, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
        if (body.error?.code === "INVITE_INVALID") {
          setError("This invite link has expired or is invalid. Ask your admin to resend the invite.");
        } else if (body.error?.code === "VALIDATION_FAILED") {
          setError(body.error.message ?? "Password does not meet requirements.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        return;
      }

      setDone(true);
      // Redirect to login — user can now sign in with their new password.
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={neuroganLogo} alt="Neurogan" className="h-12 w-12 rounded-xl object-cover" />
          <h1 className="text-xl font-semibold">Set your password</h1>
          <p className="text-sm text-muted-foreground text-center">
            Welcome to Neurogan ERP. Choose a password for{" "}
            <span className="font-medium">{email}</span>.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Create password</CardTitle>
            <CardDescription className="text-xs">
              Minimum 12 characters, must include uppercase, lowercase, number, and symbol.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <Alert>
                <AlertDescription>
                  Password set! Redirecting to login…
                </AlertDescription>
              </Alert>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    data-testid="input-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    data-testid="input-confirm"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting} data-testid="button-submit">
                  {submitting ? "Setting password…" : "Set password"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add /set-password as a public route in App.tsx**

Add the import at the top of `client/src/App.tsx`:

```typescript
import SetPassword from "@/pages/set-password";
```

In the outer `<Switch>` (the one that wraps both the `/login` public route and the `<AuthGate>` catch-all), add the route for `/set-password` alongside `/login`:

```tsx
<Router hook={useHashLocationWithParams}>
  <Switch>
    <Route path="/production/print/:id" component={BatchPrint} />
    <Route path="/login" component={Login} />
    <Route path="/set-password" component={SetPassword} />
    <Route>
      <AuthGate>
        <AppLayout />
      </AuthGate>
    </Route>
  </Switch>
  <AuthGateInactivity />
</Router>
```

- [ ] **Step 3: Update UserRow type in settings-users.tsx**

Find the `UserRow` interface (around line 70). Add `"PENDING_INVITE"` to the status union:

```typescript
interface UserRow {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  status: "ACTIVE" | "DISABLED" | "PENDING_INVITE";
  roles: Role[];
  passwordChangedAt?: string | null;
  lockedUntil?: string | null;
  failedLoginCount?: number | null;
  createdAt: string;
}
```

- [ ] **Step 4: Update StatusBadge in settings-users.tsx**

Replace the `StatusBadge` component:

```tsx
function StatusBadge({ status }: { status: "ACTIVE" | "DISABLED" | "PENDING_INVITE" }) {
  if (status === "PENDING_INVITE") {
    return (
      <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">
        Pending
      </Badge>
    );
  }
  return (
    <Badge
      variant={status === "ACTIVE" ? "default" : "outline"}
      className={`text-xs ${status === "DISABLED" ? "border-destructive text-destructive" : ""}`}
    >
      {status}
    </Badge>
  );
}
```

- [ ] **Step 5: Remove temp-password state and dialog; update createMutation in settings-users.tsx**

Find `const [tempPassword, setTempPassword] = useState...` and remove it.

Update `createMutation.onSuccess`:
```typescript
onSuccess: (data) => {
  queryClient.invalidateQueries({ queryKey: ["/api/users"] });
  setCreateOpen(false);
  createForm.reset();
  toast({ title: "Invite sent", description: `An invite email has been sent to ${data.user.email}.` });
},
```

Update `createMutation` type — `mutationFn` return type changes (no `temporaryPassword`):
```typescript
const res = await apiRequest("POST", "/api/users", data);
return res.json() as Promise<{ user: UserRow }>;
```

Delete the entire `{/* One-time temp-password display */}` `<Dialog>` block and the `copyTempPassword` function.

Remove the `Copy` icon from the lucide imports since it's no longer needed (check it's not used elsewhere first — it isn't).

- [ ] **Step 6: Update the actions column in settings-users.tsx to handle PENDING_INVITE**

Find the `<div className="flex justify-end gap-2">` inside the table row actions. Replace with:

```tsx
<div className="flex justify-end gap-2">
  <Button
    size="sm"
    variant="outline"
    onClick={() => setEditingUser(u)}
    data-testid={`button-edit-roles-${u.id}`}
  >
    <KeyRound className="h-3.5 w-3.5 mr-1" /> Roles
  </Button>
  {u.status === "PENDING_INVITE" ? (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        resendInviteMutation.mutate(u.id)
      }
      disabled={resendInviteMutation.isPending}
      data-testid={`button-resend-invite-${u.id}`}
    >
      Resend invite
    </Button>
  ) : u.status === "ACTIVE" ? (
    <Button
      size="sm"
      variant="outline"
      onClick={() => setConfirmDisable(u)}
      data-testid={`button-disable-${u.id}`}
    >
      <UserX className="h-3.5 w-3.5 mr-1" /> Disable
    </Button>
  ) : (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        toggleStatusMutation.mutate({ id: u.id, status: "ACTIVE" })
      }
      data-testid={`button-enable-${u.id}`}
    >
      <UserCheck className="h-3.5 w-3.5 mr-1" /> Enable
    </Button>
  )}
</div>
```

Add the `resendInviteMutation` before the existing mutations:

```typescript
const resendInviteMutation = useMutation({
  mutationFn: async (id: string) => {
    await apiRequest("POST", `/api/users/${id}/resend-invite`);
  },
  onSuccess: () => {
    toast({ title: "Invite resent" });
  },
  onError: (err: Error) => {
    toast({ title: "Could not resend invite", description: err.message, variant: "destructive" });
  },
});
```

- [ ] **Step 7: Update the "Create user" dialog description**

Find the `DialogDescription` in the Create dialog (around line 356):

```tsx
<DialogDescription className="text-xs">
  The user will receive an email with a link to set their password. The link
  expires after 7 days.
</DialogDescription>
```

- [ ] **Step 8: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/set-password.tsx client/src/App.tsx client/src/pages/settings-users.tsx
git commit -m "feat(t09): set-password page, public route, settings-users invite UX"
```

---

## Self-review

**Spec coverage:**
- ✅ DB migration + schema (Task 0)
- ✅ Resend email module, env vars (Task 1)
- ✅ POST /api/users → invite flow (Task 3)
- ✅ POST /api/auth/accept-invite (Task 3)
- ✅ POST /api/users/:id/resend-invite (Task 3)
- ✅ PENDING_INVITE login block (Task 3)
- ✅ Client set-password page (Task 4)
- ✅ App.tsx public route (Task 4)
- ✅ settings-users.tsx UX (Task 4)
- ✅ Audit trail: INVITE_ACCEPTED + INVITE_RESENT (Task 3)
- ✅ Integration tests (Task 3)

**Type consistency check:**
- `generateInviteToken()` → returns `string` → used as `rawToken` in routes ✅
- `sendInviteEmail(to: string, rawToken: string)` → called with `(body.email, rawToken)` ✅
- `storage.acceptInvite(userId: string, passwordHash: string)` → called with `(user.id, newHash)` ✅
- `storage.renewInviteToken(userId, tokenHash, expiresAt)` → called correctly ✅
- `CreateUserInput.status?: UserStatus` — `UserStatus` now includes `"PENDING_INVITE"` ✅
