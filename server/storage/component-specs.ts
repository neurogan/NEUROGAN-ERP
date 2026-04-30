import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, ne, inArray } from "drizzle-orm";
import { writeAuditRow } from "../audit/audit";

// ─── Component Specifications Storage ─────────────────────────────────────────

/**
 * Helper: build ComponentSpecVersionWithAttributes for a single version
 */
async function buildVersionWithAttributes(
  version: schema.ComponentSpecVersion,
  attributes: schema.ComponentSpecAttribute[],
  createdByName: string,
): Promise<schema.ComponentSpecVersionWithAttributes> {
  return {
    ...version,
    attributes: attributes.filter((a) => a.specVersionId === version.id),
    createdByName,
    approvedByName: null, // resolved via signature record when needed
  };
}

/**
 * Helper: build ComponentSpecWithVersions from a ComponentSpec row
 */
async function buildSpecWithVersions(
  spec: schema.ComponentSpec,
): Promise<schema.ComponentSpecWithVersions> {
  const [product] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, spec.productId));

  const [createdBy] = await db
    .select({ fullName: schema.users.fullName })
    .from(schema.users)
    .where(eq(schema.users.id, spec.createdByUserId));

  const versions = await db
    .select()
    .from(schema.componentSpecVersions)
    .where(eq(schema.componentSpecVersions.specId, spec.id))
    .orderBy(desc(schema.componentSpecVersions.versionNumber));

  const allAttributes =
    versions.length > 0
      ? await db
          .select()
          .from(schema.componentSpecAttributes)
          .where(
            inArray(
              schema.componentSpecAttributes.specVersionId,
              versions.map((v) => v.id),
            ),
          )
          .orderBy(schema.componentSpecAttributes.sortOrder)
      : [];

  // Resolve createdByName per version
  const userIds = [...new Set(versions.map((v) => v.createdByUserId))];
  const versionCreators =
    userIds.length > 0
      ? await db
          .select({ id: schema.users.id, fullName: schema.users.fullName })
          .from(schema.users)
          .where(inArray(schema.users.id, userIds))
      : [];
  const creatorMap = new Map(versionCreators.map((u) => [u.id, u.fullName]));

  const builtVersions: schema.ComponentSpecVersionWithAttributes[] = versions.map((v) => ({
    ...v,
    attributes: allAttributes.filter((a) => a.specVersionId === v.id),
    createdByName: creatorMap.get(v.createdByUserId) ?? "",
    approvedByName: null,
  }));

  const activeVersion = builtVersions.find((v) => v.status === "APPROVED") ?? null;

  return {
    ...spec,
    productName: product?.name ?? "",
    productSku: product?.sku ?? "",
    productCategory: product?.category ?? "",
    createdByName: createdBy?.fullName ?? "",
    versions: builtVersions,
    activeVersion: activeVersion ?? null,
  };
}

// ─── 1. listComponentSpecs ─────────────────────────────────────────────────────

export async function listComponentSpecs(): Promise<schema.ComponentSpecWithVersions[]> {
  // Fetch all non-FINISHED_GOOD products
  const allProducts = await db
    .select()
    .from(schema.products)
    .where(ne(schema.products.category, "FINISHED_GOOD"));

  if (allProducts.length === 0) return [];

  // Fetch all specs
  const allSpecs = await db.select().from(schema.componentSpecs);

  const specsByProductId = new Map(allSpecs.map((s) => [s.productId, s]));

  // Fetch all versions in bulk
  const allVersions =
    allSpecs.length > 0
      ? await db
          .select()
          .from(schema.componentSpecVersions)
          .where(
            inArray(
              schema.componentSpecVersions.specId,
              allSpecs.map((s) => s.id),
            ),
          )
          .orderBy(desc(schema.componentSpecVersions.versionNumber))
      : [];

  const allAttributes =
    allVersions.length > 0
      ? await db
          .select()
          .from(schema.componentSpecAttributes)
          .where(
            inArray(
              schema.componentSpecAttributes.specVersionId,
              allVersions.map((v) => v.id),
            ),
          )
          .orderBy(schema.componentSpecAttributes.sortOrder)
      : [];

  // Bulk fetch user names
  const allUserIds = [
    ...new Set([
      ...allSpecs.map((s) => s.createdByUserId),
      ...allVersions.map((v) => v.createdByUserId),
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

  const versionsBySpecId = new Map<string, schema.ComponentSpecVersion[]>();
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
        createdByUserId: "",
        createdAt: new Date(),
        notes: null,
        productName: product.name,
        productSku: product.sku,
        productCategory: product.category,
        createdByName: "",
        versions: [],
        activeVersion: null,
      } as schema.ComponentSpecWithVersions;
    }

    const versions = versionsBySpecId.get(spec.id) ?? [];
    const builtVersions: schema.ComponentSpecVersionWithAttributes[] = versions.map((v) => ({
      ...v,
      attributes: allAttributes.filter((a) => a.specVersionId === v.id),
      createdByName: userMap.get(v.createdByUserId) ?? "",
      approvedByName: null,
    }));
    const activeVersion = builtVersions.find((v) => v.status === "APPROVED") ?? null;

    return {
      ...spec,
      productName: product.name,
      productSku: product.sku,
      productCategory: product.category,
      createdByName: userMap.get(spec.createdByUserId) ?? "",
      versions: builtVersions,
      activeVersion: activeVersion ?? null,
    };
  });
}

// ─── 2. getComponentSpec ───────────────────────────────────────────────────────

export async function getComponentSpec(
  specId: string,
): Promise<schema.ComponentSpecWithVersions | undefined> {
  const [spec] = await db
    .select()
    .from(schema.componentSpecs)
    .where(eq(schema.componentSpecs.id, specId));

  if (!spec) return undefined;
  return buildSpecWithVersions(spec);
}

// ─── 3. createComponentSpec ────────────────────────────────────────────────────

export async function createComponentSpec(
  productId: string,
  userId: string,
): Promise<schema.ComponentSpecWithVersions> {
  const { newSpecId, newVersionId } = await db.transaction(async (tx) => {
    const [spec] = await tx
      .insert(schema.componentSpecs)
      .values({ productId, createdByUserId: userId })
      .returning();

    const [version] = await tx
      .insert(schema.componentSpecVersions)
      .values({
        specId: spec!.id,
        versionNumber: 1,
        status: "DRAFT",
        createdByUserId: userId,
      })
      .returning();

    return { newSpecId: spec!.id, newVersionId: version!.id };
  });

  await writeAuditRow({
    userId,
    action: "SPEC_VERSION_CREATED",
    entityType: "component_spec_version",
    entityId: newVersionId,
    route: null,
    requestId: null,
  });

  return getComponentSpec(newSpecId) as Promise<schema.ComponentSpecWithVersions>;
}

// ─── 4. createSpecVersion ──────────────────────────────────────────────────────

export async function createSpecVersion(
  specId: string,
  userId: string,
): Promise<schema.ComponentSpecVersionWithAttributes> {
  // Find the current APPROVED version
  const [approvedVersion] = await db
    .select()
    .from(schema.componentSpecVersions)
    .where(
      and(
        eq(schema.componentSpecVersions.specId, specId),
        eq(schema.componentSpecVersions.status, "APPROVED"),
      ),
    )
    .limit(1);

  if (!approvedVersion) {
    throw Object.assign(new Error("No APPROVED version found for this spec"), { status: 400 });
  }

  // Verify no existing DRAFT
  const [existingDraft] = await db
    .select()
    .from(schema.componentSpecVersions)
    .where(
      and(
        eq(schema.componentSpecVersions.specId, specId),
        eq(schema.componentSpecVersions.status, "DRAFT"),
      ),
    )
    .limit(1);

  if (existingDraft) {
    throw Object.assign(new Error("A DRAFT version already exists for this spec"), { status: 409 });
  }

  // Fetch attributes from approved version to copy
  const approvedAttributes = await db
    .select()
    .from(schema.componentSpecAttributes)
    .where(eq(schema.componentSpecAttributes.specVersionId, approvedVersion.id))
    .orderBy(schema.componentSpecAttributes.sortOrder);

  const { newVersionId } = await db.transaction(async (tx) => {
    const [newVersion] = await tx
      .insert(schema.componentSpecVersions)
      .values({
        specId,
        versionNumber: approvedVersion.versionNumber + 1,
        status: "DRAFT",
        createdByUserId: userId,
      })
      .returning();

    if (approvedAttributes.length > 0) {
      await tx.insert(schema.componentSpecAttributes).values(
        approvedAttributes.map((a) => ({
          specVersionId: newVersion!.id,
          name: a.name,
          category: a.category,
          specMin: a.specMin,
          specMax: a.specMax,
          units: a.units,
          testMethod: a.testMethod,
          sortOrder: a.sortOrder,
        })),
      );
    }

    return { newVersionId: newVersion!.id };
  });

  await writeAuditRow({
    userId,
    action: "SPEC_VERSION_CREATED",
    entityType: "component_spec_version",
    entityId: newVersionId,
    route: null,
    requestId: null,
  });

  // Return the new version with attributes
  const [version] = await db
    .select()
    .from(schema.componentSpecVersions)
    .where(eq(schema.componentSpecVersions.id, newVersionId));

  const attributes = await db
    .select()
    .from(schema.componentSpecAttributes)
    .where(eq(schema.componentSpecAttributes.specVersionId, newVersionId))
    .orderBy(schema.componentSpecAttributes.sortOrder);

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

// ─── 5. discardSpecVersion ─────────────────────────────────────────────────────

export async function discardSpecVersion(versionId: string): Promise<void> {
  const [version] = await db
    .select()
    .from(schema.componentSpecVersions)
    .where(eq(schema.componentSpecVersions.id, versionId));

  if (!version) {
    throw Object.assign(new Error("Spec version not found"), { status: 404 });
  }
  if (version.status !== "DRAFT") {
    throw Object.assign(new Error("Only DRAFT versions can be discarded"), { status: 400 });
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.componentSpecAttributes)
      .where(eq(schema.componentSpecAttributes.specVersionId, versionId));
    await tx
      .delete(schema.componentSpecVersions)
      .where(eq(schema.componentSpecVersions.id, versionId));
  });
}

// ─── 6. upsertSpecAttribute ────────────────────────────────────────────────────

export async function upsertSpecAttribute(
  versionId: string,
  data: {
    id?: string;
    name: string;
    category: schema.SpecAttributeCategory;
    specMin?: string | null;
    specMax?: string | null;
    units?: string | null;
    testMethod?: string | null;
    sortOrder?: number;
  },
): Promise<schema.ComponentSpecAttribute> {
  // Guard: version must be DRAFT
  const [version] = await db
    .select()
    .from(schema.componentSpecVersions)
    .where(eq(schema.componentSpecVersions.id, versionId));

  if (!version) {
    throw Object.assign(new Error("Spec version not found"), { status: 404 });
  }
  if (version.status !== "DRAFT") {
    throw Object.assign(new Error("Attributes can only be modified on DRAFT versions"), {
      status: 400,
    });
  }

  if (data.id) {
    // UPDATE — verify it belongs to this version
    const [existing] = await db
      .select()
      .from(schema.componentSpecAttributes)
      .where(
        and(
          eq(schema.componentSpecAttributes.id, data.id),
          eq(schema.componentSpecAttributes.specVersionId, versionId),
        ),
      );

    if (!existing) {
      throw Object.assign(new Error("Attribute not found on this version"), { status: 404 });
    }

    const [updated] = await db
      .update(schema.componentSpecAttributes)
      .set({
        name: data.name,
        category: data.category,
        specMin: data.specMin ?? null,
        specMax: data.specMax ?? null,
        units: data.units ?? null,
        testMethod: data.testMethod ?? null,
        sortOrder: data.sortOrder ?? existing.sortOrder,
      })
      .where(eq(schema.componentSpecAttributes.id, data.id))
      .returning();

    return updated!;
  } else {
    // INSERT
    const [inserted] = await db
      .insert(schema.componentSpecAttributes)
      .values({
        specVersionId: versionId,
        name: data.name,
        category: data.category,
        specMin: data.specMin ?? null,
        specMax: data.specMax ?? null,
        units: data.units ?? null,
        testMethod: data.testMethod ?? null,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();

    return inserted!;
  }
}

// ─── 7. deleteSpecAttribute ────────────────────────────────────────────────────

export async function deleteSpecAttribute(attributeId: string): Promise<void> {
  const [attribute] = await db
    .select()
    .from(schema.componentSpecAttributes)
    .where(eq(schema.componentSpecAttributes.id, attributeId));

  if (!attribute) {
    throw Object.assign(new Error("Attribute not found"), { status: 404 });
  }

  // Guard: parent version must be DRAFT
  const [version] = await db
    .select()
    .from(schema.componentSpecVersions)
    .where(eq(schema.componentSpecVersions.id, attribute.specVersionId));

  if (!version || version.status !== "DRAFT") {
    throw Object.assign(new Error("Attributes can only be deleted from DRAFT versions"), {
      status: 400,
    });
  }

  await db
    .delete(schema.componentSpecAttributes)
    .where(eq(schema.componentSpecAttributes.id, attributeId));
}

// ─── 8. approveSpecVersion ─────────────────────────────────────────────────────

export async function approveSpecVersion(
  versionId: string,
  signatureId: string,
  userId: string,
): Promise<void> {
  let supersededId: string | null = null;

  await db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(schema.componentSpecVersions)
      .where(eq(schema.componentSpecVersions.id, versionId));

    if (!version) {
      throw Object.assign(new Error("Spec version not found"), { status: 404 });
    }

    // Find any existing APPROVED version for the same spec (to supersede it)
    const [currentApproved] = await tx
      .select()
      .from(schema.componentSpecVersions)
      .where(
        and(
          eq(schema.componentSpecVersions.specId, version.specId),
          eq(schema.componentSpecVersions.status, "APPROVED"),
        ),
      )
      .limit(1);

    if (currentApproved) {
      supersededId = currentApproved.id;
      await tx
        .update(schema.componentSpecVersions)
        .set({ status: "SUPERSEDED" })
        .where(eq(schema.componentSpecVersions.id, currentApproved.id));
    }

    await tx
      .update(schema.componentSpecVersions)
      .set({ status: "APPROVED", signatureId })
      .where(eq(schema.componentSpecVersions.id, versionId));
  });

  await writeAuditRow({
    userId,
    action: "SPEC_APPROVED",
    entityType: "component_spec_version",
    entityId: versionId,
    route: null,
    requestId: null,
  });

  if (supersededId) {
    await writeAuditRow({
      userId,
      action: "SPEC_VERSION_SUPERSEDED",
      entityType: "component_spec_version",
      entityId: supersededId,
      route: null,
      requestId: null,
    });
  }
}

// ─── 9. getActiveSpecForProduct ────────────────────────────────────────────────

export async function getActiveSpecForProduct(productId: string): Promise<{
  version: schema.ComponentSpecVersion;
  attributes: schema.ComponentSpecAttribute[];
} | null> {
  const [spec] = await db
    .select()
    .from(schema.componentSpecs)
    .where(eq(schema.componentSpecs.productId, productId))
    .limit(1);

  if (!spec) return null;

  const [version] = await db
    .select()
    .from(schema.componentSpecVersions)
    .where(
      and(
        eq(schema.componentSpecVersions.specId, spec.id),
        eq(schema.componentSpecVersions.status, "APPROVED"),
      ),
    )
    .limit(1);

  if (!version) return null;

  const attributes = await db
    .select()
    .from(schema.componentSpecAttributes)
    .where(eq(schema.componentSpecAttributes.specVersionId, version.id))
    .orderBy(schema.componentSpecAttributes.sortOrder);

  return { version, attributes };
}
