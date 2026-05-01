# T-09 Email Invite — First-Login Design

**Goal:** Replace the manual temp-password-in-dialog workflow with an email invite flow. When an admin creates a user, the system emails a signed link; the user clicks it, sets their own password, and is auto-logged in.

**Architecture:** Resend transactional email API. Raw token in URL, bcrypt hash stored in DB, cleared on redemption. New `PENDING_INVITE` user status gates login until password is set.

**Tech Stack:** Resend SDK (`resend` npm package), bcrypt (already in use for password hashing), existing Express/Drizzle/React stack.

---

## 1. Database

One migration (`0022_t09_email_invite.sql`) adds three columns to `erp_users`:

```sql
ALTER TABLE erp_users
  ADD COLUMN invite_token_hash   TEXT,
  ADD COLUMN invite_token_expires_at TIMESTAMPTZ;
```

`status` already accepts free-form text — no enum change needed. The new valid value `PENDING_INVITE` is enforced at the application layer (Drizzle schema type + route guards). Existing rows are unaffected (columns nullable, status remains `ACTIVE` or `DISABLED`).

`shared/schema.ts` — extend `userStatusEnum` (or equivalent type) to include `"PENDING_INVITE"`, add `inviteTokenHash` and `inviteTokenExpiresAt` to the `users` table definition.

**Token rules:**
- Raw token: `crypto.randomBytes(32).toString('hex')` — 64 hex chars
- Stored: `bcrypt.hash(rawToken, 10)`
- Expires: `now() + 7 days`
- Cleared (set to `NULL`) when the invite is accepted

---

## 2. Email module

**`server/email/resend.ts`** — single responsibility: send the invite email.

```typescript
// Reads at module load time; throws if missing so Railway deploy fails fast
const RESEND_API_KEY = requireEnv("RESEND_API_KEY");
const RESEND_FROM = requireEnv("RESEND_FROM_ADDRESS"); // e.g. noreply@neurogan.com
const APP_URL = requireEnv("APP_URL");                 // e.g. https://erp.neurogan.com

export async function sendInviteEmail(to: string, rawToken: string): Promise<void>
```

The invite URL is `${APP_URL}/set-password?token=${rawToken}&email=${encodeURIComponent(email)}`.

Email content (HTML + plain text fallback):
- **Subject:** `You've been invited to Neurogan ERP`
- **Body:** One sentence intro, CTA button "Set your password", link expiry note ("This link expires in 7 days.")
- Sent via `POST https://api.resend.com/emails`

**Environment variables required** (added to Railway service):
| Variable | Example |
|---|---|
| `RESEND_API_KEY` | `re_xxxxx` |
| `RESEND_FROM_ADDRESS` | `noreply@neurogan.com` |
| `APP_URL` | `https://erp.neurogan.com` |

---

## 3. Server — user creation

**`POST /api/users`** (existing route in `server/routes.ts`) changes:

1. Generate raw token, hash it, compute expiry
2. Create user with `status: "PENDING_INVITE"`, `passwordHash: ""` (placeholder — login is blocked by status check), `inviteTokenHash`, `inviteTokenExpiresAt`
3. Call `sendInviteEmail(email, rawToken)`
4. Return the user row (no `temporaryPassword` field)

If `sendInviteEmail` throws (Resend API error), the user creation is rolled back and a 502 is returned. The admin can retry.

---

## 4. Server — accept invite endpoint

**`POST /api/auth/accept-invite`** — public (no `requireAuth`), added to `server/auth/auth-routes.ts`.

Request body:
```typescript
{ token: string; email: string; password: string }
```

Logic:
1. Find user by `email` where `status = 'PENDING_INVITE'` — narrow lookup before bcrypt
2. `bcrypt.compare(token, user.inviteTokenHash)` — reject if no match or token expired
3. `validatePasswordComplexity(password)` — same rules as rotate-password
4. In a transaction: set `passwordHash`, `passwordChangedAt = now()`, `status = 'ACTIVE'`, `inviteTokenHash = NULL`, `inviteTokenExpiresAt = NULL`
5. Write `INVITE_ACCEPTED` audit row
6. `req.login(user)` — auto-log the user in
7. Return `{ user }` (same shape as `/api/auth/login` response)

Error cases:
- Token not found or expired → 400 `{ code: "INVITE_INVALID" }`
- Password fails complexity → 422 (same shape as rotate-password)

---

## 5. Server — resend invite endpoint

**`POST /api/users/:id/resend-invite`** — ADMIN only, added to the existing users router.

1. Load user; 404 if not found
2. 400 if `status !== 'PENDING_INVITE'`
3. Generate new raw token, hash, expiry (overwrites previous)
4. Call `sendInviteEmail`
5. Write `INVITE_RESENT` audit action
6. Return 204

---

## 6. Client — settings-users.tsx

Changes to the existing `settings-users.tsx`:

- **Remove** the one-time temp-password `Dialog` and `tempPassword` state
- **`createMutation.onSuccess`** — just invalidate query + show toast "Invite sent to {email}" (no temp password to display)
- **Status badge** — add `PENDING_INVITE` case: amber/yellow badge labelled `PENDING`
- **Actions column** — for `PENDING_INVITE` users show a "Resend invite" button (calls `POST /api/users/:id/resend-invite`); hide Disable button until user is ACTIVE

---

## 7. Client — set-password page

**New file: `client/src/pages/set-password.tsx`**

Route: `/set-password?token=<raw>` — public (no auth wall).

Behaviour:
- On mount: read `?token` and `?email` from query string; if either missing redirect to `/login`
- Show a form: "New password" + "Confirm password" fields + "Set password" submit button
- On submit: `POST /api/auth/accept-invite` with `{ token, email, password }`
- On success: user is logged in server-side; client sets auth state and navigates to `/`
- On `INVITE_INVALID`: show "This invite link has expired or is invalid. Ask your admin to resend the invite." — no retry

**`client/src/App.tsx`** — add `/set-password` as a route outside the auth guard (same pattern as `/login`).

---

## 8. Audit trail (21 CFR Part 11 §11.10(e))

Two new audit actions written via `writeAuditRow`:

| `action` | Trigger |
|---|---|
| `INVITE_ACCEPTED` | User successfully sets password via invite |
| `INVITE_RESENT` | Admin resends invite |

User creation already writes `USER_CREATED` via the existing route.

---

## 9. Testing

Integration tests in `server/__tests__/t09-invite.test.ts` using the existing `describeIfDb` / `buildTestApp` pattern. Resend SDK is mocked at module level (never calls real API in tests).

Key scenarios:
1. `POST /api/users` → user row has `status=PENDING_INVITE`, `invite_token_hash` set, `invite_token_expires_at` ~7 days out
2. `POST /api/auth/accept-invite` with valid token → status=ACTIVE, token columns NULL, session established
3. `POST /api/auth/accept-invite` with expired token → 400 `INVITE_INVALID`
4. `POST /api/auth/accept-invite` with wrong token → 400 `INVITE_INVALID`
5. `POST /api/users/:id/resend-invite` → new token hash, old one overwritten
6. `PENDING_INVITE` user cannot log in via `POST /api/auth/login` → 401

---

## 10. Deployment checklist

Before deploying:
1. Add `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `APP_URL` to Railway environment variables
2. Verify sender domain is verified in Resend dashboard (neurogan.com)
3. Migration 0022 runs automatically via `railway.toml` `releaseCommand`
