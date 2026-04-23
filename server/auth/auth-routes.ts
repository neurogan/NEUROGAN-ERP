import { Router } from "express";
import { passport } from "./passport";
import { storage } from "../storage";
import { hashPassword, verifyPassword } from "./password";
import { validatePasswordComplexity, isPasswordExpired } from "./password-policy";
import { errors } from "../errors";
import { requireAuth } from "./middleware";
import { writeAuditRow, withAudit } from "../audit/audit";
import { z } from "zod";

const router = Router();

// POST /api/auth/login
// Authenticates with passport-local, then applies lockout + rotation checks.
router.post("/login", async (req, res, next) => {
  const body = req.body as { email?: string; password?: string };
  const emailRaw = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";

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

export { router as authRouter };
