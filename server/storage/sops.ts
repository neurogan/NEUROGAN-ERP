// R-04 SOP storage layer.
//
// F-04 ceremony pattern (same as label-artwork.ts):
// approveSop and retireSop need to set approvedBySignatureId /
// retiredBySignatureId on the SOP row, which requires the signature ID
// before the UPDATE runs. Verify password OUTSIDE the transaction, then
// insert signature row FIRST inside tx (to get sigId), then UPDATE the
// SOP row with the signature ID already in hand.

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";
import { MEANING_VERB } from "../signatures/signatures";

// ─── createSop ───────────────────────────────────────────────────────────────

export async function createSop(
  input: schema.InsertSop,
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.Sop> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.sops)
      .values({ ...input, status: "DRAFT" })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId,
      action: "SOP_CREATED",
      entityType: "sop",
      entityId: row!.id,
      after: {
        code: row!.code,
        version: row!.version,
        title: row!.title,
        status: row!.status,
      },
      requestId,
      route,
    });

    return row!;
  });
}

// ─── approveSop ──────────────────────────────────────────────────────────────

export async function approveSop(
  id: string,
  userId: string,
  password: string,
  requestId: string,
  route: string,
): Promise<schema.Sop> {
  // Pre-flight: load SOP and validate state before ceremony.
  const [existing] = await db
    .select()
    .from(schema.sops)
    .where(eq(schema.sops.id, id));

  if (!existing) {
    throw Object.assign(new Error("SOP not found"), { status: 404 });
  }
  if (existing.status !== "DRAFT") {
    throw Object.assign(
      new Error(`Cannot approve SOP in state ${existing.status}`),
      { status: 409, code: "SOP_INVALID_STATE" },
    );
  }

  // F-04 inline ceremony — same user-load pattern as label-artwork.ts.
  const fullUser = await storage.getUserByEmail(
    await storage.getUserById(userId).then((u) => {
      if (!u) throw Object.assign(new Error("User not found"), { status: 404 });
      return u.email;
    }),
  );
  if (!fullUser) throw Object.assign(new Error("User not found"), { status: 404 });
  if (fullUser.lockedUntil && fullUser.lockedUntil > new Date()) {
    throw Object.assign(
      new Error("Account temporarily locked due to too many failed attempts."),
      { status: 423, code: "ACCOUNT_LOCKED" },
    );
  }
  const valid = await verifyPassword(fullUser.passwordHash, password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throw Object.assign(new Error("Password is incorrect."), {
      status: 401,
      code: "UNAUTHENTICATED",
    });
  }
  await storage.recordSuccessfulLogin(fullUser.id);

  const signedAt = new Date();
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";
  const manifestation = {
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.SOP_APPROVED} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "SOP_APPROVED" as const,
    entityType: "sop",
    entityId: id,
    signedAt: signedAt.toISOString(),
    snapshot: {
      code: existing.code,
      version: existing.version,
      title: existing.title,
      status: existing.status,
    },
  };

  return await db.transaction(async (tx) => {
    // 1. Insert signature row first so we have its ID for the SOP UPDATE.
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "SOP_APPROVED",
        entityType: "sop",
        entityId: id,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId,
        manifestationJson: manifestation as Record<string, unknown>,
      })
      .returning();

    // 2. UPDATE SOP to APPROVED, setting approvedBySignatureId.
    const [updated] = await tx
      .update(schema.sops)
      .set({
        status: "APPROVED",
        approvedBySignatureId: sigRow!.id,
        approvedAt: signedAt,
      })
      .where(eq(schema.sops.id, id))
      .returning();

    // 3. SIGN audit row (mirrors what performSignature would write).
    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "sop",
      entityId: id,
      before: null,
      after: { sopId: id, status: "APPROVED" },
      route,
      requestId,
      meta: { signatureId: sigRow!.id, meaning: "SOP_APPROVED" },
    });

    // 4. Domain audit row.
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "SOP_APPROVED",
      entityType: "sop",
      entityId: id,
      before: { status: existing.status },
      after: { status: "APPROVED", approvedBySignatureId: sigRow!.id },
      requestId,
      route,
    });

    return updated!;
  });
}

// ─── retireSop ───────────────────────────────────────────────────────────────

export async function retireSop(
  id: string,
  userId: string,
  password: string,
  requestId: string,
  route: string,
): Promise<schema.Sop> {
  // Pre-flight: load SOP and validate state before ceremony.
  const [existing] = await db
    .select()
    .from(schema.sops)
    .where(eq(schema.sops.id, id));

  if (!existing) {
    throw Object.assign(new Error("SOP not found"), { status: 404 });
  }
  if (existing.status !== "APPROVED") {
    throw Object.assign(
      new Error(`Cannot retire SOP in state ${existing.status}`),
      { status: 409, code: "SOP_INVALID_STATE" },
    );
  }

  // F-04 inline ceremony.
  const fullUser = await storage.getUserByEmail(
    await storage.getUserById(userId).then((u) => {
      if (!u) throw Object.assign(new Error("User not found"), { status: 404 });
      return u.email;
    }),
  );
  if (!fullUser) throw Object.assign(new Error("User not found"), { status: 404 });
  if (fullUser.lockedUntil && fullUser.lockedUntil > new Date()) {
    throw Object.assign(
      new Error("Account temporarily locked due to too many failed attempts."),
      { status: 423, code: "ACCOUNT_LOCKED" },
    );
  }
  const valid = await verifyPassword(fullUser.passwordHash, password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throw Object.assign(new Error("Password is incorrect."), {
      status: 401,
      code: "UNAUTHENTICATED",
    });
  }
  await storage.recordSuccessfulLogin(fullUser.id);

  const signedAt = new Date();
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";
  const manifestation = {
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.SOP_RETIRED} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "SOP_RETIRED" as const,
    entityType: "sop",
    entityId: id,
    signedAt: signedAt.toISOString(),
    snapshot: {
      code: existing.code,
      version: existing.version,
      title: existing.title,
      status: existing.status,
    },
  };

  return await db.transaction(async (tx) => {
    // 1. Insert signature row first so we have its ID for the SOP UPDATE.
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "SOP_RETIRED",
        entityType: "sop",
        entityId: id,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId,
        manifestationJson: manifestation as Record<string, unknown>,
      })
      .returning();

    // 2. UPDATE SOP to RETIRED, setting retiredBySignatureId.
    const [updated] = await tx
      .update(schema.sops)
      .set({
        status: "RETIRED",
        retiredBySignatureId: sigRow!.id,
        retiredAt: signedAt,
      })
      .where(eq(schema.sops.id, id))
      .returning();

    // 3. SIGN audit row.
    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "sop",
      entityId: id,
      before: null,
      after: { sopId: id, status: "RETIRED" },
      route,
      requestId,
      meta: { signatureId: sigRow!.id, meaning: "SOP_RETIRED" },
    });

    // 4. Domain audit row.
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "SOP_RETIRED",
      entityType: "sop",
      entityId: id,
      before: { status: existing.status },
      after: { status: "RETIRED", retiredBySignatureId: sigRow!.id },
      requestId,
      route,
    });

    return updated!;
  });
}

// ─── getSop ──────────────────────────────────────────────────────────────────

export async function getSop(id: string): Promise<schema.Sop | undefined> {
  const [row] = await db
    .select()
    .from(schema.sops)
    .where(eq(schema.sops.id, id));
  return row;
}

// ─── getSopByCode ─────────────────────────────────────────────────────────────

export async function getSopByCode(
  code: string,
  version: string,
): Promise<schema.Sop | undefined> {
  const [row] = await db
    .select()
    .from(schema.sops)
    .where(and(eq(schema.sops.code, code), eq(schema.sops.version, version)));
  return row;
}

// ─── listSops ─────────────────────────────────────────────────────────────────

export async function listSops(): Promise<schema.Sop[]> {
  return db
    .select()
    .from(schema.sops)
    .orderBy(schema.sops.code, desc(schema.sops.version));
}
