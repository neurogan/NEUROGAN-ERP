// F-03: Audit trail API endpoints.
//
// GET /api/audit      — cursor-paginated list, ADMIN + QA.
// GET /api/audit/export — NDJSON stream of all matching rows, ADMIN only
//                         (§11.10(e) periodic QA review export).

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware";
import { storage } from "../storage";
import { errors } from "../errors";

const router = Router();

const listQuerySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

// GET /api/audit — ADMIN, QA
router.get("/", requireRole("ADMIN", "QA"), async (req, res, next) => {
  try {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) return next(errors.validation("Invalid query parameters", query.error.flatten().fieldErrors as Record<string, unknown>));

    const { entityType, entityId, userId, action, from, to, limit, cursor } = query.data;
    const { rows, nextCursor } = await storage.listAuditRows(
      {
        entityType,
        entityId,
        userId,
        action,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
      cursor,
      limit,
    );

    return res.json({ rows, nextCursor });
  } catch (err) {
    return next(err);
  }
});

// GET /api/audit/export — ADMIN only, NDJSON stream
router.get("/export", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const query = listQuerySchema.omit({ limit: true, cursor: true }).safeParse(req.query);
    if (!query.success) return next(errors.validation("Invalid query parameters", query.error.flatten().fieldErrors as Record<string, unknown>));

    const { entityType, entityId, userId, action, from, to } = query.data;

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.ndjson"`,
    );

    let cursor: string | undefined;
    let keepGoing = true;

    while (keepGoing) {
      const { rows, nextCursor } = await storage.listAuditRows(
        {
          entityType,
          entityId,
          userId,
          action,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        },
        cursor,
        200,
      );

      for (const row of rows) {
        res.write(JSON.stringify(row) + "\n");
      }

      if (!nextCursor) {
        keepGoing = false;
      } else {
        cursor = nextCursor;
      }
    }

    res.end();
  } catch (err) {
    return next(err);
  }
});

export { router as auditRouter };
