import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware";
import { errors } from "../errors";
import { performSignature } from "../signatures/signatures";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import {
  listFgSpecs,
  getFgSpec,
  createFgSpec,
  createFgSpecVersion,
  addFgSpecAttribute,
  deleteFgSpecAttribute,
  approveFgSpecVersion,
} from "../storage/finished-goods-specs";

const router = Router();

// GET /api/finished-goods-specs — list all FG specs (QA, ADMIN, LAB_TECH)
router.get("/", requireRole("QA", "ADMIN", "LAB_TECH"), async (req, res, next) => {
  try {
    const specs = await listFgSpecs();
    return res.json(specs);
  } catch (err) {
    return next(err);
  }
});

// POST /api/finished-goods-specs — create spec header + v1 PENDING_APPROVAL version
router.post("/", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const body = z
      .object({
        productId: z.string(),
        name: z.string().min(1),
        description: z.string().nullable().optional(),
      })
      .parse(req.body);

    const spec = await createFgSpec(body.productId, req.user!.id, {
      name: body.name,
      description: body.description,
    });
    return res.status(201).json(spec);
  } catch (err) {
    return next(err);
  }
});

// GET /api/finished-goods-specs/:specId — get spec detail with versions
router.get<{ specId: string }>(
  "/:specId",
  requireRole("QA", "ADMIN", "LAB_TECH"),
  async (req, res, next) => {
    try {
      const spec = await getFgSpec(req.params.specId);
      if (!spec) return next(errors.notFound("FinishedGoodsSpec"));
      return res.json(spec);
    } catch (err) {
      return next(err);
    }
  },
);

// POST /api/finished-goods-specs/:specId/versions — create new PENDING_APPROVAL version
router.post<{ specId: string }>(
  "/:specId/versions",
  requireRole("QA", "ADMIN"),
  async (req, res, next) => {
    try {
      const spec = await getFgSpec(req.params.specId);
      if (!spec) return next(errors.notFound("FinishedGoodsSpec"));

      const version = await createFgSpecVersion(req.params.specId, req.user!.id);
      return res.status(201).json(version);
    } catch (err) {
      return next(err);
    }
  },
);

// POST /api/finished-goods-specs/:specId/versions/:vId/attributes — add attribute to PENDING_APPROVAL version
router.post<{ specId: string; vId: string }>(
  "/:specId/versions/:vId/attributes",
  requireRole("QA", "ADMIN"),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          analyte: z.string().min(1),
          category: schema.fgSpecAttributeCategoryEnum,
          targetValue: z.string().nullable().optional(),
          minValue: z.string().nullable().optional(),
          maxValue: z.string().nullable().optional(),
          unit: z.string().min(1),
          required: z.boolean().optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(req.body);

      const attribute = await addFgSpecAttribute(req.params.vId, body);
      return res.status(201).json(attribute);
    } catch (err) {
      return next(err);
    }
  },
);

// DELETE /api/finished-goods-specs/:specId/versions/:vId/attributes/:attrId — remove attribute (only PENDING_APPROVAL)
router.delete<{ specId: string; vId: string; attrId: string }>(
  "/:specId/versions/:vId/attributes/:attrId",
  requireRole("QA", "ADMIN"),
  async (req, res, next) => {
    try {
      await deleteFgSpecAttribute(req.params.attrId);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
);

// POST /api/finished-goods-specs/:specId/versions/:vId/approve — Part-11 sign (QA only)
router.post<{ specId: string; vId: string }>(
  "/:specId/versions/:vId/approve",
  requireRole("QA"),
  async (req, res, next) => {
    try {
      const { password, commentary } = req.body as {
        password?: string;
        commentary?: string;
      };
      if (!password)
        return res
          .status(400)
          .json({ message: "password required for electronic signature" });

      const spec = await getFgSpec(req.params.specId);
      if (!spec) return next(errors.notFound("FinishedGoodsSpec"));

      const version = spec.versions.find((v) => v.id === req.params.vId);
      if (!version) return next(errors.notFound("FinishedGoodsSpecVersion"));
      if (version.status !== "PENDING_APPROVAL")
        return res
          .status(400)
          .json({ message: "Only PENDING_APPROVAL versions can be approved" });

      await performSignature(
        {
          userId: req.user!.id,
          password,
          meaning: "FG_SPEC_APPROVAL",
          entityType: "finished_goods_spec_version",
          entityId: req.params.vId,
          commentary: commentary ?? null,
          recordSnapshot: {
            specId: req.params.specId,
            versionNumber: version.version,
          },
          route: `${req.method} ${req.path}`,
          requestId: req.requestId,
        },
        async (_tx) => {
          // no extra writes needed in the tx — approveFgSpecVersion runs its own tx after
        },
      );

      // Find the signature row just written, then finalize approval
      const [sigRow] = await db
        .select({ id: schema.electronicSignatures.id })
        .from(schema.electronicSignatures)
        .where(eq(schema.electronicSignatures.entityId, req.params.vId))
        .orderBy(desc(schema.electronicSignatures.signedAt))
        .limit(1);

      if (sigRow) {
        await approveFgSpecVersion(req.params.vId, sigRow.id, req.user!.id);
      }

      const updated = await getFgSpec(req.params.specId);
      return res.json(updated);
    } catch (err) {
      return next(err);
    }
  },
);

export { router as finishedGoodsSpecRouter };
