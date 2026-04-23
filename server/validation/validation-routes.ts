// F-10: Validation document API endpoints.
//
// GET  /api/validation-documents         — list all docs (no content), QA + ADMIN
// GET  /api/validation-documents/:id     — full doc + signature, QA + ADMIN
// POST /api/validation-documents/:id/sign — sign a document (e-sig ceremony)
// GET  /api/validation-documents/:id/signature — return signature row, or 404

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware";
import { errors } from "../errors";
import {
  listValidationDocuments,
  getValidationDocument,
  signValidationDocument,
} from "../storage/validation-documents";

const router = Router();

// ─── GET /api/validation-documents ───────────────────────────────────────────

router.get(
  "/",
  requireRole("QA", "ADMIN"),
  async (req, res, next) => {
    try {
      const docs = await listValidationDocuments();
      return res.json(docs);
    } catch (err) {
      return next(err);
    }
  },
);

// ─── GET /api/validation-documents/:id ───────────────────────────────────────

router.get<{ id: string }>(
  "/:id",
  requireRole("QA", "ADMIN"),
  async (req, res, next) => {
    try {
      const doc = await getValidationDocument(req.params.id);
      if (!doc) return next(errors.notFound("Validation document"));
      return res.json(doc);
    } catch (err) {
      return next(err);
    }
  },
);

// ─── POST /api/validation-documents/:id/sign ─────────────────────────────────

const signBodySchema = z.object({
  password:   z.string().min(1),
  commentary: z.string().optional(),
});

router.post<{ id: string }>(
  "/:id/sign",
  requireRole("QA", "ADMIN"),
  async (req, res, next) => {
    try {
      const body = signBodySchema.parse(req.body);
      const { password, commentary } = body;

      const doc = await signValidationDocument(req.params.id, {
        userId:         req.user!.id,
        password,
        meaning:        "APPROVED",
        entityType:     "validation_document",
        entityId:       req.params.id,
        commentary:     commentary ?? null,
        recordSnapshot: { docId: req.params.id },
        route:          `${req.method} ${req.path}`,
        requestId:      req.requestId,
      });

      return res.json(doc);
    } catch (err) {
      return next(err);
    }
  },
);

// ─── GET /api/validation-documents/:id/signature ─────────────────────────────

router.get<{ id: string }>(
  "/:id/signature",
  requireRole("QA", "ADMIN"),
  async (req, res, next) => {
    try {
      const doc = await getValidationDocument(req.params.id);
      if (!doc) return next(errors.notFound("Validation document"));
      if (!doc.signature) return next(errors.notFound("Signature"));
      return res.json(doc.signature);
    } catch (err) {
      return next(err);
    }
  },
);

export { router as validationRouter };
