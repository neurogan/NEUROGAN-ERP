import type { Express, RequestHandler } from "express";
import { z } from "zod";
import type { UserRole } from "@shared/schema";
import { emSiteTypeEnum, emFrequencyEnum } from "@shared/schema";
import * as emStorage from "../storage/em";

export function registerEmRoutes(
  app: Express,
  requireAuth: RequestHandler,
  requireRole: (...roles: readonly UserRole[]) => RequestHandler,
): void {

  // ─── Sites ──────────────────────────────────────────────────────────────────

  app.get("/api/em/sites", requireAuth, async (req, res, next) => {
    try {
      const includeInactive = req.query.includeInactive === "true";
      return res.json(await emStorage.listSites(includeInactive));
    } catch (e) { next(e); }
  });

  app.get("/api/em/sites/:id", requireAuth, async (req, res, next) => {
    try {
      return res.json(await emStorage.getSite(req.params["id"] as string));
    } catch (e) { next(e); }
  });

  app.post(
    "/api/em/sites",
    requireAuth,
    requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const body = z.object({
          name:     z.string().min(1),
          area:     z.string().min(1),
          siteType: emSiteTypeEnum,
        }).parse(req.body);

        const site = await emStorage.createSite({
          ...body,
          createdByUserId: req.user!.id,
          requestId:       res.locals.requestId,
          route:           req.path,
        });

        return res.status(201).json(site);
      } catch (e) { next(e); }
    },
  );

  // ─── Schedules ───────────────────────────────────────────────────────────────

  app.post(
    "/api/em/sites/:id/schedule",
    requireAuth,
    requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const siteId = req.params["id"] as string;
        const body = z.object({
          frequency:       emFrequencyEnum,
          organismTargets: z.array(z.string()).min(1),
        }).parse(req.body);

        const schedule = await emStorage.upsertSchedule({
          siteId,
          ...body,
          createdByUserId: req.user!.id,
        });

        return res.status(201).json(schedule);
      } catch (e) { next(e); }
    },
  );

  // ─── Limits ──────────────────────────────────────────────────────────────────

  app.post(
    "/api/em/sites/:id/limits",
    requireAuth,
    requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const siteId = req.params["id"] as string;
        const body = z.object({
          organism:    z.string().min(1),
          alertLimit:  z.string().nullable().optional(),
          actionLimit: z.string().nullable().optional(),
          unit:        z.string().default("CFU/m³"),
        }).parse(req.body);

        const limit = await emStorage.upsertLimit({
          siteId,
          organism:    body.organism,
          alertLimit:  body.alertLimit ?? null,
          actionLimit: body.actionLimit ?? null,
          unit:        body.unit,
          createdByUserId: req.user!.id,
        });

        return res.status(201).json(limit);
      } catch (e) { next(e); }
    },
  );

  // ─── Results ─────────────────────────────────────────────────────────────────

  app.get("/api/em/results", requireAuth, async (req, res, next) => {
    try {
      const siteId = typeof req.query.siteId === "string" ? req.query.siteId : undefined;
      const from   = typeof req.query.from   === "string" ? req.query.from   : undefined;
      const to     = typeof req.query.to     === "string" ? req.query.to     : undefined;
      const limit  = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      return res.json(await emStorage.listResults({ siteId, from, to, limit }));
    } catch (e) { next(e); }
  });

  app.post(
    "/api/em/results",
    requireAuth,
    requireRole("QA", "ADMIN", "LAB_TECH"),
    async (req, res, next) => {
      try {
        const body = z.object({
          siteId:      z.string().uuid(),
          sampledAt:   z.string().datetime(),
          organism:    z.string().min(1),
          cfuCount:    z.string().nullable().optional(),
          isBelowLod:  z.boolean().default(false),
          testedByLab: z.string().nullable().optional(),
          notes:       z.string().nullable().optional(),
        }).parse(req.body);

        const result = await emStorage.enterResult({
          ...body,
          cfuCount:        body.cfuCount ?? null,
          enteredByUserId: req.user!.id,
          requestId:       res.locals.requestId,
          route:           req.path,
        });

        return res.status(201).json(result);
      } catch (e) { next(e); }
    },
  );

  // ─── Dashboard ────────────────────────────────────────────────────────────────

  app.get("/api/em/dashboard/due", requireAuth, async (req, res, next) => {
    try {
      return res.json(await emStorage.getDueSites());
    } catch (e) { next(e); }
  });

  app.get("/api/em/dashboard/excursions", requireAuth, async (req, res, next) => {
    try {
      return res.json(await emStorage.listRecentExcursions());
    } catch (e) { next(e); }
  });

  // ─── Trend ───────────────────────────────────────────────────────────────────

  app.get("/api/em/sites/:id/trend", requireAuth, async (req, res, next) => {
    try {
      const months = req.query.months ? parseInt(req.query.months as string, 10) : 12;
      return res.json(await emStorage.getSiteTrend(req.params["id"] as string, months));
    } catch (e) { next(e); }
  });
}
