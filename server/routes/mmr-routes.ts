import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware";
import { errors } from "../errors";
import { performSignature } from "../signatures/signatures";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  listMmrs,
  getMmr,
  getMmrByProduct,
  createMmr,
  updateMmr,
  addMmrStep,
  updateMmrStep,
  deleteMmrStep,
  reorderMmrSteps,
  approveMmr,
  reviseMmr,
} from "../storage/mmr";

const router = Router();

// GET /api/mmrs — list all MMRs (optionally filtered by productId and/or status)
router.get("/", async (req, res, next) => {
  try {
    const { productId, status } = req.query as { productId?: string; status?: string };
    if (productId) {
      const mmrStatus = status as schema.MmrStatus | undefined;
      const mmr = await getMmrByProduct(productId, mmrStatus);
      return res.json(mmr ? [mmr] : []);
    }
    const mmrs = await listMmrs();
    return res.json(mmrs);
  } catch (err) {
    return next(err);
  }
});

// POST /api/mmrs — create new DRAFT MMR
router.post("/", requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
  try {
    const body = z.object({
      productId: z.string(),
      recipeId: z.string(),
      notes: z.string().optional(),
    }).parse(req.body);
    const mmr = await createMmr({ ...body, createdByUserId: req.user!.id });
    return res.status(201).json(mmr);
  } catch (err) {
    return next(err);
  }
});

// GET /api/mmrs/:id — get single MMR with steps
router.get<{ id: string }>("/:id", async (req, res, next) => {
  try {
    const mmr = await getMmr(req.params.id);
    if (!mmr) return next(errors.notFound("MMR"));
    return res.json(mmr);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/mmrs/:id — update yield thresholds / notes (DRAFT only)
router.patch<{ id: string }>("/:id", requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
  try {
    const existing = await getMmr(req.params.id);
    if (!existing) return next(errors.notFound("MMR"));
    if (existing.status !== "DRAFT") {
      return next(errors.forbidden("MMR is not in DRAFT status"));
    }
    const body = z.object({
      yieldMinThreshold: z.string().nullable().optional(),
      yieldMaxThreshold: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(req.body);
    const updated = await updateMmr(req.params.id, body);
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
});

// POST /api/mmrs/:id/approve — signature ceremony — approve MMR
router.post<{ id: string }>("/:id/approve", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const { password, commentary } = req.body as { password?: string; commentary?: string };
    if (!password) return res.status(400).json({ message: "password required for electronic signature" });

    const existing = await getMmr(req.params.id);
    if (!existing) return next(errors.notFound("MMR"));
    if (existing.status !== "DRAFT") {
      return res.status(400).json({ message: "Only DRAFT MMRs can be approved" });
    }
    // 21 CFR Part 111 §111.260: approver must be different from creator
    if (existing.createdByUserId === req.user!.id) {
      return res.status(400).json({ message: "Approver cannot be the same person who created the MMR (21 CFR Part 111 §111.260)" });
    }

    // Perform electronic signature ceremony — updates MMR status inside the same transaction
    await performSignature(
      {
        userId: req.user!.id,
        password,
        meaning: "MMR_APPROVAL",
        entityType: "mmr",
        entityId: req.params.id,
        commentary: commentary ?? null,
        recordSnapshot: { mmrId: req.params.id, version: existing.version, productId: existing.productId },
        route: `${req.method} ${req.path}`,
        requestId: req.requestId,
      },
      async (tx) => {
        await tx
          .update(schema.mmrs)
          .set({ status: "APPROVED", approvedByUserId: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.mmrs.id, req.params.id));
      },
    );

    // After transaction commits, find signature row by entityId and link it
    const [sigRow] = await db
      .select({ id: schema.electronicSignatures.id })
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, req.params.id))
      .orderBy(schema.electronicSignatures.signedAt)
      .limit(1);

    if (sigRow) {
      await approveMmr(req.params.id, { approvedByUserId: req.user!.id, signatureId: sigRow.id });
    }

    const mmr = await getMmr(req.params.id);
    return res.json(mmr);
  } catch (err) {
    return next(err);
  }
});

// POST /api/mmrs/:id/revise — create new DRAFT v+1, current → SUPERSEDED
router.post<{ id: string }>("/:id/revise", requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
  try {
    const existing = await getMmr(req.params.id);
    if (!existing) return next(errors.notFound("MMR"));
    if (existing.status !== "APPROVED") {
      return res.status(400).json({ message: "Only APPROVED MMRs can be revised" });
    }
    const newMmr = await reviseMmr(req.params.id, req.user!.id);
    return res.status(201).json(newMmr);
  } catch (err) {
    return next(err);
  }
});

// ─── MMR Steps ────────────────────────────────────────────────────────────────

// GET /api/mmrs/:id/steps
router.get<{ id: string }>("/:id/steps", async (req, res, next) => {
  try {
    const mmr = await getMmr(req.params.id);
    if (!mmr) return next(errors.notFound("MMR"));
    return res.json(mmr.steps);
  } catch (err) {
    return next(err);
  }
});

// POST /api/mmrs/:id/steps/reorder must come BEFORE /:id/steps/:stepId to avoid routing conflict
// POST /api/mmrs/:id/steps/reorder — update step_number ordering (DRAFT only)
router.post<{ id: string }>("/:id/steps/reorder", requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
  try {
    const mmr = await getMmr(req.params.id);
    if (!mmr) return next(errors.notFound("MMR"));
    if (mmr.status !== "DRAFT") return res.status(400).json({ message: "MMR is not in DRAFT status" });
    const { stepIds } = z.object({ stepIds: z.array(z.string().uuid()) }).parse(req.body);
    await reorderMmrSteps(req.params.id, stepIds);
    const updated = await getMmr(req.params.id);
    return res.json(updated?.steps ?? []);
  } catch (err) {
    return next(err);
  }
});

// POST /api/mmrs/:id/steps — add step (DRAFT only)
router.post<{ id: string }>("/:id/steps", requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
  try {
    const mmr = await getMmr(req.params.id);
    if (!mmr) return next(errors.notFound("MMR"));
    if (mmr.status !== "DRAFT") return res.status(400).json({ message: "MMR is not in DRAFT status" });
    const body = z.object({
      stepNumber: z.number().int().positive(),
      description: z.string().min(1),
      equipmentIds: z.array(z.string().uuid()).optional().default([]),
      criticalParams: z.string().nullable().optional(),
      sopReference: z.string().nullable().optional(),
    }).parse(req.body);
    const step = await addMmrStep(req.params.id, body);
    return res.status(201).json(step);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/mmrs/:id/steps/:stepId — update step (DRAFT only)
router.patch<{ id: string; stepId: string }>("/:id/steps/:stepId", requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
  try {
    const mmr = await getMmr(req.params.id);
    if (!mmr) return next(errors.notFound("MMR"));
    if (mmr.status !== "DRAFT") return res.status(400).json({ message: "MMR is not in DRAFT status" });
    const body = z.object({
      stepNumber: z.number().int().positive().optional(),
      description: z.string().min(1).optional(),
      equipmentIds: z.array(z.string().uuid()).optional(),
      criticalParams: z.string().nullable().optional(),
      sopReference: z.string().nullable().optional(),
    }).parse(req.body);
    const step = await updateMmrStep(req.params.stepId, body);
    return res.json(step);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/mmrs/:id/steps/:stepId — delete step (DRAFT only)
router.delete<{ id: string; stepId: string }>("/:id/steps/:stepId", requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
  try {
    const mmr = await getMmr(req.params.id);
    if (!mmr) return next(errors.notFound("MMR"));
    if (mmr.status !== "DRAFT") return res.status(400).json({ message: "MMR is not in DRAFT status" });
    await deleteMmrStep(req.params.stepId);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export { router as mmrRouter };
