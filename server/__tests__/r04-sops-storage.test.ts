import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import {
  createSop,
  approveSop,
  retireSop,
  getSopByCode,
  listSops,
} from "../storage/sops";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

let adminId: string;
let qaId: string;

const createdSopIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;

  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04sop-adm-${sfx}@t.com`,
      fullName: "R04Sop Admin",
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
      email: `r04sop-qa-${sfx}@t.com`,
      fullName: "R04Sop QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: qaId, role: "QA", grantedByUserId: adminId });
});

afterAll(async () => {
  if (!dbUrl) return;

  // Nullify FK references before deleting signatures
  for (const id of createdSopIds) {
    await db
      .update(schema.sops)
      .set({ approvedBySignatureId: null, retiredBySignatureId: null })
      .where(eq(schema.sops.id, id))
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
      .delete(schema.sops)
      .where(eq(schema.sops.id, id))
      .catch(() => {});
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

/** Helper to build a minimal SOP input with a unique code/version. */
function sopInput(suffix: string) {
  return {
    code: `SOP-R04-${suffix}`,
    version: `v1.${suffix}`,
    title: `Test SOP ${suffix}`,
    status: "DRAFT" as const,
  };
}

describeIfDb("R-04 SOP storage", () => {
  // ─── createSop ──────────────────────────────────────────────────────────────

  it("createSop — inserts DRAFT row and writes SOP_CREATED audit", async () => {
    const row = await createSop(
      sopInput("create"),
      adminId,
      "req-sop-create",
      "POST /api/sops",
    );
    createdSopIds.push(row.id);

    expect(row.status).toBe("DRAFT");
    expect(row.code).toBe("SOP-R04-create");
    expect(row.version).toBe("v1.create");
    expect(row.title).toBe("Test SOP create");
    expect(row.approvedBySignatureId).toBeNull();
    expect(row.retiredBySignatureId).toBeNull();

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, row.id));
    expect(audit.some((a) => a.action === "SOP_CREATED")).toBe(true);
  });

  // ─── approveSop ─────────────────────────────────────────────────────────────

  it("approveSop — happy path: DRAFT→APPROVED, approvedBySignatureId non-null, SOP_APPROVED audit", async () => {
    const draft = await createSop(
      sopInput(`approve-${Date.now()}`),
      adminId,
      "req-sop-approve-create",
      "POST /api/sops",
    );
    createdSopIds.push(draft.id);

    const approved = await approveSop(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-sop-approve",
      "POST /api/sops/:id/approve",
    );

    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBySignatureId).toBeTruthy();
    expect(approved.approvedAt).toBeTruthy();

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, draft.id));
    expect(audit.some((a) => a.action === "SOP_APPROVED")).toBe(true);
    expect(audit.some((a) => a.action === "SIGN")).toBe(true);

    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, draft.id));
    expect(sigs.some((s) => s.meaning === "SOP_APPROVED")).toBe(true);
  });

  it("approveSop — throws 409 SOP_INVALID_STATE when already APPROVED", async () => {
    const draft = await createSop(
      sopInput(`approve2-${Date.now()}`),
      adminId,
      "req-sop-a2-create",
      "POST /api/sops",
    );
    createdSopIds.push(draft.id);

    await approveSop(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-sop-a2-first",
      "POST /api/sops/:id/approve",
    );

    await expect(
      approveSop(
        draft.id,
        qaId,
        VALID_PASSWORD,
        "req-sop-a2-second",
        "POST /api/sops/:id/approve",
      ),
    ).rejects.toMatchObject({ status: 409, code: "SOP_INVALID_STATE" });
  });

  // ─── retireSop ──────────────────────────────────────────────────────────────

  it("retireSop — happy path: APPROVED→RETIRED, retiredBySignatureId non-null, SOP_RETIRED audit", async () => {
    const draft = await createSop(
      sopInput(`retire-${Date.now()}`),
      adminId,
      "req-sop-retire-create",
      "POST /api/sops",
    );
    createdSopIds.push(draft.id);

    await approveSop(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-sop-retire-approve",
      "POST /api/sops/:id/approve",
    );

    const retired = await retireSop(
      draft.id,
      qaId,
      VALID_PASSWORD,
      "req-sop-retire",
      "POST /api/sops/:id/retire",
    );

    expect(retired.status).toBe("RETIRED");
    expect(retired.retiredBySignatureId).toBeTruthy();
    expect(retired.retiredAt).toBeTruthy();

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, draft.id));
    expect(audit.some((a) => a.action === "SOP_RETIRED")).toBe(true);

    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, draft.id));
    expect(sigs.some((s) => s.meaning === "SOP_RETIRED")).toBe(true);
  });

  it("retireSop — throws 409 SOP_INVALID_STATE when DRAFT", async () => {
    const draft = await createSop(
      sopInput(`retirebad-${Date.now()}`),
      adminId,
      "req-sop-rb-create",
      "POST /api/sops",
    );
    createdSopIds.push(draft.id);

    await expect(
      retireSop(
        draft.id,
        qaId,
        VALID_PASSWORD,
        "req-sop-rb-retire",
        "POST /api/sops/:id/retire",
      ),
    ).rejects.toMatchObject({ status: 409, code: "SOP_INVALID_STATE" });
  });

  // ─── getSopByCode ────────────────────────────────────────────────────────────

  it("getSopByCode — returns row for known code+version, undefined for unknown", async () => {
    const sfx = Date.now();
    const row = await createSop(
      { code: `SOP-GETCODE-${sfx}`, version: "v1.0", title: "GetCode Test", status: "DRAFT" },
      adminId,
      "req-sop-getcode",
      "POST /api/sops",
    );
    createdSopIds.push(row.id);

    const found = await getSopByCode(`SOP-GETCODE-${sfx}`, "v1.0");
    expect(found).toBeDefined();
    expect(found!.id).toBe(row.id);

    const missing = await getSopByCode(`SOP-GETCODE-${sfx}`, "v9.9");
    expect(missing).toBeUndefined();
  });

  // ─── listSops ────────────────────────────────────────────────────────────────

  it("listSops — returns all SOPs including those created in this suite", async () => {
    const result = await listSops();
    expect(Array.isArray(result)).toBe(true);
    // Should have at least the SOPs created in this test run
    expect(result.length).toBeGreaterThan(0);
  });
});
