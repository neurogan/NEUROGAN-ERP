import { Router } from "express";
import { passport } from "./passport";
import { storage } from "../storage";
import { hashPassword, verifyPassword, generateInviteToken } from "./password";
import { validatePasswordComplexity, isPasswordExpired } from "./password-policy";
import { errors } from "../errors";
import { requireAuth } from "./middleware";
import { writeAuditRow, withAudit } from "../audit/audit";
import { z } from "zod";
import { sendPasswordResetEmail } from "../email/resend";

const router = Router();

// POST /api/auth/login
// Authenticates with passport-local, then applies lockout + rotation checks.
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
    // Run passport authenticate as a promise so we can use async/await cleanly.
    const user = await new Promise<Express.User | false>((resolve, reject) => {
      passport.authenticate("local", (err: unknown, u: Express.User | false) => {
        if (err) return reject(err);
        resolve(u);
      })(req, res, next);
    });

    if (!user) {
      const dbUser = await storage.getUserByEmail(emailRaw).catch(() => null);
      if (dbUser) {
        const { lockedUntil } = await storage.recordFailedLogin(dbUser.id);
        await writeAuditRow({
          userId: dbUser.id,
          action: "LOGIN_FAILED",
          entityType: "user",
          entityId: dbUser.id,
          route: `${req.method} ${req.path}`,
          requestId: req.requestId,
          meta: { email: emailRaw, ip: req.ip, ua: req.headers["user-agent"] ?? null },
        }).catch(() => { /* best-effort — never block the response */ });
        if (lockedUntil && lockedUntil > new Date()) {
          return res.status(423).json({
            error: {
              code: "ACCOUNT_LOCKED",
              message: "Account temporarily locked due to too many failed login attempts.",
              details: { lockedUntil },
            },
          });
        }
      }
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Invalid email or password." } });
    }

    // Password matched — now check lockout on the fresh DB row.
    const fullUser = await storage.getUserByEmail(emailRaw);
    if (!fullUser) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Invalid email or password." } });
    }

    if (fullUser.lockedUntil && fullUser.lockedUntil > new Date()) {
      return res.status(423).json({
        error: {
          code: "ACCOUNT_LOCKED",
          message: "Account temporarily locked due to too many failed login attempts.",
          details: { lockedUntil: fullUser.lockedUntil },
        },
      });
    }

    if (fullUser.status !== "ACTIVE") {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Account is disabled." } });
    }

    await storage.recordSuccessfulLogin(fullUser.id);

    const mustRotatePassword = isPasswordExpired(fullUser.passwordChangedAt);

    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });

    await writeAuditRow({
      userId: fullUser.id,
      action: "LOGIN",
      entityType: "user",
      entityId: fullUser.id,
      route: `${req.method} ${req.path}`,
      requestId: req.requestId,
      meta: { ip: req.ip, ua: req.headers["user-agent"] ?? null },
    }).catch(() => { /* best-effort */ });

    const response = await storage.getUserById(fullUser.id);
    if (!response) return next(new Error("Failed to load user after login"));
    return res.status(200).json({ user: { ...response, mustRotatePassword } });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/logout
router.post("/logout", (req, res, next) => {
  const userId = req.user?.id;
  const requestId = req.requestId;
  const route = `${req.method} ${req.path}`;
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((destroyErr) => {
      if (destroyErr) return next(destroyErr);
      res.clearCookie("connect.sid");
      if (userId) {
        writeAuditRow({
          userId,
          action: "LOGOUT",
          entityType: "user",
          entityId: userId,
          route,
          requestId,
        }).catch(() => { /* best-effort */ });
      }
      return res.status(204).send();
    });
  });
});

// GET /api/auth/me — current session user + mustRotatePassword
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await storage.getUserById(req.user!.id);
    if (!user) return next(errors.notFound("User"));
    const fullUser = await storage.getUserByEmail(user.email);
    const mustRotatePassword = fullUser ? isPasswordExpired(fullUser.passwordChangedAt) : false;
    return res.json({ user, roles: user.roles, mustRotatePassword });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/rotate-password
const rotatePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

router.post("/rotate-password", requireAuth, async (req, res, next) => {
  try {
    const body = rotatePasswordBody.parse(req.body);
    const userId = req.user!.id;

    const fullUser = await storage.getUserByEmail(req.user!.email);
    if (!fullUser) return next(errors.notFound("User"));

    const currentMatches = await verifyPassword(fullUser.passwordHash, body.currentPassword);
    if (!currentMatches) {
      return res.status(422).json({
        error: { code: "VALIDATION_FAILED", message: "Current password is incorrect." },
      });
    }

    const complexityResult = validatePasswordComplexity(body.newPassword);
    if (!complexityResult.valid) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_FAILED",
          message: "New password does not meet complexity requirements.",
          details: { violations: complexityResult.violations },
        },
      });
    }

    // Check reuse against last 5 hashes (current + 4 from history)
    const history = await storage.getPasswordHistory(userId, 5);
    for (const oldHash of history) {
      const isReuse = await verifyPassword(oldHash, body.newPassword);
      if (isReuse) {
        return res.status(422).json({
          error: {
            code: "VALIDATION_FAILED",
            message: "New password was used recently. Choose a different password.",
          },
        });
      }
    }

    const newHash = await hashPassword(body.newPassword);
    const updated = await withAudit(
      {
        userId,
        action: "PASSWORD_ROTATE",
        entityType: "user",
        entityId: userId,
        before: null,
        route: `${req.method} ${req.path}`,
        requestId: req.requestId,
      },
      (tx) => storage.rotatePassword(userId, newHash, tx),
    );
    if (!updated) return next(errors.notFound("User"));

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/accept-invite — public. Validates invite token and activates account.
// Body: { token: string; email: string; password: string }
// On success: returns activated UserResponse. Client then calls POST /api/auth/login
// with the same credentials to establish a session.
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
      }).catch(() => { /* best-effort — never block the response */ });
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
    }).catch(() => { /* best-effort — never block the response */ });

    return res.status(200).json({ message: "Password updated. You can now sign in." });
  } catch (err) {
    return next(err);
  }
});

export { router as authRouter };
