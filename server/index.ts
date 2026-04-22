import express from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { errorMiddleware } from "./error-middleware";
import { passport } from "./auth/passport";
import { requireAuth } from "./auth/middleware";
import { authRouter } from "./auth/auth-routes";
import { getPool } from "./db";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

const PgSession = ConnectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool: getPool(),
      tableName: "session",
      pruneSessionInterval: 24 * 60 * 60,
    }),
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60 * 1000, // 15-min idle timeout (rolling resets on each request)
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

// Auth routes are public (no requireAuth wrapper).
app.use("/api/auth", authRouter);

// All other /api/* routes require an active session, except /api/health.
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  return requireAuth(req, res, next);
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Migrations do not run on boot. Per FDA/AGENTS.md §5.2 and D-09 of
  // FDA/neurogan-erp-build-spec.md, self-mutating schemas are incompatible
  // with a validated regulated system. Schema changes are applied through
  // the explicit CI/deploy step `pnpm migrate:up` (drizzle-kit migrate)
  // which runs only against migrations hand-reviewed into the repo.

  await registerRoutes(httpServer, app);

  app.use(errorMiddleware);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
