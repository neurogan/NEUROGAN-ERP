import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware";
import { errors } from "../errors";
import { performSignature } from "../signatures/signatures";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import {
  listComponentSpecs,
  getComponentSpec,
  createComponentSpec,
  updateComponentSpec,
  createSpecVersion,
  discardSpecVersion,
  upsertSpecAttribute,
  deleteSpecAttribute,
  approveSpecVersion,
  getActiveSpecForProduct,
} from "../storage/component-specs";

const router = Router();

const attributeBody = z.object({
  name: z.string().min(1),
  category: schema.specAttributeCategoryEnum,
  specMin: z.string().nullable().optional(),
  specMax: z.string().nullable().optional(),
  units: z.string().nullable().optional(),
  testMethod: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
  verificationSource: schema.specVerificationSourceEnum.nullable().optional(),
  frequency: schema.specFrequencyEnum.nullable().optional(),
  resultType: schema.specResultTypeEnum.nullable().optional(),
  specificationText: z.string().nullable().optional(),
});

// GET /api/component-specs — list all specs (one row per non-FINISHED_GOOD product)
router.get("/", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const specs = await listComponentSpecs();
    return res.json(specs);
  } catch (err) {
    return next(err);
  }
});

// POST /api/component-specs — create new spec (and initial DRAFT v1)
router.post("/", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const body = z.object({
      productId: z.string(),
      notes: z.string().nullable().optional(),
      documentNumber: z.string().nullable().optional(),
      synonyms: z.string().nullable().optional(),
      casNumber: z.string().nullable().optional(),
      botanicalSource: z.string().nullable().optional(),
      countryOfOrigin: z.string().nullable().optional(),
      primaryPackaging: z.string().nullable().optional(),
      secondaryPackaging: z.string().nullable().optional(),
      storageConditions: z.string().nullable().optional(),
      shelfLifeMonths: z.number().int().nullable().optional(),
      retestMonths: z.number().int().nullable().optional(),
    }).parse(req.body);
    const { productId, ...headerData } = body;
    const spec = await createComponentSpec(productId, req.user!.id, headerData);
    return res.status(201).json(spec);
  } catch (err) {
    return next(err);
  }
});

// IMPORTANT: /by-product/:productId must be registered BEFORE /:specId
// GET /api/component-specs/by-product/:productId — get active spec for a product (all roles)
router.get("/by-product/:productId", async (req, res, next) => {
  try {
    const result = await getActiveSpecForProduct(req.params.productId);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// GET /api/component-specs/:specId — get single spec with all versions
router.get<{ specId: string }>("/:specId", requireRole("QA", "ADMIN", "LAB_TECH"), async (req, res, next) => {
  try {
    const spec = await getComponentSpec(req.params.specId);
    if (!spec) return next(errors.notFound("ComponentSpec"));
    return res.json(spec);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/component-specs/:specId — update spec header (document metadata + packaging/storage)
router.patch<{ specId: string }>("/:specId", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const spec = await getComponentSpec(req.params.specId);
    if (!spec) return next(errors.notFound("ComponentSpec"));
    const body = z.object({
      notes: z.string().nullable().optional(),
      documentNumber: z.string().nullable().optional(),
      synonyms: z.string().nullable().optional(),
      casNumber: z.string().nullable().optional(),
      botanicalSource: z.string().nullable().optional(),
      countryOfOrigin: z.string().nullable().optional(),
      primaryPackaging: z.string().nullable().optional(),
      secondaryPackaging: z.string().nullable().optional(),
      storageConditions: z.string().nullable().optional(),
      shelfLifeMonths: z.number().int().nullable().optional(),
      retestMonths: z.number().int().nullable().optional(),
    }).parse(req.body);
    const updated = await updateComponentSpec(req.params.specId, body);
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
});

// POST /api/component-specs/:specId/versions — create new DRAFT version (requires existing APPROVED)
router.post<{ specId: string }>("/:specId/versions", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const spec = await getComponentSpec(req.params.specId);
    if (!spec) return next(errors.notFound("ComponentSpec"));
    const version = await createSpecVersion(req.params.specId, req.user!.id);
    return res.status(201).json(version);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/component-specs/:specId/versions/:vId — discard a DRAFT version
router.delete<{ specId: string; vId: string }>("/:specId/versions/:vId", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    await discardSpecVersion(req.params.vId);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// POST /api/component-specs/:specId/versions/:vId/attributes — add attribute to DRAFT version
router.post<{ specId: string; vId: string }>("/:specId/versions/:vId/attributes", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const body = attributeBody.parse(req.body);
    const attribute = await upsertSpecAttribute(req.params.vId, body);
    return res.status(201).json(attribute);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/component-specs/:specId/versions/:vId/attributes/:aId — update attribute
router.patch<{ specId: string; vId: string; aId: string }>("/:specId/versions/:vId/attributes/:aId", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const body = attributeBody.parse(req.body);
    const attribute = await upsertSpecAttribute(req.params.vId, { ...body, id: req.params.aId });
    return res.json(attribute);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/component-specs/:specId/versions/:vId/attributes/:aId — delete attribute
router.delete<{ specId: string; vId: string; aId: string }>("/:specId/versions/:vId/attributes/:aId", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    await deleteSpecAttribute(req.params.aId);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// POST /api/component-specs/:specId/versions/:vId/approve — approval with e-signature
router.post<{ specId: string; vId: string }>("/:specId/versions/:vId/approve", requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const { password, commentary } = req.body as { password?: string; commentary?: string };
    if (!password) return res.status(400).json({ message: "password required for electronic signature" });

    const spec = await getComponentSpec(req.params.specId);
    if (!spec) return next(errors.notFound("ComponentSpec"));

    const version = spec.versions.find((v) => v.id === req.params.vId);
    if (!version) return next(errors.notFound("ComponentSpecVersion"));
    if (version.status !== "DRAFT") return res.status(400).json({ message: "Only DRAFT versions can be approved" });

    await performSignature(
      {
        userId: req.user!.id,
        password,
        meaning: "SPEC_APPROVAL",
        entityType: "component_spec_version",
        entityId: req.params.vId,
        commentary: commentary ?? null,
        recordSnapshot: { specId: req.params.specId, versionNumber: version.versionNumber },
        route: `${req.method} ${req.path}`,
        requestId: req.requestId,
      },
      async (_tx) => {
        // no extra writes needed in the tx — approveSpecVersion runs its own tx after
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
      await approveSpecVersion(req.params.vId, sigRow.id, req.user!.id);
    }

    const updated = await getComponentSpec(req.params.specId);
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
});

export { router as componentSpecRouter };
