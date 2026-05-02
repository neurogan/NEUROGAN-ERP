import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import type { UserRole } from "@shared/schema";
import { userRoleEnum } from "@shared/schema";
import * as schema from "@shared/schema";
import * as trainingStorage from "../storage/training";
import { performSignature } from "../signatures/signatures";
import { db } from "../db";

export function registerTrainingRoutes(
  app: Express,
  requireAuth: RequestHandler,
  requireRole: (...roles: readonly UserRole[]) => RequestHandler,
): void {

  // ─── Programs ────────────────────────────────────────────────────────────

  app.get("/api/training/programs", requireAuth, async (req, res, next) => {
    try {
      const includeInactive = req.query.includeInactive === "true";
      return res.json(await trainingStorage.listPrograms(includeInactive));
    } catch (err) { next(err); }
  });

  app.post("/api/training/programs", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = z.object({
        name:             z.string().min(1).max(255),
        version:          z.string().min(1).max(50).default("1.0"),
        description:      z.string().optional(),
        validityDays:     z.number().int().min(1).max(3650),
        requiredForRoles: z.array(userRoleEnum).default([]),
        documentUrl:      z.string().url().optional(),
      }).parse(req.body);

      const prog = await trainingStorage.createProgram({
        ...body,
        createdByUserId: req.user!.id,
        requestId:       req.requestId,
        route:           req.path,
      });
      return res.status(201).json(prog);
    } catch (err) { next(err); }
  });

  app.get<{ id: string }>("/api/training/programs/:id", requireAuth, async (req, res, next) => {
    try {
      return res.json(await trainingStorage.getProgram(req.params.id));
    } catch (err) { next(err); }
  });

  // ─── Records ─────────────────────────────────────────────────────────────

  app.get("/api/training/records", requireAuth, async (req, res, next) => {
    try {
      const userId = req.query.userId as string | undefined;
      // non-QA/ADMIN can only see their own records
      const canSeeAll = req.user!.roles.some((r) => r === "QA" || r === "ADMIN");
      const targetUserId = canSeeAll ? userId : req.user!.id;
      return res.json(await trainingStorage.listRecords(targetUserId));
    } catch (err) { next(err); }
  });

  // Record completed training with Part-11 acknowledgement (trainee signs)
  app.post("/api/training/records", requireAuth, async (req, res, next) => {
    try {
      const body = z.object({
        userId:            z.string().uuid().optional(),
        programId:         z.string().uuid(),
        completedAt:       z.string().datetime({ offset: true }),
        trainedByUserId:   z.string().uuid().optional(),
        trainedByExternal: z.string().max(255).optional(),
        documentUrl:       z.string().url().optional(),
        notes:             z.string().optional(),
        password:          z.string().min(1),
        commentary:        z.string().optional(),
      }).parse(req.body);

      // Non-QA/ADMIN can only record training for themselves
      const canRecordForOthers = req.user!.roles.some((r) => r === "QA" || r === "ADMIN");
      const targetUserId = body.userId && canRecordForOthers ? body.userId : req.user!.id;

      let createdRecordId = "";

      await performSignature(
        {
          userId:         req.user!.id,
          password:       body.password,
          meaning:        "TRAINING_COMPLETE",
          entityType:     "training_record",
          entityId:       body.programId,
          commentary:     body.commentary ?? null,
          recordSnapshot: { programId: body.programId, targetUserId, completedAt: body.completedAt },
          route:          `${req.method} ${req.path}`,
          requestId:      req.requestId,
        },
        async (tx) => {
          const record = await trainingStorage.recordTrainingInTx(
            {
              userId:            targetUserId,
              programId:         body.programId,
              completedAt:       body.completedAt,
              trainedByUserId:   body.trainedByUserId,
              trainedByExternal: body.trainedByExternal,
              documentUrl:       body.documentUrl,
              notes:             body.notes,
              createdByUserId:   req.user!.id,
              requestId:         req.requestId,
              route:             req.path,
            },
            tx,
          );
          createdRecordId = record.id;
          return record;
        },
      );

      // Fetch sig row by entityId=programId + requestId
      const rid = Array.isArray(req.requestId) ? req.requestId[0] : req.requestId;
      const [sig] = await db
        .select({ id: schema.electronicSignatures.id })
        .from(schema.electronicSignatures)
        .where(eq(schema.electronicSignatures.requestId, rid))
        .orderBy(desc(schema.electronicSignatures.signedAt))
        .limit(1);

      const record = sig?.id
        ? await trainingStorage.finalizeTrainingRecord(createdRecordId, sig.id)
        : (await db.select().from(schema.trainingRecords).where(eq(schema.trainingRecords.id, createdRecordId)))[0];

      return res.status(201).json(record);
    } catch (err) { next(err); }
  });

  // ─── Assignments ─────────────────────────────────────────────────────────

  app.get("/api/training/assignments", requireAuth, async (req, res, next) => {
    try {
      const userId = req.query.userId as string | undefined;
      const canSeeAll = req.user!.roles.some((r) => r === "QA" || r === "ADMIN");
      const targetUserId = canSeeAll ? userId : req.user!.id;
      return res.json(await trainingStorage.listAssignments(targetUserId));
    } catch (err) { next(err); }
  });

  app.post("/api/training/assignments", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = z.object({
        userId:    z.string().uuid(),
        programId: z.string().uuid(),
        dueAt:     z.string().datetime({ offset: true }),
      }).parse(req.body);

      const assignment = await trainingStorage.createAssignment({
        ...body,
        createdByUserId: req.user!.id,
        requestId:       req.requestId,
        route:           req.path,
      });
      return res.status(201).json(assignment);
    } catch (err) { next(err); }
  });

  // ─── Compliance ──────────────────────────────────────────────────────────

  app.get("/api/training/compliance", requireAuth, async (req, res, next) => {
    try {
      const userId = req.query.userId as string | undefined;
      const canSeeAll = req.user!.roles.some((r) => r === "QA" || r === "ADMIN");

      if (userId && !canSeeAll) {
        // Non-QA/ADMIN can only see their own compliance
        if (userId !== req.user!.id) {
          return res.status(403).json({ error: { code: "FORBIDDEN", message: "Cannot view another user's compliance." } });
        }
      }

      if (!userId || !canSeeAll) {
        return res.json(await trainingStorage.getUserTrainingCompliance(req.user!.id));
      }

      if (userId === "all") {
        return res.json(await trainingStorage.getAllUsersCompliance());
      }

      return res.json(await trainingStorage.getUserTrainingCompliance(userId));
    } catch (err) { next(err); }
  });
}
