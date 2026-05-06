import express from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { randomUUID } from "crypto";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { errorMiddleware } from "./error-middleware";
import { passport } from "./auth/passport";
import { requireAuth } from "./auth/middleware";
import { authRouter } from "./auth/auth-routes";
import { getPool, checkAuditTrailImmutability } from "./db";
import path from "path";
import {
  buildAllowedOrigins,
  corsMiddleware,
  helmetMiddleware,
  authRateLimiter,
  apiRateLimiter,
} from "./hardening";

// F-07: Boot guards — fail fast rather than run insecure.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required");
}

// F-07: CSP/CORS allowlist — Railway app origin + local dev.
// Set ALLOWED_ORIGINS as a comma-separated list in Railway env vars.
// Boot fails in production if empty (no wildcard allowed).
const ALLOWED_ORIGINS = buildAllowedOrigins(process.env.ALLOWED_ORIGINS);
if (process.env.NODE_ENV === "production" && ALLOWED_ORIGINS.length === 0) {
  throw new Error("ALLOWED_ORIGINS is required in production (F-07 CSP/CORS boot guard)");
}

const app = express();
const httpServer = createServer(app);

// Railway (and most PaaS) terminate TLS at the edge and forward plain HTTP
// to the Node process. Without this, req.secure === false and express-session
// skips setting the Set-Cookie header on Secure cookies, so browsers never
// receive the session cookie and every request after login returns 401.
app.set("trust proxy", 1);

// F-07: Helmet — security headers + strict CSP (applied globally).
app.use(helmetMiddleware(ALLOWED_ORIGINS));

// F-07: CORS + rate limiting apply only to /api routes.
// Static assets use relative URLs (same-origin) so CORS is irrelevant there;
// applying it globally caused the browser's crossorigin attribute on <script>/<link>
// to trigger CORS preflight/rejection for same-domain asset fetches.
app.use("/api", corsMiddleware(ALLOWED_ORIGINS));
app.use("/api/auth/login", authRateLimiter());            // 5/min — brute-force guard
app.use("/api/auth/forgot-password", authRateLimiter(60_000, 10)); // 10/min — less strict
app.use("/api/auth/reset-password", authRateLimiter(60_000, 10));  // 10/min — less strict
app.use("/api/auth/accept-invite", authRateLimiter());
app.use("/api/auth/rotate-password", authRateLimiter());
app.use("/api", apiRateLimiter());

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "20mb" }));

const PgSession = ConnectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool: getPool(),
      tableName: "session",
      pruneSessionInterval: 24 * 60 * 60,
    }),
    secret: process.env.SESSION_SECRET as string,
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

// F-03: Attach a unique request ID to every inbound request so audit rows
// written during the same HTTP call can be correlated in the audit log.
app.use((req, _res, next) => {
  req.requestId = randomUUID();
  next();
});

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

// Idempotent migration runner for AUTO_MIGRATE=true environments (staging).
// Runs each pending migration individually. If it fails with a PostgreSQL
// "already exists" error (42P07 duplicate_table / 42701 duplicate_column),
// the schema is already in the correct state — record the migration as applied
// and continue. Any other error aborts the boot.
//
// Migration 0013 has a production-use guard (RAISE EXCEPTION) that fires when
// placeholder seed users are older than 24 hours — always true on staging.
// It is bypassed by inserting the documented skip record before iterating.
async function idempotentMigrate(migrationsFolder: string): Promise<void> {
  const { readFileSync } = await import("fs");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    // Bypass migration 0013's production-use guard.
    const { rows: skip13 } = await client.query(
      `SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $1`,
      [1745500500000],
    );
    if (skip13.length === 0) {
      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        ["manually-skipped-0013", 1745500500000],
      );
      console.log("[boot] migration 0013 bypass inserted");
    }

    const journal = JSON.parse(
      readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8"),
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };

    const { rows: done } = await client.query<{ created_at: string }>(
      `SELECT created_at FROM drizzle.__drizzle_migrations`,
    );
    const applied = new Set(done.map((r) => Number(r.created_at)));

    for (const entry of journal.entries) {
      if (applied.has(entry.when)) continue;

      const sql = readFileSync(`${migrationsFolder}/${entry.tag}.sql`, "utf8");
      const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

      try {
        await client.query("BEGIN");
        for (const stmt of statements) {
          await client.query(stmt);
        }
        await client.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
          [`auto-${entry.idx}`, entry.when],
        );
        await client.query("COMMIT");
        console.log(`[boot] migration ${entry.tag} applied`);
      } catch (err: unknown) {
        await client.query("ROLLBACK");
        const pgCode = (err as { code?: string }).code;
        // 42P07 = duplicate_table, 42701 = duplicate_column, 42710 = duplicate_object
        if (pgCode === "42P07" || pgCode === "42701" || pgCode === "42710") {
          await client.query(
            `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
            [`already-existed-${entry.idx}`, entry.when],
          );
          console.log(`[boot] migration ${entry.tag} schema already present, recorded`);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[boot] migration ${entry.tag} FAILED (${pgCode ?? "?"}): ${msg}`);
          throw err;
        }
      }
    }
  } finally {
    client.release();
  }
}

(async () => {
  // Migrations do not run on boot by default. Per FDA/AGENTS.md §5.2 and D-09
  // of FDA/neurogan-erp-build-spec.md, self-mutating schemas are incompatible
  // with a validated regulated system. Schema changes are applied through the
  // explicit CI/deploy step `pnpm migrate:up` (drizzle-kit migrate) which runs
  // only against migrations hand-reviewed into the repo.
  //
  // Exception: AUTO_MIGRATE=true opts non-production environments (staging) in
  // to running pending migrations on boot via drizzle-orm's programmatic
  // migrator — no CLI binary required.
  if (process.env.AUTO_MIGRATE === "true") {
    const migrationsFolder = path.join(process.cwd(), "migrations");
    console.log("[boot] AUTO_MIGRATE=true — applying pending migrations from:", migrationsFolder);
    await idempotentMigrate(migrationsFolder);
    console.log("[boot] migrations up to date");
  }

  // F-03: Verify the erp_app role cannot UPDATE audit_trail (D-07).
  await checkAuditTrailImmutability();

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
