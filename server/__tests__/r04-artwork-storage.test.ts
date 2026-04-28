import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import {
  createArtwork,
  approveArtwork,
  retireArtwork,
  listArtworkByProduct,
  getActiveArtwork,
  getArtwork,
} from "../storage/label-artwork";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

let adminId: string;
let qaId: string;
let productId: string;

const createdArtworkIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;

  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04art-adm-${sfx}@t.com`,
      fullName: "R04Art Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r04art-qa-${sfx}@t.com`,
      fullName: "R04Art QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  const [prod] = await db
    .insert(schema.products)
    .values({ sku: `R04ART-${sfx}`, name: "R04 Art Test Product" })
    .returning();
  productId = prod!.id;
});

afterAll(async () => {
  if (!dbUrl) return;

  // Delete artwork rows (FK: retiredBySignatureId, approvedBySignatureId → electronic_signatures)
  for (const id of createdArtworkIds) {
    // Nullify FK references before deleting signatures
    await db
      .update(schema.labelArtwork)
      .set({ approvedBySignatureId: null, retiredBySignatureId: null })
      .where(eq(schema.labelArtwork.id, id))
      .catch(() => {});
    await db
      .delete(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, id))
      .catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, id))
      .catch(() => {});
    await db
      .delete(schema.labelArtwork)
      .where(eq(schema.labelArtwork.id, id))
      .catch(() => {});
  }

  // Product cleanup
  if (productId) {
    await db
      .delete(schema.labelArtwork)
      .where(eq(schema.labelArtwork.productId, productId))
      .catch(() => {});
    await db.delete(schema.products).where(eq(schema.products.id, productId)).catch(() => {});
  }

  // User cleanup
  for (const uid of [adminId, qaId].filter(Boolean)) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.userId, uid))
      .catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

/** Helper to build a minimal artwork input. */
function artworkInput(versionSuffix: string) {
  return {
    productId,
    version: `v1.${versionSuffix}`,
    artworkFileName: `label-${versionSuffix}.pdf`,
    artworkFileData: "base64dataplaceholder",
    artworkMimeType: "application/pdf",
    variableDataSpec: { lotNumber: true, expirationDate: true },
    status: "DRAFT" as const,
  };
}

describeIfDb("R-04 label artwork storage", () => {
  // ─── createArtwork ──────────────────────────────────────────────────────────

  it("createArtwork — inserts DRAFT row and writes LABEL_ARTWORK_CREATED audit", async () => {
    const row = await createArtwork(
      artworkInput("create"),
      adminId,
      "req-create",
      "POST /api/label-artwork",
    );

    createdArtworkIds.push(row.id);

    expect(row.status).toBe("DRAFT");
    expect(row.productId).toBe(productId);
    expect(row.version).toBe("v1.create");
    expect(row.artworkFileName).toBe("label-create.pdf");
    expect(row.approvedBySignatureId).toBeNull();
    expect(row.retiredBySignatureId).toBeNull();

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, row.id));
    expect(audit.some((a) => a.action === "LABEL_ARTWORK_CREATED")).toBe(true);
  });

  // ─── getArtwork ─────────────────────────────────────────────────────────────

  it("getArtwork — returns the row by id", async () => {
    const created = await createArtwork(
      artworkInput("get"),
      adminId,
      "req-get",
      "POST /api/label-artwork",
    );
    createdArtworkIds.push(created.id);

    const fetched = await getArtwork(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
  });

  it("getArtwork — returns undefined for unknown id", async () => {
    const result = await getArtwork("00000000-0000-0000-0000-000000000000");
    expect(result).toBeUndefined();
  });

  // ─── approveArtwork ─────────────────────────────────────────────────────────

  it("approveArtwork — happy path: DRAFT→APPROVED, approvedBySignatureId non-null, LABEL_ARTWORK_APPROVED audit", async () => {
    const draft = await createArtwork(
      artworkInput("approve"),
      adminId,
      "req-approve-create",
      "POST /api/label-artwork",
    );
    createdArtworkIds.push(draft.id);

    const approved = await approveArtwork(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-approve",
      "POST /api/label-artwork/:id/approve",
    );

    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBySignatureId).toBeTruthy();
    expect(approved.approvedAt).toBeTruthy();

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, draft.id));
    expect(audit.some((a) => a.action === "LABEL_ARTWORK_APPROVED")).toBe(true);
    expect(audit.some((a) => a.action === "SIGN")).toBe(true);

    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, draft.id));
    expect(sigs.some((s) => s.meaning === "ARTWORK_APPROVED")).toBe(true);
  });

  it("approveArtwork — throws 409 ARTWORK_INVALID_STATE when already APPROVED", async () => {
    const draft = await createArtwork(
      artworkInput("approve2"),
      adminId,
      "req-a2-create",
      "POST /api/label-artwork",
    );
    createdArtworkIds.push(draft.id);

    await approveArtwork(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-a2-first",
      "POST /api/label-artwork/:id/approve",
    );

    await expect(
      approveArtwork(
        draft.id,
        qaId,
        VALID_PASSWORD,
        "req-a2-second",
        "POST /api/label-artwork/:id/approve",
      ),
    ).rejects.toMatchObject({ status: 409, code: "ARTWORK_INVALID_STATE" });
  });

  it("approveArtwork — throws 409 ARTWORK_INVALID_STATE when RETIRED", async () => {
    const draft = await createArtwork(
      artworkInput("approve3"),
      adminId,
      "req-a3-create",
      "POST /api/label-artwork",
    );
    createdArtworkIds.push(draft.id);

    // approve → retire
    await approveArtwork(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-a3-approve",
      "POST /api/label-artwork/:id/approve",
    );
    await retireArtwork(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-a3-retire",
      "POST /api/label-artwork/:id/retire",
    );

    await expect(
      approveArtwork(
        draft.id,
        qaId,
        VALID_PASSWORD,
        "req-a3-approve2",
        "POST /api/label-artwork/:id/approve",
      ),
    ).rejects.toMatchObject({ status: 409, code: "ARTWORK_INVALID_STATE" });
  });

  // ─── retireArtwork ──────────────────────────────────────────────────────────

  it("retireArtwork — happy path: APPROVED→RETIRED, retiredBySignatureId non-null, LABEL_ARTWORK_RETIRED audit", async () => {
    const draft = await createArtwork(
      artworkInput("retire"),
      adminId,
      "req-retire-create",
      "POST /api/label-artwork",
    );
    createdArtworkIds.push(draft.id);

    await approveArtwork(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-retire-approve",
      "POST /api/label-artwork/:id/approve",
    );

    const retired = await retireArtwork(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-retire",
      "POST /api/label-artwork/:id/retire",
    );

    expect(retired.status).toBe("RETIRED");
    expect(retired.retiredBySignatureId).toBeTruthy();
    expect(retired.retiredAt).toBeTruthy();

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, draft.id));
    expect(audit.some((a) => a.action === "LABEL_ARTWORK_RETIRED")).toBe(true);

    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, draft.id));
    expect(sigs.some((s) => s.meaning === "ARTWORK_RETIRED")).toBe(true);
  });

  it("retireArtwork — throws 409 ARTWORK_INVALID_STATE when DRAFT", async () => {
    const draft = await createArtwork(
      artworkInput("retirebad"),
      adminId,
      "req-rb-create",
      "POST /api/label-artwork",
    );
    createdArtworkIds.push(draft.id);

    await expect(
      retireArtwork(
        draft.id,
        qaId,
        VALID_PASSWORD,
        "req-rb-retire",
        "POST /api/label-artwork/:id/retire",
      ),
    ).rejects.toMatchObject({ status: 409, code: "ARTWORK_INVALID_STATE" });
  });

  // ─── listArtworkByProduct ───────────────────────────────────────────────────

  it("listArtworkByProduct — returns all artwork for product ordered by version desc", async () => {
    const sfx = Date.now();
    const [p] = await db
      .insert(schema.products)
      .values({ sku: `R04ART-LIST-${sfx}`, name: "R04 List Test Product" })
      .returning();
    const listProductId = p!.id;

    try {
      const a1 = await createArtwork(
        { ...artworkInput("list1"), productId: listProductId, version: "v1.0" },
        adminId,
        "req-list1",
        "POST /api/label-artwork",
      );
      const a2 = await createArtwork(
        { ...artworkInput("list2"), productId: listProductId, version: "v2.0" },
        adminId,
        "req-list2",
        "POST /api/label-artwork",
      );
      const a3 = await createArtwork(
        { ...artworkInput("list3"), productId: listProductId, version: "v1.5" },
        adminId,
        "req-list3",
        "POST /api/label-artwork",
      );

      const rows = await listArtworkByProduct(listProductId);
      expect(rows.length).toBe(3);
      // Ordered by version desc
      const versions = rows.map((r) => r.version);
      const sorted = [...versions].sort((a, b) => b.localeCompare(a));
      expect(versions).toEqual(sorted);

      // Cleanup
      for (const id of [a1.id, a2.id, a3.id]) {
        await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
        await db.delete(schema.labelArtwork).where(eq(schema.labelArtwork.id, id)).catch(() => {});
      }
    } finally {
      await db.delete(schema.products).where(eq(schema.products.id, listProductId)).catch(() => {});
    }
  });

  // ─── getActiveArtwork ────────────────────────────────────────────────────────

  it("getActiveArtwork — returns APPROVED row, null when none", async () => {
    const sfx = Date.now();
    const [p] = await db
      .insert(schema.products)
      .values({ sku: `R04ART-ACTIVE-${sfx}`, name: "R04 Active Test Product" })
      .returning();
    const activeProductId = p!.id;

    try {
      // Initially null — no artwork at all
      const noArtwork = await getActiveArtwork(activeProductId);
      expect(noArtwork).toBeNull();

      const draft = await createArtwork(
        { ...artworkInput("active"), productId: activeProductId, version: "v1.0" },
        adminId,
        "req-active-create",
        "POST /api/label-artwork",
      );

      // Still null — only DRAFT exists
      const stillNull = await getActiveArtwork(activeProductId);
      expect(stillNull).toBeNull();

      await approveArtwork(
        draft.id,
        qaId,
        VALID_PASSWORD,
        "req-active-approve",
        "POST /api/label-artwork/:id/approve",
      );

      const active = await getActiveArtwork(activeProductId);
      expect(active).not.toBeNull();
      expect(active!.id).toBe(draft.id);
      expect(active!.status).toBe("APPROVED");

      // Cleanup
      await db.update(schema.labelArtwork).set({ approvedBySignatureId: null }).where(eq(schema.labelArtwork.id, draft.id)).catch(() => {});
      await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, draft.id)).catch(() => {});
      await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, draft.id)).catch(() => {});
      await db.delete(schema.labelArtwork).where(eq(schema.labelArtwork.id, draft.id)).catch(() => {});
    } finally {
      await db.delete(schema.products).where(eq(schema.products.id, activeProductId)).catch(() => {});
    }
  });
});
