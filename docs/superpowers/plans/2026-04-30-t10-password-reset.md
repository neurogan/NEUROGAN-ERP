# T-10 Self-Service Password Reset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow ACTIVE users to reset their own password from the login screen via a time-limited (1 hour) email link, without admin intervention.

**Architecture:** Two new public API routes (`POST /api/auth/forgot-password` and `POST /api/auth/reset-password`) follow the exact same token pattern as T-09's invite flow. Two new Drizzle columns on `erp_users` store the reset token hash + expiry. Two new client pages plus a "Forgot password?" link on login.

**Tech Stack:** Drizzle ORM (PostgreSQL), Resend email, argon2id token hashing, wouter hash-router, Vitest + supertest integration tests.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `migrations/0026_t10_password_reset.sql` | CREATE | Add `reset_token_hash` + `reset_token_expires_at` to `erp_users` |
| `migrations/meta/_journal.json` | MODIFY | Register new migration entry |
| `shared/schema.ts` | MODIFY | Add columns to `users` table, update `UserResponse` omit, add audit actions |
| `server/storage.ts` | MODIFY | Add `storeResetToken` + `clearResetToken` to `IStorage` interface |
| `server/db-storage.ts` | MODIFY | Implement `storeResetToken` + `clearResetToken` in `DatabaseStorage` |
| `server/email/resend.ts` | MODIFY | Add `sendPasswordResetEmail` function |
| `server/auth/auth-routes.ts` | MODIFY | Add `POST /forgot-password` + `POST /reset-password` routes |
| `server/__tests__/t10-password-reset.test.ts` | CREATE | 8 integration tests |
| `client/src/pages/forgot-password.tsx` | CREATE | Email form + success state |
| `client/src/pages/reset-password.tsx` | CREATE | New/confirm password form |
| `client/src/pages/login.tsx` | MODIFY | Add "Forgot password?" link |
| `client/src/App.tsx` | MODIFY | Register two new public routes |

---

## Task 1: Migration + Schema

**Goal:** Add `reset_token_hash` / `reset_token_expires_at` columns and `PASSWORD_RESET_REQUESTED` / `PASSWORD_RESET` audit actions to the schema.

**Files:**
- Create: `migrations/0026_t10_password_reset.sql`
- Modify: `migrations/meta/_journal.json`
- Modify: `shared/schema.ts`

**Acceptance Criteria:**
- [ ] Migration SQL file exists and is syntactically valid
- [ ] `_journal.json` has entry at idx 26 with tag `0026_t10_password_reset`
- [ ] `shared/schema.ts` `users` table has `resetTokenHash` + `resetTokenExpiresAt` columns
- [ ] `UserResponse` type omits both new columns
- [ ] `toUserResponse` destructure explicitly strips both columns
- [ ] `auditActionEnum` includes `PASSWORD_RESET_REQUESTED` and `PASSWORD_RESET`
- [ ] `pnpm tsc --noEmit` passes with no errors

**Verify:** `pnpm tsc --noEmit` → no errors

**Steps:**

- [ ] **Step 1: Create migration SQL**

Create `migrations/0026_t10_password_reset.sql`:

```sql
ALTER TABLE erp_users
  ADD COLUMN reset_token_hash        TEXT,
  ADD COLUMN reset_token_expires_at  TIMESTAMPTZ;
```

- [ ] **Step 2: Update `_journal.json`**

Open `migrations/meta/_journal.json`. Add a new entry at the end of the `entries` array:

```json
{
  "idx": 26,
  "version": "7",
  "when": 1777593600000,
  "tag": "0026_t10_password_reset",
  "breakpoints": true
}
```

The full array now ends with entries for idx 25 and 26.

- [ ] **Step 3: Add columns to users table in `shared/schema.ts`**

Find the `users` table definition (around line 816). After line 829 (`inviteTokenExpiresAt`), add:

```ts
  inviteTokenHash: text("invite_token_hash"),
  inviteTokenExpiresAt: timestamp("invite_token_expires_at", { withTimezone: true }),
  resetTokenHash: text("reset_token_hash"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
```

(Replace the existing two invite lines + add the two new reset lines so the block reads exactly as above.)

- [ ] **Step 4: Update `UserResponse` omit in `shared/schema.ts`**

Find this line (around line 883):

```ts
export type UserResponse = Omit<User, "passwordHash" | "inviteTokenHash" | "inviteTokenExpiresAt"> & {
```

Replace with:

```ts
export type UserResponse = Omit<User, "passwordHash" | "inviteTokenHash" | "inviteTokenExpiresAt" | "resetTokenHash" | "resetTokenExpiresAt"> & {
```

- [ ] **Step 5: Update `toUserResponse` destructure in `server/db-storage.ts`**

Find `private static toUserResponse` (around line 2582). Update the destructure to strip the two new columns:

```ts
  private static toUserResponse(user: User, roles: readonly UserRole[]): UserResponse {
    const {
      passwordHash: _passwordHash,
      inviteTokenHash: _inviteTokenHash,
      inviteTokenExpiresAt: _inviteTokenExpiresAt,
      resetTokenHash: _resetTokenHash,
      resetTokenExpiresAt: _resetTokenExpiresAt,
      ...rest
    } = user;
    void _passwordHash;
    void _inviteTokenHash;
    void _inviteTokenExpiresAt;
    void _resetTokenHash;
    void _resetTokenExpiresAt;
    return { ...rest, roles: [...roles] };
  }
```

- [ ] **Step 6: Add audit actions to `shared/schema.ts`**

Find `auditActionEnum` (around line 905). Add the two new actions after `"INVITE_RESENT"`:

```ts
  "INVITE_ACCEPTED",
  "INVITE_RESENT",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET",
  "SPEC_VERSION_CREATED",
```

(Keep `SPEC_VERSION_CREATED`, `SPEC_APPROVED`, `SPEC_VERSION_SUPERSEDED` after the new entries.)

- [ ] **Step 7: Type-check**

```bash
cd /Users/frederikhejlskov/Desktop/NEUROGAN-ERP && pnpm tsc --noEmit
```

Expected: no errors. If TypeScript complains about `UserResponse` shape, verify the omit in Step 4 and destructure in Step 5 match exactly.

- [ ] **Step 8: Commit**

```bash
git add migrations/0026_t10_password_reset.sql migrations/meta/_journal.json shared/schema.ts server/db-storage.ts
git commit -m "feat(t10): add reset_token columns and audit actions"
```

---

## Task 2: Storage Layer

**Goal:** Add `storeResetToken` and `clearResetToken` to the `IStorage` interface and `DatabaseStorage` implementation.

**Files:**
- Modify: `server/storage.ts` (interface, around line 378)
- Modify: `server/db-storage.ts` (implementation, after `renewInviteToken` around line 2691)

**Acceptance Criteria:**
- [ ] `IStorage` declares `storeResetToken(userId, hash, expiresAt): Promise<void>`
- [ ] `IStorage` declares `clearResetToken(userId): Promise<void>`
- [ ] `DatabaseStorage` implements both
- [ ] `pnpm tsc --noEmit` passes

**Verify:** `pnpm tsc --noEmit` → no errors

**Steps:**

- [ ] **Step 1: Add methods to `IStorage` interface in `server/storage.ts`**

Find `renewInviteToken` declaration (line 378). Add two new methods after it:

```ts
  renewInviteToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  storeResetToken(userId: string, hash: string, expiresAt: Date): Promise<void>;
  clearResetToken(userId: string): Promise<void>;
```

- [ ] **Step 2: Implement in `DatabaseStorage` in `server/db-storage.ts`**

Find `async renewInviteToken` (around line 2686). Add the two new implementations immediately after the closing brace of `renewInviteToken`:

```ts
  async storeResetToken(userId: string, hash: string, expiresAt: Date): Promise<void> {
    await db
      .update(schema.users)
      .set({ resetTokenHash: hash, resetTokenExpiresAt: expiresAt })
      .where(eq(schema.users.id, userId));
  }

  async clearResetToken(userId: string): Promise<void> {
    await db
      .update(schema.users)
      .set({ resetTokenHash: null, resetTokenExpiresAt: null })
      .where(eq(schema.users.id, userId));
  }
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/frederikhejlskov/Desktop/NEUROGAN-ERP && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/storage.ts server/db-storage.ts
git commit -m "feat(t10): add storeResetToken and clearResetToken storage methods"
```

---

## Task 3: Backend Routes + Email (TDD)

**Goal:** `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` pass all 8 integration tests.

**Files:**
- Create: `server/__tests__/t10-password-reset.test.ts`
- Modify: `server/email/resend.ts`
- Modify: `server/auth/auth-routes.ts`

**Acceptance Criteria:**
- [ ] `POST /forgot-password` with unknown email returns 200 (anti-enumeration)
- [ ] `POST /forgot-password` with PENDING_INVITE user returns 200 and stores no token
- [ ] `POST /forgot-password` with ACTIVE user stores `resetTokenHash` in DB
- [ ] `POST /reset-password` with expired token returns 400 `RESET_INVALID`
- [ ] `POST /reset-password` with wrong token returns 400 `RESET_INVALID`
- [ ] `POST /reset-password` with valid token returns 200, clears token, and old password no longer works
- [ ] `POST /reset-password` reusing current password returns 422 `VALIDATION_FAILED`
- [ ] Token used twice returns 400 `RESET_INVALID` on second use

**Verify:** `DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) pnpm test -- t10-password-reset` → 8 passing

**Steps:**

- [ ] **Step 1: Write the test file**

Create `server/__tests__/t10-password-reset.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../email/resend", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { sendPasswordResetEmail } from "../email/resend";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

describeIfDb("T-10 — Self-service password reset", () => {
  let app: Express;
  let userId: string;
  let userEmail: string;
  const toDelete = { users: [] as string[] };

  beforeAll(async () => {
    app = await buildTestApp();

    const [u] = await db
      .insert(schema.users)
      .values({
        email: `t10-${Date.now()}@test.com`,
        fullName: "T10 User",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
        status: "ACTIVE",
      })
      .returning();
    userId = u!.id;
    userEmail = u!.email;
    toDelete.users.push(userId);

    await db
      .update(schema.users)
      .set({ passwordChangedAt: new Date() })
      .where(eq(schema.users.id, userId));
  });

  afterAll(async () => {
    for (const id of toDelete.users) {
      await db.delete(schema.users).where(eq(schema.users.id, id)).catch(() => {});
    }
  });

  async function getTokenRow(id: string) {
    const [row] = await db
      .select({
        resetTokenHash: schema.users.resetTokenHash,
        resetTokenExpiresAt: schema.users.resetTokenExpiresAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return row;
  }

  async function requestReset(email: string): Promise<string | null> {
    const mock = vi.mocked(sendPasswordResetEmail);
    mock.mockClear();
    await request(app).post("/api/auth/forgot-password").send({ email });
    if (mock.mock.calls.length === 0) return null;
    return mock.mock.calls[0]![1] as string;
  }

  it("200 for unknown email (anti-enumeration)", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
  });

  it("200 for PENDING_INVITE user — no token stored", async () => {
    const [pending] = await db
      .insert(schema.users)
      .values({
        email: `t10-pending-${Date.now()}@test.com`,
        fullName: "T10 Pending",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
        status: "PENDING_INVITE",
      })
      .returning();
    toDelete.users.push(pending!.id);

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: pending!.email });
    expect(res.status).toBe(200);

    const row = await getTokenRow(pending!.id);
    expect(row?.resetTokenHash).toBeNull();
  });

  it("stores resetTokenHash for valid ACTIVE email", async () => {
    const rawToken = await requestReset(userEmail);
    expect(rawToken).not.toBeNull();
    const row = await getTokenRow(userId);
    expect(row?.resetTokenHash).toBeTruthy();
    expect(row?.resetTokenExpiresAt).toBeTruthy();
  });

  it("400 RESET_INVALID for expired token", async () => {
    await requestReset(userEmail);
    await db
      .update(schema.users)
      .set({ resetTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.users.id, userId));

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: "anytoken", password: "NewPassword1!" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("RESET_INVALID");
  });

  it("400 RESET_INVALID for wrong token", async () => {
    await requestReset(userEmail);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: "aaaaaabbbbbbccccccddddddeeeeeeffffffff", password: "NewPassword1!" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("RESET_INVALID");

    // clean up the pending token
    await db
      .update(schema.users)
      .set({ resetTokenHash: null, resetTokenExpiresAt: null })
      .where(eq(schema.users.id, userId));
  });

  it("200: valid token resets password, clears token, old password invalid", async () => {
    const rawToken = await requestReset(userEmail);
    expect(rawToken).not.toBeNull();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: rawToken!, password: "NewPassword1!" });
    expect(res.status).toBe(200);

    const row = await getTokenRow(userId);
    expect(row?.resetTokenHash).toBeNull();
    expect(row?.resetTokenExpiresAt).toBeNull();

    const loginOld = await request(app)
      .post("/api/auth/login")
      .send({ email: userEmail, password: VALID_PASSWORD });
    expect(loginOld.status).toBe(401);

    // Restore for next tests
    const restored = await hashPassword(VALID_PASSWORD);
    await db
      .update(schema.users)
      .set({ passwordHash: restored, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(schema.users.id, userId));
  });

  it("422 VALIDATION_FAILED when reusing current password", async () => {
    const rawToken = await requestReset(userEmail);
    expect(rawToken).not.toBeNull();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: rawToken!, password: VALID_PASSWORD });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");

    // clean up token
    await db
      .update(schema.users)
      .set({ resetTokenHash: null, resetTokenExpiresAt: null })
      .where(eq(schema.users.id, userId));
  });

  it("400 RESET_INVALID when token used a second time", async () => {
    const rawToken = await requestReset(userEmail);
    expect(rawToken).not.toBeNull();

    await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: rawToken!, password: "NewPassword1!" });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: rawToken!, password: "AnotherPass1!" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("RESET_INVALID");

    // Restore
    const restored = await hashPassword(VALID_PASSWORD);
    await db
      .update(schema.users)
      .set({ passwordHash: restored, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(schema.users.id, userId));
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail because routes don't exist yet**

```bash
cd /Users/frederikhejlskov/Desktop/NEUROGAN-ERP
DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) pnpm test -- t10-password-reset
```

Expected: Tests fail with `404` responses or `cannot read mock calls` type errors.

- [ ] **Step 3: Add `sendPasswordResetEmail` to `server/email/resend.ts`**

Append after the closing brace of `sendInviteEmail`:

```ts
export async function sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "noreply@neurogan.com";
  const appUrl = (process.env.APP_URL ?? "http://localhost:5000").replace(/\/$/, "");

  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  const resetUrl = `${appUrl}/#/reset-password?token=${rawToken}&email=${encodeURIComponent(to)}`;
  const resend = new Resend(apiKey);

  await resend.emails.send({
    from: fromAddress,
    to,
    subject: "Reset your Neurogan ERP password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p>You requested a password reset for your <strong>Neurogan ERP</strong> account.</p>
        <p style="margin:24px 0">
          <a href="${resetUrl}"
             style="background:#000;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-size:14px;">
            Reset password
          </a>
        </p>
        <p style="color:#666;font-size:12px;">This link expires in 1 hour. If you did not request this, you can ignore this email.</p>
      </div>
    `,
    text: `You requested a password reset for Neurogan ERP.\n\nReset your password here:\n${resetUrl}\n\nThis link expires in 1 hour.`,
  });
}
```

- [ ] **Step 4: Add `POST /forgot-password` and `POST /reset-password` to `server/auth/auth-routes.ts`**

Add the following two route handlers before the final `export { router as authRouter }` line.

First, add these imports at the top of the file alongside the existing ones:

```ts
import { generateInviteToken } from "./password";
```

(Note: `generateInviteToken` is already in `password.ts` — it generates a 32-byte hex token, which is exactly what we need for reset tokens too. No new function needed.)

Then add to `server/email/resend.ts` import line at the top of `auth-routes.ts`. The existing import is:

```ts
// (there is no resend import yet in auth-routes.ts — add it)
import { sendPasswordResetEmail } from "../email/resend";
```

Now add the two routes (before the `export` line):

```ts
// POST /api/auth/forgot-password — public. Sends reset email if email belongs to an ACTIVE user.
// Always returns 200 to prevent email enumeration.
const forgotPasswordBody = z.object({
  email: z.string().email().trim().toLowerCase(),
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const body = forgotPasswordBody.parse(req.body);
    const user = await storage.getUserByEmail(body.email);

    if (user && user.status === "ACTIVE") {
      const rawToken = generateInviteToken();
      const hash = await hashPassword(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await storage.storeResetToken(user.id, hash, expiresAt);
      await sendPasswordResetEmail(user.email, rawToken).catch((err) => {
        console.error("[forgot-password] email send failed:", err);
      });
      await writeAuditRow({
        userId: user.id,
        action: "PASSWORD_RESET_REQUESTED",
        entityType: "user",
        entityId: user.id,
        route: `${req.method} ${req.path}`,
        requestId: req.requestId,
        meta: { ip: req.ip },
      }).catch(() => {});
    }

    return res.status(200).json({ message: "If that email is registered, a reset link is on its way." });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/reset-password — public. Validates token, sets new password, clears token.
const resetPasswordBody = z.object({
  email: z.string().email().trim().toLowerCase(),
  token: z.string().min(1),
  password: z.string().min(1),
});

const RESET_INVALID_RESPONSE = {
  error: { code: "RESET_INVALID", message: "This reset link has expired or is invalid." },
};

router.post("/reset-password", async (req, res, next) => {
  try {
    const body = resetPasswordBody.parse(req.body);

    const user = await storage.getUserByEmail(body.email);
    if (!user || !user.resetTokenHash || !user.resetTokenExpiresAt) {
      return res.status(400).json(RESET_INVALID_RESPONSE);
    }
    if (user.resetTokenExpiresAt < new Date()) {
      return res.status(400).json(RESET_INVALID_RESPONSE);
    }
    const tokenMatches = await verifyPassword(user.resetTokenHash, body.token);
    if (!tokenMatches) {
      return res.status(400).json(RESET_INVALID_RESPONSE);
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

    const history = await storage.getPasswordHistory(user.id, 5);
    for (const oldHash of history) {
      const isReuse = await verifyPassword(oldHash, body.password);
      if (isReuse) {
        return res.status(422).json({
          error: {
            code: "VALIDATION_FAILED",
            message: "New password was used recently. Choose a different password.",
          },
        });
      }
    }

    const newHash = await hashPassword(body.password);
    await storage.rotatePassword(user.id, newHash);
    await storage.clearResetToken(user.id);

    await writeAuditRow({
      userId: user.id,
      action: "PASSWORD_RESET",
      entityType: "user",
      entityId: user.id,
      route: `${req.method} ${req.path}`,
      requestId: req.requestId,
      meta: { ip: req.ip },
    }).catch(() => {});

    return res.status(200).json({ message: "Password updated. You can now sign in." });
  } catch (err) {
    return next(err);
  }
});
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) pnpm test -- t10-password-reset
```

Expected: 8 tests passing, 0 failing.

If a test fails, check:
- "stores resetTokenHash" fails → verify `storeResetToken` is wired correctly in `db-storage.ts`
- "expired token" fails → verify the `resetTokenExpiresAt < new Date()` guard runs before `verifyPassword`
- "reuse" fails → `getPasswordHistory` includes current hash; confirm `rotatePassword` was called before `clearResetToken`

- [ ] **Step 6: Commit**

```bash
git add server/__tests__/t10-password-reset.test.ts server/email/resend.ts server/auth/auth-routes.ts
git commit -m "feat(t10): add forgot-password and reset-password routes with tests"
```

---

## Task 4: Client Pages

**Goal:** `forgot-password.tsx` and `reset-password.tsx` pages are wired into the app; "Forgot password?" link appears on the login screen.

**Files:**
- Create: `client/src/pages/forgot-password.tsx`
- Create: `client/src/pages/reset-password.tsx`
- Modify: `client/src/pages/login.tsx`
- Modify: `client/src/App.tsx`

**Acceptance Criteria:**
- [ ] "Forgot password?" link is visible on login page
- [ ] Clicking it navigates to `/forgot-password` without triggering AuthGate
- [ ] Submitting any email on `/forgot-password` shows a generic success message
- [ ] `/reset-password?token=bad&email=x` shows the invalid-token card
- [ ] `/reset-password?token=<real>&email=<real>` accepts a new password and redirects to `/login`
- [ ] Both pages visible at their routes without being logged in

**Verify:** `pnpm dev` → manually visit `/#/forgot-password` and `/#/reset-password?token=test&email=test@test.com`

**Steps:**

- [ ] **Step 1: Create `client/src/pages/forgot-password.tsx`**

```tsx
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import neuroganLogo from "@/assets/neurogan-logo.jpg";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNetworkError(false);
    setIsPending(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSubmitted(true);
    } catch {
      setNetworkError(true);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={neuroganLogo} alt="Neurogan" className="h-12 w-12 rounded-xl object-cover" />
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Neurogan ERP</h1>
            <p className="text-sm text-muted-foreground">Reset your password</p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Forgot password</CardTitle>
            <CardDescription className="text-xs">
              {submitted
                ? "Check your inbox."
                : "Enter your email and we'll send a reset link."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {submitted ? (
              <>
                <Alert>
                  <AlertDescription className="text-sm">
                    If that email is registered, a reset link has been sent. Check your inbox.
                  </AlertDescription>
                </Alert>
                <Link href="/login">
                  <Button variant="outline" className="w-full">Back to sign in</Button>
                </Link>
              </>
            ) : (
              <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
                {networkError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-sm">
                      Something went wrong — please try again.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isPending}
                    data-testid="input-email"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isPending}>
                  {isPending ? "Sending…" : "Send reset link"}
                </Button>
                <div className="text-center">
                  <Link href="/login" className="text-xs text-muted-foreground hover:underline">
                    Back to sign in
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">
          21 CFR Part 11 — electronic records system
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `client/src/pages/reset-password.tsx`**

```tsx
import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import neuroganLogo from "@/assets/neurogan-logo.jpg";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [violations, setViolations] = useState<string[]>([]);
  const [invalidToken, setInvalidToken] = useState(false);

  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const token = params.get("token");
  const email = params.get("email");

  useEffect(() => {
    if (!token || !email) {
      navigate("/login");
    }
  }, [token, email, navigate]);

  if (!token || !email) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setViolations([]);

    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password: newPassword }),
      });

      if (res.ok) {
        navigate("/login");
        return;
      }

      const body = (await res.json()) as {
        error?: { code?: string; message?: string; details?: { violations?: string[] } };
      };
      const code = body?.error?.code;

      if (code === "RESET_INVALID") {
        setInvalidToken(true);
        return;
      }

      if (code === "VALIDATION_FAILED") {
        const v = body?.error?.details?.violations ?? [];
        if (v.length > 0) {
          setViolations(v);
        } else {
          setErrorMessage(body?.error?.message ?? "Password does not meet requirements.");
        }
        return;
      }

      setErrorMessage(body?.error?.message ?? "An unexpected error occurred. Please try again.");
    } catch {
      setErrorMessage("Network error — please check your connection and try again.");
    } finally {
      setIsPending(false);
    }
  };

  if (invalidToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-3">
            <img src={neuroganLogo} alt="Neurogan" className="h-12 w-12 rounded-xl object-cover" />
            <div className="text-center">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Neurogan ERP</h1>
            </div>
          </div>

          <Card data-testid="reset-password-invalid-token">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Reset link invalid</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription className="text-sm">
                  This reset link has expired or is invalid. Request a new one.
                </AlertDescription>
              </Alert>
              <Link href="/forgot-password">
                <Button className="w-full">Request new reset link</Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" className="w-full">Back to sign in</Button>
              </Link>
            </CardContent>
          </Card>

          <p className="text-center text-[11px] text-muted-foreground">
            21 CFR Part 11 — electronic records system
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={neuroganLogo} alt="Neurogan" className="h-12 w-12 rounded-xl object-cover" />
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Neurogan ERP</h1>
            <p className="text-sm text-muted-foreground">Set a new password</p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Reset password</CardTitle>
            <CardDescription className="text-xs">
              Resetting password for <span className="font-medium">{email}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
              {errorMessage && (
                <Alert variant="destructive">
                  <AlertDescription className="text-sm">{errorMessage}</AlertDescription>
                </Alert>
              )}
              {violations.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription className="text-sm">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {violations.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={isPending}
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={isPending}
                  data-testid="input-confirm-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isPending} data-testid="button-reset-password">
                {isPending ? "Resetting…" : "Reset password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">
          21 CFR Part 11 — electronic records system
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add "Forgot password?" link to `client/src/pages/login.tsx`**

Find this block in `login.tsx` (around line 85):

```tsx
              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending ? "Signing in…" : "Sign in"}
              </Button>
```

Replace with:

```tsx
              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending ? "Signing in…" : "Sign in"}
              </Button>
              <div className="text-center">
                <Link href="/forgot-password" className="text-xs text-muted-foreground hover:underline">
                  Forgot password?
                </Link>
              </div>
```

Also ensure `Link` is imported from `"wouter"`. The existing import is:

```ts
import { useLocation } from "wouter";
```

Replace with:

```ts
import { useLocation, Link } from "wouter";
```

- [ ] **Step 4: Register routes in `client/src/App.tsx`**

Find the existing public route registrations (around line 276):

```tsx
              <Route path="/login" component={Login} />
              <Route path="/set-password" component={SetPassword} />
```

Replace with:

```tsx
              <Route path="/login" component={Login} />
              <Route path="/set-password" component={SetPassword} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password" component={ResetPassword} />
```

Add the two new imports at the top of `App.tsx` alongside the existing page imports:

```ts
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
```

- [ ] **Step 5: Verify in browser**

```bash
pnpm dev
```

Check:
1. `http://localhost:5000/#/login` — "Forgot password?" link visible below Sign in button
2. Clicking it goes to `http://localhost:5000/#/forgot-password`
3. Submitting any email shows the success message
4. `http://localhost:5000/#/reset-password?token=bad&email=test%40test.com` — shows invalid token card with "Request new reset link" button
5. Both pages accessible without being logged in

- [ ] **Step 6: Run full test suite**

```bash
DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) pnpm test
```

Expected: all tests passing, including the 8 new T-10 tests.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/forgot-password.tsx client/src/pages/reset-password.tsx client/src/pages/login.tsx client/src/App.tsx
git commit -m "feat(t10): add forgot-password and reset-password client pages"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Migration `reset_token_hash` + `reset_token_expires_at` | Task 1 |
| Audit actions `PASSWORD_RESET_REQUESTED` + `PASSWORD_RESET` | Task 1 |
| `UserResponse` strips reset token columns | Task 1 |
| `storeResetToken` + `clearResetToken` storage methods | Task 2 |
| `POST /forgot-password` — always 200, generates token | Task 3 |
| `POST /forgot-password` — ACTIVE only | Task 3 |
| `POST /reset-password` — token validation | Task 3 |
| `POST /reset-password` — complexity + reuse check | Task 3 |
| `POST /reset-password` — calls `rotatePassword` then `clearResetToken` | Task 3 |
| `sendPasswordResetEmail` | Task 3 |
| 8 integration tests | Task 3 |
| `forgot-password.tsx` | Task 4 |
| `reset-password.tsx` | Task 4 |
| "Forgot password?" link on login | Task 4 |
| Both routes outside AuthGate | Task 4 |

All requirements covered. No placeholders. Types consistent throughout (`resetTokenHash: string \| null`, `resetTokenExpiresAt: Date \| null`).
