import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { UserRole } from "@shared/schema";
import * as schema from "@shared/schema";
import * as stabilityStorage from "../storage/stability";
import { performSignature } from "../signatures/signatures";
import { db } from "../db";

export function registerStabilityRoutes(
  app: Express,
  requireAuth: RequestHandler,
  requireRole: (...roles: readonly UserRole[]) => RequestHandler,
): void {

  // ─── Protocols ─────────────────────────────────────────────────────────────

  app.get("/api/stability/protocols", requireAuth, async (req, res, next) => {
    try {
      const includeInactive = req.query.includeInactive === "true";
      return res.json(await stabilityStorage.listProtocols(includeInactive));
    } catch (e) { next(e); }
  });

  app.get("/api/stability/protocols/:id", requireAuth, async (req, res, next) => {
    try {
      return res.json(await stabilityStorage.getProtocol(req.params["id"] as string));
    } catch (e) { next(e); }
  });

  app.post(
    "/api/stability/protocols",
    requireAuth,
    requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const body = z.object({
          name:                z.string().min(1),
          productId:           z.string().uuid().nullable().optional(),
          description:         z.string().nullable().optional(),
          storageCondition:    z.string().min(1),
          testIntervalsMonths: z.array(z.number().int().positive()).min(1),
          attributes:          z.array(z.object({
            analyteName: z.string().min(1),
            unit:        z.string().nullable().optional(),
            minSpec:     z.string().nullable().optional(),
            maxSpec:     z.string().nullable().optional(),
            testMethod:  z.string().nullable().optional(),
          })).min(1),
        }).parse(req.body);

        const protocol = await stabilityStorage.createProtocol({
          ...body,
          createdByUserId: req.user!.id,
          requestId:       res.locals.requestId,
          route:           req.path,
        });

        return res.status(201).json(protocol);
      } catch (e) { next(e); }
    },
  );

  // ─── Batches ────────────────────────────────────────────────────────────────

  app.get("/api/stability/batches", requireAuth, async (req, res, next) => {
    try {
      return res.json(await stabilityStorage.listBatches());
    } catch (e) { next(e); }
  });

  app.get("/api/stability/batches/:id", requireAuth, async (req, res, next) => {
    try {
      return res.json(await stabilityStorage.getBatch(req.params["id"] as string));
    } catch (e) { next(e); }
  });

  app.post(
    "/api/stability/batches",
    requireAuth,
    requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const body = z.object({
          protocolId: z.string().uuid(),
          bprId:      z.string().min(1),
          enrolledAt: z.string().datetime(),
        }).parse(req.body);

        const batch = await stabilityStorage.enrollBatch({
          ...body,
          enrolledByUserId: req.user!.id,
          requestId:        res.locals.requestId,
          route:            req.path,
        });

        return res.status(201).json(batch);
      } catch (e) { next(e); }
    },
  );

  // ─── Results ────────────────────────────────────────────────────────────────

  app.post(
    "/api/stability/timepoints/:timepointId/results",
    requireAuth,
    requireRole("QA", "ADMIN", "LAB_TECH"),
    async (req, res, next) => {
      try {
        const timepointId = req.params["timepointId"] as string;
        const body = z.object({
          results: z.array(z.object({
            attributeId:   z.string().uuid(),
            reportedValue: z.string(),
            reportedUnit:  z.string().min(1),
            passFail:      z.enum(["PASS", "FAIL"]),
            notes:         z.string().nullable().optional(),
          })).min(1),
        }).parse(req.body);

        const rows = await db.transaction(async (tx) =>
          stabilityStorage.enterResultsInTx({
            timepointId: timepointId!,
            results:     body.results,
            enteredByUserId: req.user!.id,
            requestId:   res.locals.requestId,
            route:       req.path,
          }, tx),
        );

        return res.status(201).json(rows);
      } catch (e) { next(e); }
    },
  );

  // ─── Conclusions (Part-11 signed) ────────────────────────────────────────

  app.post(
    "/api/stability/batches/:batchId/conclude",
    requireAuth,
    requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const batchId = req.params["batchId"] as string;
        const body = z.object({
          supportedShelfLifeMonths: z.number().int().positive(),
          basis:    z.string().min(1),
          outcome:  z.string().min(1),
          password: z.string().min(1),
          commentary: z.string().optional(),
        }).parse(req.body);

        const snapshot = await stabilityStorage.getBatch(batchId!);

        const conclusion = await performSignature<schema.StabilityConclusion>(
          {
            userId:         req.user!.id,
            password:       body.password,
            meaning:        "STABILITY_CONCLUSION",
            entityType:     "stability_batch",
            entityId:       batchId!,
            commentary:     body.commentary ?? null,
            recordSnapshot: snapshot,
            route:          req.path,
            requestId:      res.locals.requestId,
          },
          async (tx) =>
            stabilityStorage.concludeBatchInTx(
              {
                batchId:                  batchId!,
                supportedShelfLifeMonths: body.supportedShelfLifeMonths,
                basis:                    body.basis,
                outcome:                  body.outcome,
                concludedByUserId:        req.user!.id,
              },
              tx,
            ),
        );

        // Link the signature row to the conclusion
        const [sigRow] = await db
          .select()
          .from(schema.electronicSignatures)
          .where(eq(schema.electronicSignatures.requestId, res.locals.requestId))
          .limit(1);

        if (sigRow) {
          await stabilityStorage.finalizeConclusionSignature(conclusion.id, sigRow.id);
        }

        return res.status(201).json(conclusion);
      } catch (e) { next(e); }
    },
  );

  // ─── Dashboard: overdue / upcoming ──────────────────────────────────────

  app.get("/api/stability/dashboard/overdue", requireAuth, async (req, res, next) => {
    try {
      return res.json(await stabilityStorage.getOverdueTimepoints());
    } catch (e) { next(e); }
  });

  app.get("/api/stability/dashboard/upcoming", requireAuth, async (req, res, next) => {
    try {
      return res.json(await stabilityStorage.getUpcomingTimepoints());
    } catch (e) { next(e); }
  });
}
