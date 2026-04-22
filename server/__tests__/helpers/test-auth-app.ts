import express, { type Express } from "express";
import session from "express-session";
import { createServer } from "http";
import { passport } from "../../auth/passport";
import { authRouter } from "../../auth/auth-routes";
import { requireAuth } from "../../auth/middleware";
import { registerRoutes } from "../../routes";
import { errorMiddleware } from "../../error-middleware";

// Auth-aware test app: includes real session middleware (MemoryStore is fine
// for tests) + passport + auth routes. Used by auth.test.ts to exercise the
// full login/logout/rotate-password flows against a disposable Postgres.
export async function buildAuthTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

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

  app.use("/api/auth", authRouter);

  // Mirror the global auth gate from server/index.ts.
  app.use("/api", (req, res, next) => {
    if (req.path === "/health") return next();
    return requireAuth(req, res, next);
  });

  await registerRoutes(createServer(), app);
  app.use(errorMiddleware);

  return app;
}
