import express, { type Express } from "express";
import session from "express-session";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { passport } from "../../auth/passport";
import { authRouter } from "../../auth/auth-routes";
import { registerRoutes } from "../../routes";
import { errorMiddleware } from "../../error-middleware";
import { storage } from "../../storage";

// Build an Express app for integration tests. Differs from the production
// server only in one place: an extra middleware up front that reads
// X-Test-User-Id and populates req.user from the DB, simulating what F-02's
// session deserialisation will do in production. The production server
// (server/index.ts) never reads this header; it's only mounted here.
//
// Also mounts authRouter so tests that exercise auth endpoints (login,
// accept-invite, etc.) work without needing a separate buildAuthTestApp().
//
// Tests set the header on each request to exercise requireAuth / requireRole.
// Omitting it produces a 401 (no req.user set), which is the correct answer.
export async function buildTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Session + passport are required by the login route's req.login() call.
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 15 * 60 * 1000 },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  // Mirror the requestId middleware from server/index.ts so that req.requestId
  // is always a valid UUID. Without this, performSignature fails in tests because
  // erp_electronic_signatures.request_id has a NOT NULL constraint.
  app.use((req, _res, next) => {
    req.requestId = randomUUID();
    next();
  });

  // X-Test-User-Id: allows tests to impersonate any user without a real login.
  app.use(async (req, _res, next) => {
    try {
      const raw = req.headers["x-test-user-id"];
      const userId = typeof raw === "string" ? raw : undefined;
      if (userId) {
        const user = await storage.getUserById(userId);
        if (user) {
          req.user = {
            id: user.id,
            email: user.email,
            roles: user.roles,
            status: user.status,
          };
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  // Auth routes (login, logout, accept-invite, rotate-password, me).
  app.use("/api/auth", authRouter);

  await registerRoutes(createServer(), app);
  app.use(errorMiddleware);

  return app;
}
