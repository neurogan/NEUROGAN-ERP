import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import type { UserRole } from "@shared/schema";
import { ncTypeEnum, ncSeverityEnum, ncStatusEnum, capaTypeEnum } from "@shared/schema";
import * as schema from "@shared/schema";
import * as capaStorage from "../storage/capa";
import { performSignature } from "../signatures/signatures";
import { db } from "../db";

async function fetchSig(entityType: string, entityId: string, requestId: string | string[]) {
  const rid = Array.isArray(requestId) ? requestId[0] : requestId;
  const [sig] = await db
    .select({ id: schema.electronicSignatures.id })
    .from(schema.electronicSignatures)
    .where(and(
      eq(schema.electronicSignatures.entityType, entityType),
      eq(schema.electronicSignatures.entityId, entityId),
      eq(schema.electronicSignatures.requestId, rid),
    ))
    .orderBy(desc(schema.electronicSignatures.signedAt))
    .limit(1);
  return sig?.id ?? null;
}

export function registerCapaRoutes(
  app: Express,
  requireAuth: RequestHandler,
  requireRole: (...roles: readonly UserRole[]) => RequestHandler,
): void {

  // ─── Nonconformances ────────────────────────────────────────────────────────

  app.get("/api/quality/capa/nonconformances", requireAuth, async (req, res, next) => {
    try {
      const status = req.query.status as string | undefined;
      const type = req.query.type as string | undefined;
      const severity = req.query.severity as string | undefined;
      const ncs = await capaStorage.listNonconformances({
        status: status ? ncStatusEnum.parse(status) : undefined,
        type: type ? ncTypeEnum.parse(type) : undefined,
        severity: severity ? ncSeverityEnum.parse(severity) : undefined,
      });
      return res.json(ncs);
    } catch (err) { next(err); }
  });

  app.post("/api/quality/capa/nonconformances", requireAuth, async (req, res, next) => {
    try {
      const body = z.object({
        type: ncTypeEnum,
        severity: ncSeverityEnum,
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        sourceType: z.string().optional(),
        sourceId: z.string().optional(),
      }).parse(req.body);

      const nc = await capaStorage.createNonconformance({
        ...body,
        createdByUserId: req.user!.id,
        requestId: req.requestId,
        route: req.path,
      });
      return res.status(201).json(nc);
    } catch (err) { next(err); }
  });

  app.get<{ id: string }>("/api/quality/capa/nonconformances/:id", requireAuth, async (req, res, next) => {
    try {
      const nc = await capaStorage.getNonconformance(req.params.id);
      return res.json(nc);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string }>("/api/quality/capa/nonconformances/:id/status", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { status } = z.object({ status: ncStatusEnum }).parse(req.body);
      const nc = await capaStorage.transitionNcStatus({
        id: req.params.id, status,
        userId: req.user!.id, requestId: req.requestId, route: req.path,
      });
      return res.json(nc);
    } catch (err) { next(err); }
  });

  // ─── CAPAs ──────────────────────────────────────────────────────────────────

  app.get("/api/quality/capa/capas", requireAuth, async (req, res, next) => {
    try {
      const status = req.query.status as schema.CapaStatus | undefined;
      const capas = await capaStorage.listCapas({ status });
      return res.json(capas);
    } catch (err) { next(err); }
  });

  app.post("/api/quality/capa/capas", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = z.object({
        ncId: z.string().uuid(),
        capaType: capaTypeEnum,
        rootCause: z.string().min(1),
        password: z.string().min(1),
        commentary: z.string().optional(),
      }).parse(req.body);

      let createdCapaId = "";

      await performSignature(
        {
          userId: req.user!.id, password: body.password, meaning: "CAPA_OPEN",
          entityType: "capa", entityId: body.ncId,
          commentary: body.commentary ?? null,
          recordSnapshot: { ncId: body.ncId, capaType: body.capaType },
          route: `${req.method} ${req.path}`, requestId: req.requestId,
        },
        async (tx) => {
          const capa = await capaStorage.openCapaInTx(
            { ncId: body.ncId, capaType: body.capaType, rootCause: body.rootCause, openedByUserId: req.user!.id, requestId: req.requestId, route: req.path },
            tx,
          );
          createdCapaId = capa.id;
          return capa;
        },
      );

      const sigId = await fetchSig("capa", body.ncId, req.requestId);
      const capa = sigId ? await capaStorage.finalizeCapaOpen(createdCapaId, sigId) : await capaStorage.getCapa(createdCapaId);
      return res.status(201).json(capa);
    } catch (err) { next(err); }
  });

  app.get<{ id: string }>("/api/quality/capa/capas/:id", requireAuth, async (req, res, next) => {
    try {
      const capa = await capaStorage.getCapa(req.params.id);
      return res.json(capa);
    } catch (err) { next(err); }
  });

  app.post<{ id: string }>("/api/quality/capa/capas/:id/close", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = z.object({
        password: z.string().min(1),
        commentary: z.string().optional(),
      }).parse(req.body);

      await performSignature(
        {
          userId: req.user!.id, password: body.password, meaning: "CAPA_CLOSE",
          entityType: "capa", entityId: req.params.id,
          commentary: body.commentary ?? null,
          recordSnapshot: { capaId: req.params.id },
          route: `${req.method} ${req.path}`, requestId: req.requestId,
        },
        async (tx) => capaStorage.closeCapaInTx(
          { id: req.params.id, closedByUserId: req.user!.id, requestId: req.requestId, route: req.path },
          tx,
        ),
      );

      const sigId = await fetchSig("capa", req.params.id, req.requestId);
      const capa = sigId
        ? await capaStorage.finalizeCapaClose(req.params.id, sigId)
        : await capaStorage.getCapa(req.params.id);
      return res.json(capa);
    } catch (err) { next(err); }
  });

  // ─── CAPA Actions ────────────────────────────────────────────────────────────

  app.post<{ id: string }>("/api/quality/capa/capas/:id/actions", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = z.object({
        description: z.string().min(1),
        assignedToUserId: z.string().uuid().optional(),
        dueAt: z.string().datetime({ offset: true }).optional(),
      }).parse(req.body);

      const action = await capaStorage.addCapaAction({
        capaId: req.params.id, ...body,
        createdByUserId: req.user!.id, requestId: req.requestId, route: req.path,
      });
      return res.status(201).json(action);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string; actionId: string }>("/api/quality/capa/capas/:id/actions/:actionId/complete", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const action = await capaStorage.completeCapaAction({
        capaId: req.params.id, actionId: req.params.actionId,
        completedByUserId: req.user!.id, requestId: req.requestId, route: req.path,
      });
      return res.json(action);
    } catch (err) { next(err); }
  });

  // ─── Effectiveness Checks ────────────────────────────────────────────────────

  app.post<{ id: string }>("/api/quality/capa/capas/:id/effectiveness-checks", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = z.object({
        scheduledAt: z.string().datetime({ offset: true }),
      }).parse(req.body);

      const check = await capaStorage.scheduleEffectivenessCheck({
        capaId: req.params.id, scheduledAt: body.scheduledAt,
        createdByUserId: req.user!.id, requestId: req.requestId, route: req.path,
      });
      return res.status(201).json(check);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string; checkId: string }>("/api/quality/capa/capas/:id/effectiveness-checks/:checkId", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = z.object({
        result: z.enum(["EFFECTIVE", "NOT_EFFECTIVE"]),
        notes: z.string().optional(),
        password: z.string().min(1),
        commentary: z.string().optional(),
      }).parse(req.body);

      await performSignature(
        {
          userId: req.user!.id, password: body.password, meaning: "CAPA_CLOSE",
          entityType: "capa_effectiveness_check", entityId: req.params.checkId,
          commentary: body.commentary ?? null,
          recordSnapshot: { result: body.result },
          route: `${req.method} ${req.path}`, requestId: req.requestId,
        },
        async (tx) => capaStorage.recordEffectivenessResultInTx(
          { capaId: req.params.id, checkId: req.params.checkId, result: body.result, notes: body.notes, performedByUserId: req.user!.id, requestId: req.requestId, route: req.path },
          tx,
        ),
      );

      const sigId = await fetchSig("capa_effectiveness_check", req.params.checkId, req.requestId);
      const check = sigId
        ? await capaStorage.finalizeEffectivenessCheck(req.params.checkId, sigId)
        : (await db.select().from(schema.capaEffectivenessChecks).where(eq(schema.capaEffectivenessChecks.id, req.params.checkId)))[0];
      return res.json(check);
    } catch (err) { next(err); }
  });

  // ─── Management Reviews ──────────────────────────────────────────────────────

  app.get("/api/quality/capa/management-reviews", requireAuth, async (req, res, next) => {
    try {
      return res.json(await capaStorage.listManagementReviews());
    } catch (err) { next(err); }
  });

  app.get<{ id: string }>("/api/quality/capa/management-reviews/:id", requireAuth, async (req, res, next) => {
    try {
      return res.json(await capaStorage.getManagementReview(req.params.id));
    } catch (err) { next(err); }
  });

  app.post("/api/quality/capa/management-reviews", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = z.object({
        period: z.string().min(1),
        reviewedAt: z.string().datetime({ offset: true }),
        summary: z.string().min(1),
        outcome: z.enum(["SATISFACTORY", "REQUIRES_ACTION"]),
        capaIds: z.array(z.string().uuid()),
        password: z.string().min(1),
        commentary: z.string().optional(),
      }).parse(req.body);

      let createdReviewId = "";

      await performSignature(
        {
          userId: req.user!.id, password: body.password, meaning: "MANAGEMENT_REVIEW",
          entityType: "management_review", entityId: "new",
          commentary: body.commentary ?? null,
          recordSnapshot: { period: body.period, outcome: body.outcome },
          route: `${req.method} ${req.path}`, requestId: req.requestId,
        },
        async (tx) => {
          const review = await capaStorage.createManagementReviewInTx(
            { period: body.period, reviewedAt: body.reviewedAt, summary: body.summary, outcome: body.outcome, capaIds: body.capaIds, createdByUserId: req.user!.id, requestId: req.requestId, route: req.path },
            tx,
          );
          createdReviewId = review.id;
          return review;
        },
      );

      const sigId = await fetchSig("management_review", "new", req.requestId);
      const review = sigId
        ? await capaStorage.finalizeManagementReview(createdReviewId, sigId)
        : await capaStorage.getManagementReview(createdReviewId);
      return res.status(201).json(review);
    } catch (err) { next(err); }
  });
}
