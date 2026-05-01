import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, inArray, lte } from "drizzle-orm";
import { writeAuditRow } from "../audit/audit";

// ─── Finished-Goods Spec Storage ──────────────────────────────────────────────

/**
 * Helper: build FgSpecWithVersions from a FinishedGoodsSpec row
 */
async function buildFgSpecWithVersions(
  spec: schema.FinishedGoodsSpec,
): Promise<schema.FgSpecWithVersions> {
  const [product] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, spec.productId));

  const versions = await db
    .select()
    .from(schema.finishedGoodsSpecVersions)
    .where(eq(schema.finishedGoodsSpecVersions.specId, spec.id))
    .orderBy(desc(schema.finishedGoodsSpecVersions.version));

  const allAttributes =
    versions.length > 0
      ? await db
          .select()
          .from(schema.finishedGoodsSpecAttributes)
          .where(
            inArray(
              schema.finishedGoodsSpecAttributes.specVersionId,
              versions.map((v) => v.id),
            ),
          )
      : [];

  // Bulk-fetch creator names
  const userIds = [
    ...new Set([
      spec.createdByUserId,
      ...versions.map((v) => v.createdByUserId),
      ...versions.filter((v) => v.approvedByUserId).map((v) => v.approvedByUserId!),
    ]),
  ];
  const allUsers =
    userIds.length > 0
      ? await db
          .select({ id: schema.users.id, fullName: schema.users.fullName })
          .from(schema.users)
          .where(inArray(schema.users.id, userIds))
      : [];
  const userMap = new Map(allUsers.map((u) => [u.id, u.fullName]));

  const builtVersions: schema.FgSpecVersionWithAttributes[] = versions.map((v) => ({
    ...v,
    attributes: allAttributes.filter((a) => a.specVersionId === v.id),
    createdByName: userMap.get(v.createdByUserId) ?? "",
    approvedByName: v.approvedByUserId ? (userMap.get(v.approvedByUserId) ?? null) : null,
  }));

  const activeVersion = builtVersions.find((v) => v.status === "APPROVED") ?? null;

  return {
    ...spec,
    productName: product?.name ?? "",
    versions: builtVersions,
    activeVersion: activeVersion ?? null,
  };
}

// ─── 1. listFgSpecs ────────────────────────────────────────────────────────────

export async function listFgSpecs(): Promise<schema.FgSpecWithVersions[]> {
  // Only FINISHED_GOOD products
  const allProducts = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.category, "FINISHED_GOOD"));

  if (allProducts.length === 0) return [];

  // Fetch all FG specs
  const allSpecs = await db.select().from(schema.finishedGoodsSpecs);
  const specsByProductId = new Map(allSpecs.map((s) => [s.productId, s]));

  // Fetch all versions in bulk
  const allVersions =
    allSpecs.length > 0
      ? await db
          .select()
          .from(schema.finishedGoodsSpecVersions)
          .where(
            inArray(
              schema.finishedGoodsSpecVersions.specId,
              allSpecs.map((s) => s.id),
            ),
          )
          .orderBy(desc(schema.finishedGoodsSpecVersions.version))
      : [];

  const allAttributes =
    allVersions.length > 0
      ? await db
          .select()
          .from(schema.finishedGoodsSpecAttributes)
          .where(
            inArray(
              schema.finishedGoodsSpecAttributes.specVersionId,
              allVersions.map((v) => v.id),
            ),
          )
      : [];

  // Bulk fetch user names
  const allUserIds = [
    ...new Set([
      ...allSpecs.map((s) => s.createdByUserId),
      ...allVersions.map((v) => v.createdByUserId),
      ...allVersions.filter((v) => v.approvedByUserId).map((v) => v.approvedByUserId!),
    ]),
  ];
  const allUsers =
    allUserIds.length > 0
      ? await db
          .select({ id: schema.users.id, fullName: schema.users.fullName })
          .from(schema.users)
          .where(inArray(schema.users.id, allUserIds))
      : [];
  const userMap = new Map(allUsers.map((u) => [u.id, u.fullName]));

  const versionsBySpecId = new Map<string, schema.FinishedGoodsSpecVersion[]>();
  for (const v of allVersions) {
    const arr = versionsBySpecId.get(v.specId) ?? [];
    arr.push(v);
    versionsBySpecId.set(v.specId, arr);
  }

  return allProducts.map((product) => {
    const spec = specsByProductId.get(product.id);
    if (!spec) {
      return {
        id: "" as string,
        productId: product.id,
        name: "",
        description: null,
        status: "ACTIVE",
        createdAt: new Date(),
        createdByUserId: "",
        productName: product.name,
        versions: [],
        activeVersion: null,
      } as schema.FgSpecWithVersions;
    }

    const versions = versionsBySpecId.get(spec.id) ?? [];
    const builtVersions: schema.FgSpecVersionWithAttributes[] = versions.map((v) => ({
      ...v,
      attributes: allAttributes.filter((a) => a.specVersionId === v.id),
      createdByName: userMap.get(v.createdByUserId) ?? "",
      approvedByName: v.approvedByUserId ? (userMap.get(v.approvedByUserId) ?? null) : null,
    }));
    const activeVersion = builtVersions.find((v) => v.status === "APPROVED") ?? null;

    return {
      ...spec,
      productName: product.name,
      versions: builtVersions,
      activeVersion: activeVersion ?? null,
    };
  });
}

// ─── 2. getFgSpec ──────────────────────────────────────────────────────────────

export async function getFgSpec(
  specId: string,
): Promise<schema.FgSpecWithVersions | undefined> {
  const [spec] = await db
    .select()
    .from(schema.finishedGoodsSpecs)
    .where(eq(schema.finishedGoodsSpecs.id, specId));

  if (!spec) return undefined;
  return buildFgSpecWithVersions(spec);
}

// ─── 3. createFgSpec ──────────────────────────────────────────────────────────

export async function createFgSpec(
  productId: string,
  userId: string,
  data: { name: string; description?: string | null },
): Promise<schema.FgSpecWithVersions> {
  const { newSpecId, newVersionId } = await db.transaction(async (tx) => {
    const [spec] = await tx
      .insert(schema.finishedGoodsSpecs)
      .values({
        productId,
        name: data.name,
        description: data.description ?? null,
        createdByUserId: userId,
      })
      .returning();

    const [version] = await tx
      .insert(schema.finishedGoodsSpecVersions)
      .values({
        specId: spec!.id,
        version: 1,
        status: "PENDING_APPROVAL",
        createdByUserId: userId,
      })
      .returning();

    return { newSpecId: spec!.id, newVersionId: version!.id };
  });

  await writeAuditRow({
    userId,
    action: "FG_SPEC_CREATED",
    entityType: "finished_goods_spec",
    entityId: newSpecId,
    route: null,
    requestId: null,
    meta: { versionId: newVersionId },
  });

  return getFgSpec(newSpecId) as Promise<schema.FgSpecWithVersions>;
}

// ─── 4. createFgSpecVersion ────────────────────────────────────────────────────

export async function createFgSpecVersion(
  specId: string,
  userId: string,
): Promise<schema.FgSpecVersionWithAttributes> {
  // Guard: no existing PENDING_APPROVAL version
  const [existingPending] = await db
    .select()
    .from(schema.finishedGoodsSpecVersions)
    .where(
      and(
        eq(schema.finishedGoodsSpecVersions.specId, specId),
        eq(schema.finishedGoodsSpecVersions.status, "PENDING_APPROVAL"),
      ),
    )
    .limit(1);

  if (existingPending) {
    throw Object.assign(
      new Error("A PENDING_APPROVAL version already exists for this spec"),
      { status: 409 },
    );
  }

  // Find current APPROVED version to copy attributes from
  const [approvedVersion] = await db
    .select()
    .from(schema.finishedGoodsSpecVersions)
    .where(
      and(
        eq(schema.finishedGoodsSpecVersions.specId, specId),
        eq(schema.finishedGoodsSpecVersions.status, "APPROVED"),
      ),
    )
    .orderBy(desc(schema.finishedGoodsSpecVersions.version))
    .limit(1);

  const baseVersion = approvedVersion;
  const nextVersionNumber = baseVersion ? baseVersion.version + 1 : 1;

  const approvedAttributes = baseVersion
    ? await db
        .select()
        .from(schema.finishedGoodsSpecAttributes)
        .where(eq(schema.finishedGoodsSpecAttributes.specVersionId, baseVersion.id))
    : [];

  const { newVersionId } = await db.transaction(async (tx) => {
    const [newVersion] = await tx
      .insert(schema.finishedGoodsSpecVersions)
      .values({
        specId,
        version: nextVersionNumber,
        status: "PENDING_APPROVAL",
        createdByUserId: userId,
      })
      .returning();

    if (approvedAttributes.length > 0) {
      await tx.insert(schema.finishedGoodsSpecAttributes).values(
        approvedAttributes.map((a) => ({
          specVersionId: newVersion!.id,
          analyte: a.analyte,
          category: a.category,
          targetValue: a.targetValue,
          minValue: a.minValue,
          maxValue: a.maxValue,
          unit: a.unit,
          required: a.required,
          notes: a.notes,
        })),
      );
    }

    return { newVersionId: newVersion!.id };
  });

  const [version] = await db
    .select()
    .from(schema.finishedGoodsSpecVersions)
    .where(eq(schema.finishedGoodsSpecVersions.id, newVersionId));

  const attributes = await db
    .select()
    .from(schema.finishedGoodsSpecAttributes)
    .where(eq(schema.finishedGoodsSpecAttributes.specVersionId, newVersionId));

  const [creator] = await db
    .select({ fullName: schema.users.fullName })
    .from(schema.users)
    .where(eq(schema.users.id, userId));

  return {
    ...version!,
    attributes,
    createdByName: creator?.fullName ?? "",
    approvedByName: null,
  };
}

// ─── 5. addFgSpecAttribute ─────────────────────────────────────────────────────

export async function addFgSpecAttribute(
  versionId: string,
  data: {
    analyte: string;
    category: schema.FgSpecAttributeCategory;
    targetValue?: string | null;
    minValue?: string | null;
    maxValue?: string | null;
    unit: string;
    required?: boolean;
    notes?: string | null;
  },
): Promise<schema.FinishedGoodsSpecAttribute> {
  // Guard: version must be PENDING_APPROVAL
  const [version] = await db
    .select()
    .from(schema.finishedGoodsSpecVersions)
    .where(eq(schema.finishedGoodsSpecVersions.id, versionId));

  if (!version) {
    throw Object.assign(new Error("Spec version not found"), { status: 404 });
  }
  if (version.status !== "PENDING_APPROVAL") {
    throw Object.assign(
      new Error("Attributes can only be added to PENDING_APPROVAL versions"),
      { status: 400 },
    );
  }

  const [inserted] = await db
    .insert(schema.finishedGoodsSpecAttributes)
    .values({
      specVersionId: versionId,
      analyte: data.analyte,
      category: data.category,
      targetValue: data.targetValue ?? null,
      minValue: data.minValue ?? null,
      maxValue: data.maxValue ?? null,
      unit: data.unit,
      required: data.required ?? true,
      notes: data.notes ?? null,
    })
    .returning();

  return inserted!;
}

// ─── 6. deleteFgSpecAttribute ──────────────────────────────────────────────────

export async function deleteFgSpecAttribute(attributeId: string): Promise<void> {
  const [attribute] = await db
    .select()
    .from(schema.finishedGoodsSpecAttributes)
    .where(eq(schema.finishedGoodsSpecAttributes.id, attributeId));

  if (!attribute) {
    throw Object.assign(new Error("Attribute not found"), { status: 404 });
  }

  // Guard: parent version must be PENDING_APPROVAL
  const [version] = await db
    .select()
    .from(schema.finishedGoodsSpecVersions)
    .where(eq(schema.finishedGoodsSpecVersions.id, attribute.specVersionId));

  if (!version || version.status !== "PENDING_APPROVAL") {
    throw Object.assign(
      new Error("Attributes can only be deleted from PENDING_APPROVAL versions"),
      { status: 400 },
    );
  }

  await db
    .delete(schema.finishedGoodsSpecAttributes)
    .where(eq(schema.finishedGoodsSpecAttributes.id, attributeId));
}

// ─── 7. approveFgSpecVersion ───────────────────────────────────────────────────

export async function approveFgSpecVersion(
  versionId: string,
  signatureId: string,
  userId: string,
): Promise<void> {
  let supersededId: string | null = null;

  await db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(schema.finishedGoodsSpecVersions)
      .where(eq(schema.finishedGoodsSpecVersions.id, versionId));

    if (!version) {
      throw Object.assign(new Error("Spec version not found"), { status: 404 });
    }
    if (version.status !== "PENDING_APPROVAL") {
      throw Object.assign(
        new Error("Only PENDING_APPROVAL versions can be approved"),
        { status: 400 },
      );
    }

    // Find any existing APPROVED version for the same spec (to supersede)
    const [currentApproved] = await tx
      .select()
      .from(schema.finishedGoodsSpecVersions)
      .where(
        and(
          eq(schema.finishedGoodsSpecVersions.specId, version.specId),
          eq(schema.finishedGoodsSpecVersions.status, "APPROVED"),
        ),
      )
      .limit(1);

    if (currentApproved) {
      supersededId = currentApproved.id;
      await tx
        .update(schema.finishedGoodsSpecVersions)
        .set({ status: "SUPERSEDED" })
        .where(eq(schema.finishedGoodsSpecVersions.id, currentApproved.id));
    }

    await tx
      .update(schema.finishedGoodsSpecVersions)
      .set({
        status: "APPROVED",
        signatureId,
        approvedByUserId: userId,
        approvedAt: new Date(),
      })
      .where(eq(schema.finishedGoodsSpecVersions.id, versionId));
  });

  await writeAuditRow({
    userId,
    action: "FG_SPEC_APPROVED",
    entityType: "finished_goods_spec_version",
    entityId: versionId,
    route: null,
    requestId: null,
  });

  if (supersededId) {
    await writeAuditRow({
      userId,
      action: "FG_SPEC_APPROVED",
      entityType: "finished_goods_spec_version",
      entityId: supersededId,
      route: null,
      requestId: null,
      meta: { superseded: true },
    });
  }
}

// ─── 8. getActiveSpec ──────────────────────────────────────────────────────────
//
// Returns the APPROVED version where approvedAt <= atDate with the highest
// version number. This is the key function for the gate.

export async function getActiveSpec(
  productId: string,
  atDate: Date,
): Promise<{
  version: schema.FinishedGoodsSpecVersion;
  attributes: schema.FinishedGoodsSpecAttribute[];
} | null> {
  const [spec] = await db
    .select()
    .from(schema.finishedGoodsSpecs)
    .where(eq(schema.finishedGoodsSpecs.productId, productId))
    .limit(1);

  if (!spec) return null;

  // Find APPROVED versions where approvedAt <= atDate, pick highest version
  const approvedVersions = await db
    .select()
    .from(schema.finishedGoodsSpecVersions)
    .where(
      and(
        eq(schema.finishedGoodsSpecVersions.specId, spec.id),
        eq(schema.finishedGoodsSpecVersions.status, "APPROVED"),
        lte(schema.finishedGoodsSpecVersions.approvedAt, atDate),
      ),
    )
    .orderBy(desc(schema.finishedGoodsSpecVersions.version));

  const version = approvedVersions[0];
  if (!version) return null;

  const attributes = await db
    .select()
    .from(schema.finishedGoodsSpecAttributes)
    .where(eq(schema.finishedGoodsSpecAttributes.specVersionId, version.id));

  return { version, attributes };
}
