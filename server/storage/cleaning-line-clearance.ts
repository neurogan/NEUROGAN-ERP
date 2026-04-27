import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";
import { MEANING_VERB } from "../signatures/signatures";

// ─── Cleaning logs (R-03 Task 6: F-05 dual-verification) ─────────────────────
//
// Cleaning logs require TWO distinct users: a cleaner and a verifier. The
// signing user (the request initiator) supplies their password and is the
// one who signs the record. The DB-level CHECK constraint
// `cleaning_dual_verification` (migration 0017) enforces
// `cleaned_by_user_id <> verified_by_user_id` as defense-in-depth, but we
// also pre-check at storage entry so we surface a friendly 409 IDENTITY_SAME
// instead of a generic 23514 from Postgres.

export interface CreateCleaningLogInput {
  cleanedByUserId: string;
  verifiedByUserId: string;
  method?: string;
  priorProductId?: string;
  nextProductId?: string;
  notes?: string;
  signaturePassword: string;
  commentary?: string;
}

export async function createCleaningLog(
  equipmentId: string,
  signingUserId: string,
  data: CreateCleaningLogInput,
  requestId: string,
  route: string,
): Promise<schema.CleaningLog> {
  // F-05 dual-verification gate (route-layer-friendly 409). The DB CHECK is
  // defense-in-depth; this pre-check avoids a generic 23514.
  if (data.cleanedByUserId === data.verifiedByUserId) {
    throw Object.assign(
      new Error("Cleaner and verifier must be different users"),
      { status: 409, code: "IDENTITY_SAME" },
    );
  }

  if (!data.signaturePassword) {
    throw Object.assign(
      new Error("signaturePassword required to record cleaning"),
      { status: 400, code: "SIGNATURE_REQUIRED" },
    );
  }

  // Pre-flight: verify equipment exists. Outside transaction for fast-fail.
  const [existing] = await db
    .select()
    .from(schema.equipment)
    .where(eq(schema.equipment.id, equipmentId));
  if (!existing) {
    throw Object.assign(new Error("Equipment not found"), { status: 404 });
  }

  // Inlined F-04 ceremony. We can't use the standard performSignature helper
  // because erp_cleaning_logs.signature_id is NOT NULL — performSignature
  // inserts the signature row AFTER fn(tx) runs, so the cleaning log INSERT
  // inside fn(tx) would violate the NOT NULL constraint. Instead we verify
  // password, then in a single transaction insert signature → insert
  // cleaning log (with signatureId already set) → insert SIGN +
  // CLEANING_LOGGED audit rows.
  //
  // User-load dance mirrors performSignature() — keep in sync if that helper
  // changes its user resolution. This same pattern lives in recordQualification
  // and recordCalibration; a `performSignatureBefore` helper could deduplicate,
  // but that's outside the scope of R-03.
  const fullUser = await storage.getUserByEmail(
    await storage.getUserById(signingUserId).then((u) => {
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
  const valid = await verifyPassword(fullUser.passwordHash, data.signaturePassword);
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
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.CLEANING_VERIFIED} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "CLEANING_VERIFIED" as const,
    entityType: "equipment",
    entityId: equipmentId,
    signedAt: signedAt.toISOString(),
    snapshot: {
      cleanedByUserId: data.cleanedByUserId,
      verifiedByUserId: data.verifiedByUserId,
      method: data.method ?? null,
      priorProductId: data.priorProductId ?? null,
      nextProductId: data.nextProductId ?? null,
    },
  };

  return await db.transaction(async (tx) => {
    // 1. Signature row (must exist before cleaning log insert due to NOT NULL FK).
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "CLEANING_VERIFIED",
        entityType: "equipment",
        entityId: equipmentId,
        commentary: data.commentary ?? null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId,
        manifestationJson: manifestation as Record<string, unknown>,
      })
      .returning();

    // 2. Cleaning log with signatureId set. The DB CHECK
    //    `cleaning_dual_verification` will reject same-user as 23514 if our
    //    pre-check above is somehow bypassed (defense in depth).
    const [created] = await tx
      .insert(schema.cleaningLogs)
      .values({
        equipmentId,
        cleanedAt: signedAt,
        cleanedByUserId: data.cleanedByUserId,
        verifiedByUserId: data.verifiedByUserId,
        method: data.method ?? null,
        priorProductId: data.priorProductId ?? null,
        nextProductId: data.nextProductId ?? null,
        signatureId: sigRow!.id,
        notes: data.notes ?? null,
      })
      .returning();

    // 3. SIGN audit row (mirrors what performSignature would write).
    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "equipment",
      entityId: equipmentId,
      before: null,
      after: { cleaningLogId: created!.id },
      route,
      requestId,
      meta: { signatureId: sigRow!.id, meaning: "CLEANING_VERIFIED" },
    });

    // 4. Domain audit row.
    await tx.insert(schema.auditTrail).values({
      userId: signingUserId,
      action: "CLEANING_LOGGED",
      entityType: "equipment",
      entityId: equipmentId,
      after: {
        cleaningLogId: created!.id,
        cleanedByUserId: data.cleanedByUserId,
        verifiedByUserId: data.verifiedByUserId,
        method: data.method ?? null,
        cleanedAt: signedAt.toISOString(),
      },
      requestId,
      route,
    });

    return created!;
  });
}

export async function listCleaningLogs(
  equipmentId: string,
): Promise<schema.CleaningLog[]> {
  return db
    .select()
    .from(schema.cleaningLogs)
    .where(eq(schema.cleaningLogs.equipmentId, equipmentId))
    .orderBy(desc(schema.cleaningLogs.cleanedAt))
    .limit(100);
}

// ─── Line clearances (R-03 Task 7) ───────────────────────────────────────────
//
// Task 7 will append: createLineClearance, listLineClearances, findClearance.
