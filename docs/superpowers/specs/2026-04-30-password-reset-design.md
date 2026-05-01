# Self-Service Password Reset — Design Spec

**Ticket:** T-10  
**Date:** 2026-04-30  
**Status:** Approved

---

## Goal

Allow any ACTIVE user to reset their own password from the login screen via a time-limited email link, without requiring admin intervention. Eliminates the manual DB-level reset workflow that has caused multiple production outages.

---

## Architecture

Two new public API routes + two new client pages + one new email template + one Drizzle migration. Follows the exact same token pattern as the T-09 invite flow (`inviteTokenHash` / `inviteTokenExpiresAt`).

---

## Data Layer

### Migration: `0026_t10_password_reset`

Add two nullable columns to `erp_users`:

```sql
ALTER TABLE erp_users
  ADD COLUMN reset_token_hash        TEXT,
  ADD COLUMN reset_token_expires_at  TIMESTAMPTZ;
```

Both are `NULL` when no active reset is pending; cleared to `NULL` immediately after a successful reset.

### Schema (`shared/schema.ts`)

New columns on `users` table:

```ts
resetTokenHash:      text("reset_token_hash"),
resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
```

Both columns are **stripped from `UserResponse`** (added to the existing omit list alongside `passwordHash`, `inviteTokenHash`, `inviteTokenExpiresAt`).

### Audit Actions

Add to `auditActionEnum` in `shared/schema.ts`:

- `PASSWORD_RESET_REQUESTED` — fired when a reset email is sent
- `PASSWORD_RESET` — fired when the reset is completed and the new password is saved

---

## Backend

### Storage interface additions (`server/storage.ts`)

```ts
storeResetToken(userId: string, hash: string, expiresAt: Date): Promise<void>;
clearResetToken(userId: string): Promise<void>;
```

`storeResetToken` sets `resetTokenHash` and `resetTokenExpiresAt` on the user row.  
`clearResetToken` sets both columns to `NULL`.

### Route: `POST /api/auth/forgot-password`

**Public** (no `requireAuth`). Registered in `auth-routes.ts`.

Request body: `{ email: string }`

Behaviour:
1. Look up user by email. If not found or `status !== "ACTIVE"`: **return 200 immediately** (anti-enumeration — never reveal whether an email is registered).
2. Generate a random token: `crypto.randomBytes(32).toString("hex")` (same approach as invite token).
3. Hash token with `hashPassword(rawToken)` (argon2id, same as passwords).
4. Store hash + `expiresAt = now + 1 hour` via `storage.storeResetToken`.
5. Send reset email via `sendPasswordResetEmail(user.email, rawToken)`.
6. Write audit row: `PASSWORD_RESET_REQUESTED`.
7. Return `200 { message: "If that email is registered, a reset link is on its way." }`.

If Resend throws, log the error server-side but still return 200 (anti-enumeration; user will not see a difference).

### Route: `POST /api/auth/reset-password`

**Public** (no `requireAuth`). Registered in `auth-routes.ts`.

Request body: `{ email: string; token: string; password: string }`

Behaviour:
1. Look up user by email.
2. Validate token — same guard sequence as `accept-invite`:
   - User must exist and have `resetTokenHash` + `resetTokenExpiresAt` set.
   - `resetTokenExpiresAt` must be in the future.
   - `verifyPassword(user.resetTokenHash, body.token)` must return `true`.
   - On any failure: `400 { code: "RESET_INVALID", message: "This reset link has expired or is invalid." }`.
3. Validate password complexity via `validatePasswordComplexity`.
4. Check last-5-reuse via `storage.getPasswordHistory` (same as `rotate-password`).
5. Hash new password, call `storage.rotatePassword(userId, newHash)` (reuses existing method — updates `passwordHash`, stamps `passwordChangedAt`, appends to history).
6. Clear reset token: `storage.clearResetToken(userId)`.
7. Write audit row: `PASSWORD_RESET`.
8. Return `200 { message: "Password updated. You can now sign in." }`.

---

## Email

### `sendPasswordResetEmail(to: string, rawToken: string)` — `server/email/resend.ts`

Same structure as `sendInviteEmail`. Differences:
- Subject: `"Reset your Neurogan ERP password"`
- Link: `${appUrl}/#/reset-password?token=${rawToken}&email=${encodeURIComponent(to)}`
- Button label: `"Reset password"`
- Expiry note: `"This link expires in 1 hour."`

---

## Client

### `client/src/pages/forgot-password.tsx`

Public page (outside AuthGate). Single email input form.

States:
- **Default:** email field + "Send reset link" button.
- **Pending:** button disabled, shows "Sending…".
- **Submitted:** regardless of API outcome, show generic success card: _"If that email is registered, a reset link has been sent. Check your inbox."_ with a "Back to sign in" link.

No error state is shown to the user (anti-enumeration). Network errors show a brief "Something went wrong — try again" message.

### `client/src/pages/reset-password.tsx`

Public page (outside AuthGate). Near-identical to `set-password.tsx`.

Reads `token` and `email` from hash-based query params (`/#/reset-password?token=...&email=...`). Redirects to `/login` if either param is missing.

States:
- **Default:** new password + confirm password fields.
- **Invalid token:** error card ("This reset link has expired or is invalid. Request a new one.") with link to `/forgot-password`.
- **Success:** navigates to `/login`.

Calls `POST /api/auth/reset-password`. Handles:
- `RESET_INVALID` → invalid token card
- `VALIDATION_FAILED` → show complexity violations inline (same as `set-password.tsx`)

### `client/src/pages/login.tsx`

Add "Forgot password?" link below the Sign in button:

```tsx
<div className="text-center">
  <Link href="/forgot-password" className="text-xs text-muted-foreground hover:underline">
    Forgot password?
  </Link>
</div>
```

### `client/src/App.tsx`

Register two new public routes (alongside `/login` and `/set-password`):

```tsx
<Route path="/forgot-password" component={ForgotPassword} />
<Route path="/reset-password" component={ResetPassword} />
```

---

## Testing

Integration tests in `server/__tests__/t10-password-reset.test.ts`:

1. `POST /forgot-password` with unknown email → 200 (no error leaked)
2. `POST /forgot-password` with PENDING_INVITE user → 200 (not treated as ACTIVE)
3. `POST /forgot-password` with valid ACTIVE email → 200; `resetTokenHash` set in DB
4. `POST /reset-password` with expired token → 400 RESET_INVALID
5. `POST /reset-password` with wrong token → 400 RESET_INVALID
6. `POST /reset-password` with valid token → 200; password changed; token cleared; old password no longer valid
7. `POST /reset-password` reuse of last password → 422 VALIDATION_FAILED
8. `POST /reset-password` token cannot be used twice → 400 RESET_INVALID

---

## Out of Scope

- Rate-limiting on `forgot-password` (no brute-force risk since it always returns 200)
- Admin-initiated reset (existing invite resend covers this use case)
- SMS / TOTP fallback
