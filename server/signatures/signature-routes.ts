// F-04: Signature read endpoints.
//
// GET /api/signatures?entityType=&entityId= — ADMIN, QA.
// Signature creation is never a standalone HTTP call; it always happens
// inside the regulated endpoint that advances record state.

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware";
import { storage } from "../storage";
import { errors } from "../errors";

const router = Router();

const listQuerySchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
});

router.get("/", requireRole("ADMIN", "QA"), async (req, res, next) => {
  try {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      return next(errors.validation("entityType and entityId are required", query.error.flatten().fieldErrors as Record<string, unknown>));
    }
    const rows = await storage.listSignatures(query.data.entityType, query.data.entityId);
    return res.json({ rows });
  } catch (err) {
    return next(err);
  }
});

export { router as signatureRouter };
