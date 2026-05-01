import type { Express, RequestHandler } from "express";
import { z } from "zod";
import type { UserRole } from "@shared/schema";
import {
  enterFgQcTest,
  listFgQcTests,
  deleteFgQcTest,
} from "../storage/finished-goods-tests";
import { errors as _errors } from "../errors";

const enterTestBody = z.object({
  labId: z.string().uuid(),
  sampleReference: z.string().optional().nullable(),
  testedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coaDocumentId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  results: z
    .array(
      z.object({
        specAttributeId: z.string().uuid(),
        reportedValue: z.string(),
        reportedUnit: z.string(),
      }),
    )
    .min(1),
});

export function registerFgTestRoutes(
  app: Express,
  requireAuth: RequestHandler,
  requireRole: (...roles: readonly UserRole[]) => RequestHandler,
): void {
  // GET /api/batch-production-records/:bprId/finished-goods-tests — list tests for BPR
  app.get<{ bprId: string }>(
    "/api/batch-production-records/:bprId/finished-goods-tests",
    requireAuth,
    requireRole("LAB_TECH", "QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const tests = await listFgQcTests(req.params.bprId);
        return res.json(tests);
      } catch (err) {
        return next(err);
      }
    },
  );

  // POST /api/batch-production-records/:bprId/finished-goods-tests — enter test
  app.post<{ bprId: string }>(
    "/api/batch-production-records/:bprId/finished-goods-tests",
    requireAuth,
    requireRole("LAB_TECH", "QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const body = enterTestBody.parse(req.body);
        const test = await enterFgQcTest(req.params.bprId, req.user!.id, body);
        return res.status(201).json(test);
      } catch (err) {
        return next(err);
      }
    },
  );

  // DELETE /api/finished-goods-tests/:testId — ADMIN only
  app.delete<{ testId: string }>(
    "/api/finished-goods-tests/:testId",
    requireAuth,
    requireRole("ADMIN"),
    async (req, res, next) => {
      try {
        await deleteFgQcTest(req.params.testId);
        return res.status(204).send();
      } catch (err) {
        return next(err);
      }
    },
  );
}
