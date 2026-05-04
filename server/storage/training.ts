import { eq, and, desc } from "drizzle-orm";
import { db, type Tx } from "../db";
import * as schema from "@shared/schema";
import type { UserRole } from "@shared/schema";

// ─── Programs ─────────────────────────────────────────────────────────────

export async function listPrograms(includeInactive = false) {
  const rows = await db
    .select()
    .from(schema.trainingPrograms)
    .where(includeInactive ? undefined : eq(schema.trainingPrograms.isActive, true))
    .orderBy(schema.trainingPrograms.name);
  return rows;
}

export async function getProgram(id: string) {
  const [prog] = await db
    .select()
    .from(schema.trainingPrograms)
    .where(eq(schema.trainingPrograms.id, id));
  if (!prog) throw Object.assign(new Error("Training program not found"), { status: 404, code: "NOT_FOUND" });
  return prog;
}

export async function createProgram(input: {
  name: string;
  version: string;
  description?: string;
  validityDays: number;
  requiredForRoles: UserRole[];
  documentUrl?: string;
  createdByUserId: string;
  requestId: string;
  route: string;
}) {
  const [prog] = await db
    .insert(schema.trainingPrograms)
    .values({
      name:             input.name,
      version:          input.version,
      description:      input.description ?? null,
      validityDays:     input.validityDays,
      requiredForRoles: input.requiredForRoles,
      documentUrl:      input.documentUrl ?? null,
      createdByUserId:  input.createdByUserId,
    })
    .returning();

  await db.insert(schema.auditTrail).values({
    userId:     input.createdByUserId,
    action:     "TRAINING_PROGRAM_CREATED",
    entityType: "training_program",
    entityId:   prog!.id,
    before:     null,
    after:      prog as Record<string, unknown>,
    route:      input.route,
    requestId:  input.requestId,
  });

  return prog!;
}

// ─── Records ─────────────────────────────────────────────────────────────

export async function listRecords(userId?: string) {
  const baseQuery = db
    .select({
      record:       schema.trainingRecords,
      programName:  schema.trainingPrograms.name,
      programVersion: schema.trainingPrograms.version,
    })
    .from(schema.trainingRecords)
    .innerJoin(schema.trainingPrograms, eq(schema.trainingRecords.programId, schema.trainingPrograms.id))
    .orderBy(desc(schema.trainingRecords.completedAt));

  const rows = userId
    ? await baseQuery.where(eq(schema.trainingRecords.userId, userId))
    : await baseQuery;

  return rows.map((r) => ({ ...r.record, programName: r.programName, programVersion: r.programVersion }));
}

// Returns the most recent training record for (user, program); null if none.
export async function getLatestRecord(userId: string, programId: string) {
  const [record] = await db
    .select()
    .from(schema.trainingRecords)
    .where(and(
      eq(schema.trainingRecords.userId, userId),
      eq(schema.trainingRecords.programId, programId),
    ))
    .orderBy(desc(schema.trainingRecords.completedAt))
    .limit(1);
  return record ?? null;
}

export async function recordTrainingInTx(
  input: {
    userId: string;
    programId: string;
    completedAt: string;
    trainedByUserId?: string;
    trainedByExternal?: string;
    documentUrl?: string;
    notes?: string;
    createdByUserId: string;
    requestId: string;
    route: string;
  },
  tx: Tx,
) {
  const prog = await tx
    .select({ validityDays: schema.trainingPrograms.validityDays })
    .from(schema.trainingPrograms)
    .where(eq(schema.trainingPrograms.id, input.programId))
    .then((r) => r[0]);

  if (!prog) throw Object.assign(new Error("Training program not found"), { status: 404, code: "NOT_FOUND" });

  const completedAt = new Date(input.completedAt);
  const expiresAt   = new Date(completedAt.getTime() + prog.validityDays * 86_400_000);

  const [record] = await tx
    .insert(schema.trainingRecords)
    .values({
      userId:            input.userId,
      programId:         input.programId,
      completedAt,
      expiresAt,
      trainedByUserId:   input.trainedByUserId ?? null,
      trainedByExternal: input.trainedByExternal ?? null,
      documentUrl:       input.documentUrl ?? null,
      notes:             input.notes ?? null,
      createdByUserId:   input.createdByUserId,
    })
    .returning();

  // Complete any open assignment for this user+program
  await tx
    .update(schema.trainingAssignments)
    .set({ status: "COMPLETED", trainingRecordId: record!.id })
    .where(and(
      eq(schema.trainingAssignments.userId, input.userId),
      eq(schema.trainingAssignments.programId, input.programId),
      eq(schema.trainingAssignments.status, "PENDING"),
    ));

  await tx.insert(schema.auditTrail).values({
    userId:     input.createdByUserId,
    action:     "TRAINING_RECORD_ADDED",
    entityType: "training_record",
    entityId:   record!.id,
    before:     null,
    after:      record as Record<string, unknown>,
    route:      input.route,
    requestId:  input.requestId,
  });

  return record!;
}

export async function finalizeTrainingRecord(recordId: string, signatureId: string) {
  const [record] = await db
    .update(schema.trainingRecords)
    .set({ signatureId })
    .where(eq(schema.trainingRecords.id, recordId))
    .returning();
  return record!;
}

// ─── Assignments ─────────────────────────────────────────────────────────

export async function listAssignments(userId?: string) {
  const baseQuery = db
    .select({
      assignment:  schema.trainingAssignments,
      programName: schema.trainingPrograms.name,
    })
    .from(schema.trainingAssignments)
    .innerJoin(schema.trainingPrograms, eq(schema.trainingAssignments.programId, schema.trainingPrograms.id))
    .orderBy(schema.trainingAssignments.dueAt);

  const rows = userId
    ? await baseQuery.where(eq(schema.trainingAssignments.userId, userId))
    : await baseQuery;

  return rows.map((r) => ({ ...r.assignment, programName: r.programName }));
}

export async function createAssignment(input: {
  userId: string;
  programId: string;
  dueAt: string;
  createdByUserId: string;
  requestId: string;
  route: string;
}) {
  const [assignment] = await db
    .insert(schema.trainingAssignments)
    .values({
      userId:          input.userId,
      programId:       input.programId,
      dueAt:           new Date(input.dueAt),
      createdByUserId: input.createdByUserId,
    })
    .returning();

  await db.insert(schema.auditTrail).values({
    userId:     input.createdByUserId,
    action:     "TRAINING_ASSIGNMENT_CREATED",
    entityType: "training_assignment",
    entityId:   assignment!.id,
    before:     null,
    after:      assignment as Record<string, unknown>,
    route:      input.route,
    requestId:  input.requestId,
  });

  return assignment!;
}

// ─── Compliance view ─────────────────────────────────────────────────────

export async function getUserTrainingCompliance(userId: string): Promise<schema.UserTrainingCompliance> {
  const user = await db
    .select({ id: schema.users.id, fullName: schema.users.fullName })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .then((r) => r[0]);

  if (!user) throw Object.assign(new Error("User not found"), { status: 404, code: "NOT_FOUND" });

  const programs = await listPrograms();
  const now = new Date();
  const soonMs = 14 * 86_400_000;

  const complianceRows: schema.TrainingComplianceRow[] = await Promise.all(
    programs.map(async (prog) => {
      const record = await getLatestRecord(userId, prog.id);
      if (!record) {
        return {
          programId:   prog.id,
          programName: prog.name,
          version:     prog.version,
          status:      "NEVER_TRAINED" as const,
          expiresAt:   null,
          completedAt: null,
        };
      }
      const expired = record.expiresAt < now;
      const expiringSoon = !expired && (record.expiresAt.getTime() - now.getTime()) < soonMs;
      return {
        programId:   prog.id,
        programName: prog.name,
        version:     prog.version,
        status:      expired ? "EXPIRED" : expiringSoon ? "EXPIRING_SOON" : "CURRENT",
        expiresAt:   record.expiresAt.toISOString(),
        completedAt: record.completedAt.toISOString(),
      };
    }),
  );

  return { userId: user.id, userName: user.fullName, programs: complianceRows };
}

export async function getAllUsersCompliance(): Promise<schema.UserTrainingCompliance[]> {
  const allUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.status, "ACTIVE"));

  return Promise.all(allUsers.map((u) => getUserTrainingCompliance(u.id)));
}
