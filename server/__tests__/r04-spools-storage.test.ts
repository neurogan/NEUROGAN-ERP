import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { createArtwork, approveArtwork } from "../storage/label-artwork";
import {
  receiveSpool,
  disposeSpool,
  decrementSpoolQty,
  listActiveSpools,
  getSpool,
} from "../storage/label-spools";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

let adminId: string;
let qaId: string;
let productId: string;
let approvedArtworkId: string;
let draftArtworkId: string;

const createdSpoolIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;

  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04spool-adm-${sfx}@t.com`,
      fullName: "R04Spool Admin",
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
      email: `r04spool-qa-${sfx}@t.com`,
      fullName: "R04Spool QA",
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
    .values({ sku: `R04SPOOL-${sfx}`, name: "R04 Spool Test Product" })
    .returning();
  productId = prod!.id;

  // Create an APPROVED artwork for spool receive tests.
  const draft = await createArtwork(
    {
      productId,
      version: "v1.0",
      artworkFileName: "label-v1.pdf",
      artworkFileData: "base64dataplaceholder",
      artworkMimeType: "application/pdf",
      variableDataSpec: { lotNumber: true, expirationDate: true },
      status: "DRAFT" as const,
    },
    adminId,
    "req-artwork-create",
    "POST /api/label-artwork",
  );
  const approved = await approveArtwork(
    draft.id,
    qaId,
    VALID_PASSWORD,
    "req-artwork-approve",
    "POST /api/label-artwork/:id/approve",
  );
  approvedArtworkId = approved.id;

  // Create a DRAFT artwork for the "cannot receive against non-APPROVED" test.
  const draft2 = await createArtwork(
    {
      productId,
      version: "v2.0",
      artworkFileName: "label-v2.pdf",
      artworkFileData: "base64dataplaceholder",
      artworkMimeType: "application/pdf",
      variableDataSpec: { lotNumber: true, expirationDate: true },
      status: "DRAFT" as const,
    },
    adminId,
    "req-artwork-draft",
    "POST /api/label-artwork",
  );
  draftArtworkId = draft2.id;
});

afterAll(async () => {
  if (!dbUrl) return;

  // Delete spools (FK: receivedBySignatureId, disposedBySignatureId → electronic_signatures)
  for (const id of createdSpoolIds) {
    await db
      .update(schema.labelSpools)
      .set({ receivedBySignatureId: null, disposedBySignatureId: null })
      .where(eq(schema.labelSpools.id, id))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, id))
      .catch(() => {});
    await db.delete(schema.labelSpools).where(eq(schema.labelSpools.id, id)).catch(() => {});
  }

  // Cleanup artworks
  for (const artId of [approvedArtworkId, draftArtworkId].filter(Boolean)) {
    await db
      .update(schema.labelArtwork)
      .set({ approvedBySignatureId: null, retiredBySignatureId: null })
      .where(eq(schema.labelArtwork.id, artId))
      .catch(() => {});
    await db
      .delete(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, artId))
      .catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, artId))
      .catch(() => {});
    await db.delete(schema.labelArtwork).where(eq(schema.labelArtwork.id, artId)).catch(() => {});
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

function spoolInput(suffix: string, qty = 500) {
  return {
    artworkId: approvedArtworkId,
    spoolNumber: `SPOOL-${suffix}-${Date.now()}`,
    qtyInitial: qty,
  };
}

describeIfDb("R-04 label spools storage", () => {
  // ─── receiveSpool ─────────────────────────────────────────────────────────────

  it("receiveSpool — happy path: ACTIVE spool, qtyOnHand = qtyInitial, receivedBySignatureId non-null, audit row", async () => {
    const input = spoolInput("receive");
    const spool = await receiveSpool(
      input,
      qaId,
      VALID_PASSWORD,
      "req-receive-1",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(spool.id);

    expect(spool.status).toBe("ACTIVE");
    expect(spool.qtyOnHand).toBe(input.qtyInitial);
    expect(spool.qtyInitial).toBe(input.qtyInitial);
    expect(spool.receivedBySignatureId).toBeTruthy();
    expect(spool.artworkId).toBe(approvedArtworkId);

    // Audit row should exist.
    const audits = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, spool.id));
    expect(audits.some((a) => a.action === "LABEL_SPOOL_RECEIVED")).toBe(true);

    // Signature row should exist.
    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, spool.id));
    expect(sigs.some((s) => s.meaning === "LABEL_SPOOL_RECEIVED")).toBe(true);
  });

  it("receiveSpool — throws 409 ARTWORK_NOT_APPROVED when artwork is DRAFT", async () => {
    await expect(
      receiveSpool(
        {
          artworkId: draftArtworkId,
          spoolNumber: `SPOOL-DRAFT-${Date.now()}`,
          qtyInitial: 100,
        },
        qaId,
        VALID_PASSWORD,
        "req-receive-draft",
        "POST /api/label-spools",
      ),
    ).rejects.toMatchObject({ status: 409, code: "ARTWORK_NOT_APPROVED" });
  });

  // ─── getSpool ─────────────────────────────────────────────────────────────────

  it("getSpool — returns row by id, undefined for unknown", async () => {
    const input = spoolInput("getone");
    const spool = await receiveSpool(
      input,
      qaId,
      VALID_PASSWORD,
      "req-getone",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(spool.id);

    const fetched = await getSpool(spool.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(spool.id);

    const missing = await getSpool("00000000-0000-0000-0000-000000000000");
    expect(missing).toBeUndefined();
  });

  // ─── disposeSpool ─────────────────────────────────────────────────────────────

  it("disposeSpool — happy path: status DISPOSED, disposedAt set, audit row written (no F-04 sig)", async () => {
    const input = spoolInput("dispose");
    const spool = await receiveSpool(
      input,
      qaId,
      VALID_PASSWORD,
      "req-dispose-receive",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(spool.id);

    const disposed = await disposeSpool(
      spool.id,
      "Damaged in transit",
      adminId,
      "req-dispose-1",
      "POST /api/label-spools/:id/dispose",
    );

    expect(disposed.status).toBe("DISPOSED");
    expect(disposed.disposedAt).toBeTruthy();
    expect(disposed.disposeReason).toBe("Damaged in transit");

    const audits = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, spool.id));
    expect(audits.some((a) => a.action === "LABEL_SPOOL_DISPOSED")).toBe(true);

    // No F-04 signature row written on dispose (no LABEL_SPOOL_DISPOSED meaning)
    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, spool.id));
    expect(sigs.filter((s) => s.meaning !== "LABEL_SPOOL_RECEIVED")).toHaveLength(0);
  });

  it("disposeSpool — throws 404 when spool not found", async () => {
    await expect(
      disposeSpool(
        "00000000-0000-0000-0000-000000000000",
        "reason",
        adminId,
        "req-dispose-missing",
        "POST /api/label-spools/:id/dispose",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("disposeSpool — throws 409 when spool is already DISPOSED", async () => {
    const input = spoolInput("dispose2x");
    const spool = await receiveSpool(
      input,
      qaId,
      VALID_PASSWORD,
      "req-dispose2x-receive",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(spool.id);

    await disposeSpool(
      spool.id,
      "First dispose",
      adminId,
      "req-dispose2x-1",
      "POST /api/label-spools/:id/dispose",
    );

    await expect(
      disposeSpool(
        spool.id,
        "Second dispose",
        adminId,
        "req-dispose2x-2",
        "POST /api/label-spools/:id/dispose",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  // ─── decrementSpoolQty ────────────────────────────────────────────────────────

  it("decrementSpoolQty — reduces qtyOnHand", async () => {
    const input = spoolInput("decrement", 200);
    const spool = await receiveSpool(
      input,
      qaId,
      VALID_PASSWORD,
      "req-decrement-receive",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(spool.id);

    const updated = await db.transaction(async (tx) => {
      return decrementSpoolQty(spool.id, 50, tx);
    });

    expect(updated.qtyOnHand).toBe(150);
    expect(updated.status).toBe("ACTIVE");
  });

  it("decrementSpoolQty — sets status to DEPLETED when qty reaches zero", async () => {
    const input = spoolInput("depleted", 100);
    const spool = await receiveSpool(
      input,
      qaId,
      VALID_PASSWORD,
      "req-depleted-receive",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(spool.id);

    const updated = await db.transaction(async (tx) => {
      return decrementSpoolQty(spool.id, 100, tx);
    });

    expect(updated.qtyOnHand).toBe(0);
    expect(updated.status).toBe("DEPLETED");
  });

  it("decrementSpoolQty — throws 409 INSUFFICIENT_SPOOL_QTY when qty > qtyOnHand", async () => {
    const input = spoolInput("insufficient", 50);
    const spool = await receiveSpool(
      input,
      qaId,
      VALID_PASSWORD,
      "req-insufficient-receive",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(spool.id);

    await expect(
      db.transaction(async (tx) => {
        return decrementSpoolQty(spool.id, 100, tx);
      }),
    ).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_SPOOL_QTY" });
  });

  // ─── listActiveSpools ─────────────────────────────────────────────────────────

  it("listActiveSpools — returns ACTIVE spools in FIFO order (oldest first)", async () => {
    // Create 3 spools in sequence; FIFO means createdAt ascending.
    const s1 = await receiveSpool(
      { artworkId: approvedArtworkId, spoolNumber: `FIFO-A-${Date.now()}`, qtyInitial: 10 },
      qaId,
      VALID_PASSWORD,
      "req-fifo-1",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(s1.id);

    // Small delay to ensure distinct createdAt timestamps.
    await new Promise((r) => setTimeout(r, 5));

    const s2 = await receiveSpool(
      { artworkId: approvedArtworkId, spoolNumber: `FIFO-B-${Date.now()}`, qtyInitial: 10 },
      qaId,
      VALID_PASSWORD,
      "req-fifo-2",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(s2.id);

    await new Promise((r) => setTimeout(r, 5));

    const s3 = await receiveSpool(
      { artworkId: approvedArtworkId, spoolNumber: `FIFO-C-${Date.now()}`, qtyInitial: 10 },
      qaId,
      VALID_PASSWORD,
      "req-fifo-3",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(s3.id);

    const active = await listActiveSpools(approvedArtworkId);
    // Filter to just the ones we created in this test.
    const ours = active.filter((s) => [s1.id, s2.id, s3.id].includes(s.id));
    expect(ours.length).toBe(3);

    // Verify FIFO order (oldest first).
    const ids = ours.map((s) => s.id);
    expect(ids[0]).toBe(s1.id);
    expect(ids[1]).toBe(s2.id);
    expect(ids[2]).toBe(s3.id);
  });

  it("listActiveSpools — excludes DISPOSED spools", async () => {
    const s = await receiveSpool(
      { artworkId: approvedArtworkId, spoolNumber: `EXCL-${Date.now()}`, qtyInitial: 10 },
      qaId,
      VALID_PASSWORD,
      "req-excl-receive",
      "POST /api/label-spools",
    );
    createdSpoolIds.push(s.id);

    await disposeSpool(
      s.id,
      "exclude test",
      adminId,
      "req-excl-dispose",
      "POST /api/label-spools/:id/dispose",
    );

    const active = await listActiveSpools(approvedArtworkId);
    expect(active.some((sp) => sp.id === s.id)).toBe(false);
  });
});
