import express, { type Express } from "express";
import { createServer } from "http";
import { registerRoutes } from "../../routes";
import { errorMiddleware } from "../../error-middleware";
import { storage } from "../../storage";

// Build an Express app for integration tests. Differs from the production
// server only in one place: an extra middleware up front that reads
// X-Test-User-Id and populates req.user from the DB, simulating what F-02's
// session deserialisation will do in production. The production server
// (server/index.ts) never reads this header; it's only mounted here.
//
// Tests set the header on each request to exercise requireAuth / requireRole.
// Omitting it produces a 401 (no req.user set), which is the correct answer.
export async function buildTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json());

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

  await registerRoutes(createServer(), app);
  app.use(errorMiddleware);

  return app;
}
