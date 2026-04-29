import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";
import { MEANING_VERB } from "../signatures/signatures";

export async function createEquipment(
  data: schema.InsertEquipmentDomain,
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.Equipment> {
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.equipment)
      .where(eq(schema.equipment.assetTag, data.assetTag));
    if (existing.length > 0) {
      throw Object.assign(
        new Error("Equipment with this asset tag already exists"),
        { status: 409, code: "DUPLICATE_ASSET_TAG" },
      );
    }
    let created: schema.Equipment;
    try {
      const [row] = await tx.insert(schema.equipment).values(data).returning();
      created = row!;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "23505") {
        throw Object.assign(
          new Error("Equipment with this assetTag already exists"),
          { status: 409, code: "DUPLICATE_ASSET_TAG" },
        );
      }
      throw e;
    }
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "EQUIPMENT_CREATED",
      entityType: "equipment",
      entityId: created.id,
      after: { assetTag: created.assetTag, name: created.name },
      requestId,
      route,
    });
    return created;
  });
}

export async function listEquipment(): Promise<schema.Equipment[]> {
  return db.select().from(schema.equipment).orderBy(schema.equipment.assetTag);
}

export async function getEquipment(id: string): Promise<schema.Equipment | undefined> {
  const [row] = await db
    .select()
    .from(schema.equipment)
    .where(eq(schema.equipment.id, id));
  return row;
}

export async function retireEquipment(
  id: string,
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.Equipment> {
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.equipment)
      .where(eq(schema.equipment.id, id));
    if (!existing) {
      throw Object.assign(new Error("Equipment not found"), { status: 404 });
    }
    const [updated] = await tx
      .update(schema.equipment)
      .set({ status: "RETIRED" })
      .where(eq(schema.equipment.id, id))
      .returning();
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "EQUIPMENT_RETIRED",
      entityType: "equipment",
      entityId: id,
      before: { status: existing.status },
      after: { status: "RETIRED" },
      requestId,
      route,
    });
    return updated!;
  });
}

// ─── Equipment qualifications (R-03 Task 4) ────────────────────────────────
//
// IQ/OQ/PQ qualification cycles. QA-only; F-04 signature required to mark a
// row as QUALIFIED. Disqualification writes an EXPIRED row with no signature.

export interface RecordQualificationInput {
  type: "IQ" | "OQ" | "PQ";
  status: "PENDING" | "QUALIFIED" | "EXPIRED";
  validFrom?: string;
  validUntil?: string;
  documentUrl?: string;
  notes?: string;
  signaturePassword?: string;
  commentary?: string;
}

export type EquipmentQualificationRow = schema.EquipmentQualification;

export async function recordQualification(
  equipmentId: string,
  userId: string,
  data: RecordQualificationInput,
  requestId: string,
  route: string,
): Promise<EquipmentQualificationRow> {
  // Pre-flight checks (outside ceremony so we fail fast with helpful errors).
  const [existing] = await db
    .select()
    .from(schema.equipment)
    .where(eq(schema.equipment.id, equipmentId));
  if (!existing) {
    throw Object.assign(new Error("Equipment not found"), { status: 404 });
  }

  if (data.status === "QUALIFIED") {
    if (!data.validFrom || !data.validUntil) {
      throw Object.assign(
        new Error("validFrom and validUntil are required when status=QUALIFIED"),
        { status: 400, code: "VALIDITY_WINDOW_REQUIRED" },
      );
    }
    if (!data.signaturePassword) {
      throw Object.assign(
        new Error("signaturePassword required to mark equipment QUALIFIED"),
        { status: 400, code: "SIGNATURE_REQUIRED" },
      );
    }
  }

  const auditAction =
    data.status === "QUALIFIED" ? "EQUIPMENT_QUALIFIED" : "EQUIPMENT_DISQUALIFIED";

  // QUALIFIED: ceremony path. We can't use the standard performSignature
  // helper here because the equipment_qualifications CHECK constraint
  // (qualification_signed_when_qualified) requires signature_id to be NOT
  // NULL on the same INSERT as status='QUALIFIED'. performSignature inserts
  // the signature AFTER fn(tx) runs, so we'd hit the constraint. Instead we
  // inline the ceremony: verify password, then in a single transaction
  // insert signature → insert qualification (with signatureId already set)
  // → insert SIGN + EQUIPMENT_QUALIFIED audit rows.
  //
  // User-load dance mirrors performSignature() — keep in sync if that helper
  // changes its user resolution.
  if (data.status === "QUALIFIED") {
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
    const valid = await verifyPassword(fullUser.passwordHash, data.signaturePassword!);
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
      text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.EQUIPMENT_QUALIFIED} this record on ${signedAt.toISOString()}.`,
      fullName: fullUser.fullName,
      title: fullUser.title ?? null,
      meaning: "EQUIPMENT_QUALIFIED" as const,
      entityType: "equipment",
      entityId: equipmentId,
      signedAt: signedAt.toISOString(),
      snapshot: {
        type: data.type,
        status: data.status,
        validFrom: data.validFrom ?? null,
        validUntil: data.validUntil ?? null,
      },
    };

    return await db.transaction(async (tx) => {
      // 1. Signature row (must exist before qualification insert due to FK + CHECK).
      const [sigRow] = await tx
        .insert(schema.electronicSignatures)
        .values({
          userId: fullUser.id,
          meaning: "EQUIPMENT_QUALIFIED",
          entityType: "equipment",
          entityId: equipmentId,
          commentary: data.commentary ?? null,
          fullNameAtSigning: fullUser.fullName,
          titleAtSigning: fullUser.title ?? null,
          requestId,
          manifestationJson: manifestation as Record<string, unknown>,
        })
        .returning();

      // 2. Qualification row with signatureId set — satisfies the
      //    qualification_signed_when_qualified CHECK constraint.
      const [created] = await tx
        .insert(schema.equipmentQualifications)
        .values({
          equipmentId,
          type: data.type,
          status: data.status,
          validFrom: data.validFrom ?? null,
          validUntil: data.validUntil ?? null,
          signatureId: sigRow!.id,
          documentUrl: data.documentUrl ?? null,
          notes: data.notes ?? null,
        })
        .returning();

      // 3. SIGN audit row (matches what performSignature would write).
      await tx.insert(schema.auditTrail).values({
        userId: fullUser.id,
        action: "SIGN",
        entityType: "equipment",
        entityId: equipmentId,
        before: null,
        after: { qualificationId: created!.id, type: data.type, status: data.status },
        route,
        requestId,
        meta: { signatureId: sigRow!.id, meaning: "EQUIPMENT_QUALIFIED" },
      });

      // 4. Domain audit row (per AC).
      await tx.insert(schema.auditTrail).values({
        userId,
        action: auditAction,
        entityType: "equipment",
        entityId: equipmentId,
        after: {
          qualificationId: created!.id,
          type: data.type,
          status: data.status,
          validFrom: data.validFrom ?? null,
          validUntil: data.validUntil ?? null,
        },
        requestId,
        route,
      });

      return created!;
    });
  }

  // Non-QUALIFIED (PENDING / EXPIRED): no signature ceremony, plain insert.
  return await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.equipmentQualifications)
      .values({
        equipmentId,
        type: data.type,
        status: data.status,
        validFrom: data.validFrom ?? null,
        validUntil: data.validUntil ?? null,
        signatureId: null,
        documentUrl: data.documentUrl ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    await tx.insert(schema.auditTrail).values({
      userId,
      action: auditAction,
      entityType: "equipment",
      entityId: equipmentId,
      after: {
        qualificationId: created!.id,
        type: data.type,
        status: data.status,
        validFrom: data.validFrom ?? null,
        validUntil: data.validUntil ?? null,
      },
      requestId,
      route,
    });
    return created!;
  });
}

export async function listQualifications(
  equipmentId: string,
): Promise<EquipmentQualificationRow[]> {
  return db
    .select()
    .from(schema.equipmentQualifications)
    .where(eq(schema.equipmentQualifications.equipmentId, equipmentId))
    .orderBy(desc(schema.equipmentQualifications.createdAt));
}

// Returns the set of types currently qualified using latest-wins semantics:
// the most recent row for a given type must be status=QUALIFIED AND
// today's date must be within [validFrom, validUntil].
export async function getActiveQualifiedTypes(
  equipmentId: string,
): Promise<Set<"IQ" | "OQ" | "PQ">> {
  const rows = await db
    .select()
    .from(schema.equipmentQualifications)
    .where(eq(schema.equipmentQualifications.equipmentId, equipmentId))
    .orderBy(desc(schema.equipmentQualifications.createdAt));

  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const seen = new Set<"IQ" | "OQ" | "PQ">();
  const active = new Set<"IQ" | "OQ" | "PQ">();

  for (const row of rows) {
    const type = row.type;
    if (seen.has(type)) continue; // latest-wins: skip older rows
    seen.add(type);
    if (
      row.status === "QUALIFIED" &&
      row.validFrom &&
      row.validUntil &&
      row.validFrom <= today &&
      today <= row.validUntil
    ) {
      active.add(type);
    }
  }
  return active;
}

// ─── Calibration schedules + records (R-03 Task 5) ─────────────────────────
//
// One schedule per equipment (UNIQUE constraint on equipment_id). PASS bumps
// nextDueAt = performedAt + frequencyDays. FAIL leaves nextDueAt untouched so
// the equipment stays overdue, blocking BPR start gates.

export interface RecordCalibrationInput {
  result: "PASS" | "FAIL";
  certUrl?: string;
  notes?: string;
  signaturePassword: string;
  commentary?: string;
}

export async function createCalibrationSchedule(
  equipmentId: string,
  frequencyDays: number,
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.CalibrationSchedule> {
  // Pre-flight: verify equipment exists. Outside transaction for fast-fail.
  const [equip] = await db
    .select()
    .from(schema.equipment)
    .where(eq(schema.equipment.id, equipmentId));
  if (!equip) {
    throw Object.assign(new Error("Equipment not found"), { status: 404 });
  }

  return await db.transaction(async (tx) => {
    // UNIQUE(equipment_id) — surface dupes as 409 instead of letting Postgres
    // raise a generic 500.
    const [existing] = await tx
      .select()
      .from(schema.calibrationSchedules)
      .where(eq(schema.calibrationSchedules.equipmentId, equipmentId));
    if (existing) {
      throw Object.assign(
        new Error("Calibration schedule already exists for this equipment"),
        { status: 409, code: "DUPLICATE_CALIBRATION_SCHEDULE" },
      );
    }

    const nextDueAt = new Date(Date.now() + frequencyDays * 24 * 60 * 60 * 1000);
    let created: schema.CalibrationSchedule;
    try {
      const [row] = await tx
        .insert(schema.calibrationSchedules)
        .values({ equipmentId, frequencyDays, nextDueAt })
        .returning();
      created = row!;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "23505") {
        throw Object.assign(
          new Error("Calibration schedule already exists for this equipment"),
          { status: 409, code: "DUPLICATE_CALIBRATION_SCHEDULE" },
        );
      }
      throw e;
    }

    await tx.insert(schema.auditTrail).values({
      userId,
      action: "CALIBRATION_SCHEDULE_CREATED",
      entityType: "calibration_schedule",
      entityId: created.id,
      after: {
        equipmentId,
        frequencyDays,
        nextDueAt: nextDueAt.toISOString(),
      },
      requestId,
      route,
    });

    return created;
  });
}

export async function recordCalibration(
  equipmentId: string,
  userId: string,
  data: RecordCalibrationInput,
  requestId: string,
  route: string,
): Promise<schema.CalibrationRecord> {
  // Pre-flight (outside ceremony so we fail fast with helpful errors).
  const [existing] = await db
    .select()
    .from(schema.equipment)
    .where(eq(schema.equipment.id, equipmentId));
  if (!existing) {
    throw Object.assign(new Error("Equipment not found"), { status: 404 });
  }

  if (data.result !== "PASS" && data.result !== "FAIL") {
    throw Object.assign(
      new Error("result must be PASS or FAIL"),
      { status: 400, code: "INVALID_RESULT" },
    );
  }
  if (!data.signaturePassword) {
    throw Object.assign(
      new Error("signaturePassword required to record calibration"),
      { status: 400, code: "SIGNATURE_REQUIRED" },
    );
  }

  // Inlined F-04 ceremony. We can't use the standard performSignature helper
  // because erp_calibration_records.signature_id is NOT NULL — performSignature
  // inserts the signature row AFTER fn(tx) runs, so the calibration record
  // INSERT inside fn(tx) would violate the NOT NULL constraint. Instead we
  // verify password, then in a single transaction insert signature → insert
  // calibration record (with signatureId already set) → bump schedule on PASS
  // → insert SIGN + CALIBRATION_LOGGED audit rows.
  //
  // User-load dance mirrors performSignature() — keep in sync if that helper
  // changes its user resolution. This same pattern lives in recordQualification
  // above; a `performSignatureBefore` helper could deduplicate, but that's
  // outside the scope of R-03.
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
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.CALIBRATION_RECORDED} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "CALIBRATION_RECORDED" as const,
    entityType: "equipment",
    entityId: equipmentId,
    signedAt: signedAt.toISOString(),
    snapshot: {
      result: data.result,
      certUrl: data.certUrl ?? null,
    },
  };

  return await db.transaction(async (tx) => {
    // 1. Signature row (must exist before record insert due to NOT NULL FK).
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "CALIBRATION_RECORDED",
        entityType: "equipment",
        entityId: equipmentId,
        commentary: data.commentary ?? null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId,
        manifestationJson: manifestation as Record<string, unknown>,
      })
      .returning();

    // 2. Calibration record with signatureId set.
    const [created] = await tx
      .insert(schema.calibrationRecords)
      .values({
        equipmentId,
        performedAt: signedAt,
        performedByUserId: fullUser.id,
        result: data.result,
        certUrl: data.certUrl ?? null,
        signatureId: sigRow!.id,
        notes: data.notes ?? null,
      })
      .returning();

    // 3. PASS only: bump schedule.nextDueAt = performedAt + frequencyDays.
    //    FAIL leaves nextDueAt unchanged so equipment stays overdue.
    if (data.result === "PASS") {
      const [schedRow] = await tx
        .select()
        .from(schema.calibrationSchedules)
        .where(eq(schema.calibrationSchedules.equipmentId, equipmentId));
      if (schedRow) {
        const newDue = new Date(
          signedAt.getTime() + schedRow.frequencyDays * 24 * 60 * 60 * 1000,
        );
        await tx
          .update(schema.calibrationSchedules)
          .set({ nextDueAt: newDue, lastRecordId: created!.id })
          .where(eq(schema.calibrationSchedules.id, schedRow.id));
      }
    }

    // 4. SIGN audit row (mirrors what performSignature would write).
    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "equipment",
      entityId: equipmentId,
      before: null,
      after: { calibrationRecordId: created!.id, result: data.result },
      route,
      requestId,
      meta: { signatureId: sigRow!.id, meaning: "CALIBRATION_RECORDED" },
    });

    // 5. Domain audit row.
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "CALIBRATION_LOGGED",
      entityType: "equipment",
      entityId: equipmentId,
      after: {
        calibrationRecordId: created!.id,
        result: data.result,
        performedAt: signedAt.toISOString(),
      },
      requestId,
      route,
    });

    return created!;
  });
}

export async function getCalibrationStatus(
  equipmentId: string,
): Promise<{
  schedule: schema.CalibrationSchedule | null;
  records: schema.CalibrationRecord[];
}> {
  const [schedule] = await db
    .select()
    .from(schema.calibrationSchedules)
    .where(eq(schema.calibrationSchedules.equipmentId, equipmentId));

  const records = await db
    .select()
    .from(schema.calibrationRecords)
    .where(eq(schema.calibrationRecords.equipmentId, equipmentId))
    .orderBy(desc(schema.calibrationRecords.performedAt))
    .limit(50);

  return { schedule: schedule ?? null, records };
}
