// R-05 Complaints & SAER storage layer.
//
// State machine rules enforced here (per F-05):
//   1. LOT_UNRESOLVED → TRIAGE only after lot_id is set.
//   2. Cannot CLOSE without disposition_signature_id (COMPLAINT_REVIEW meaning).
//   3. Cannot CLOSE if ae_flag=true AND medwatch_required=true AND no SAER submission.
//   4. Cannot sign disposition if capa_required is null.
//
// signDisposition and submitSaer follow the F-04 inline ceremony pattern
// (password verify outside tx, atomic tx: record → sig → update → audit rows).

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, isNull, ilike } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";
import { MEANING_VERB } from "../signatures/signatures";
import { addBusinessDays } from "../lib/business-days";
import { enqueueCallback } from "../integrations/helpcore";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function throwStatus(status: number, message: string, code?: string): never {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

async function getSettingInt(key: string, defaultVal: number): Promise<number> {
  const [row] = await db.select().from(schema.appSettingsKv).where(eq(schema.appSettingsKv.key, key));
  return row ? parseInt(row.value, 10) : defaultVal;
}

async function resolveComplaint(id: string): Promise<schema.Complaint> {
  const [row] = await db.select().from(schema.complaints).where(eq(schema.complaints.id, id));
  if (!row) throwStatus(404, "Complaint not found");
  return row!;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getComplaint(id: string): Promise<schema.Complaint> {
  return resolveComplaint(id);
}

export async function listComplaints(filters?: {
  status?: schema.ComplaintStatus;
  lotId?: string;
  search?: string;
  aeOnly?: boolean;
}): Promise<schema.Complaint[]> {
  let query = db.select().from(schema.complaints).$dynamic();

  if (filters?.status) {
    query = query.where(eq(schema.complaints.status, filters.status));
  }
  if (filters?.lotId) {
    query = query.where(eq(schema.complaints.lotId, filters.lotId));
  }
  if (filters?.aeOnly) {
    query = query.where(eq(schema.complaints.aeFlag, true));
  }

  return query.orderBy(desc(schema.complaints.intakeAt));
}

export async function getComplaintTriage(complaintId: string): Promise<schema.ComplaintTriage | null> {
  const [row] = await db
    .select()
    .from(schema.complaintTriages)
    .where(eq(schema.complaintTriages.complaintId, complaintId))
    .orderBy(desc(schema.complaintTriages.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getComplaintInvestigation(complaintId: string): Promise<schema.ComplaintInvestigation | null> {
  const [row] = await db
    .select()
    .from(schema.complaintInvestigations)
    .where(eq(schema.complaintInvestigations.complaintId, complaintId))
    .orderBy(desc(schema.complaintInvestigations.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getComplaintLabRetests(complaintId: string): Promise<schema.ComplaintLabRetest[]> {
  return db
    .select()
    .from(schema.complaintLabRetests)
    .where(eq(schema.complaintLabRetests.complaintId, complaintId))
    .orderBy(desc(schema.complaintLabRetests.requestedAt));
}

export async function getAdverseEvent(complaintId: string): Promise<schema.AdverseEvent | null> {
  const [row] = await db
    .select()
    .from(schema.adverseEvents)
    .where(eq(schema.adverseEvents.complaintId, complaintId));
  return row ?? null;
}

export async function getSaerSubmission(adverseEventId: string): Promise<schema.SaerSubmission | null> {
  const [row] = await db
    .select()
    .from(schema.saerSubmissions)
    .where(eq(schema.saerSubmissions.adverseEventId, adverseEventId));
  return row ?? null;
}

// ─── Create intake ────────────────────────────────────────────────────────────

export async function intakeComplaint(input: {
  helpcoreRef: string;
  source: schema.ComplaintSource;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  lotCode: string;
  complaintText: string;
  severity?: schema.ComplaintSeverity;
  createdByUserId: string;
  requestId: string;
  route: string;
}): Promise<{ complaint: schema.Complaint; status: schema.ComplaintStatus }> {
  // Dedupe
  const [existing] = await db
    .select({ id: schema.complaints.id })
    .from(schema.complaints)
    .where(eq(schema.complaints.helpcoreRef, input.helpcoreRef));
  if (existing) throwStatus(409, "Duplicate helpcoreRef", "DUPLICATE_HELPCORE_REF");

  // Resolve lot
  const [lotRow] = await db
    .select({ id: schema.lots.id })
    .from(schema.lots)
    .where(ilike(schema.lots.lotNumber, input.lotCode));

  const lotId = lotRow?.id ?? null;
  const status: schema.ComplaintStatus = lotId ? "TRIAGE" : "LOT_UNRESOLVED";
  const now = new Date();

  const [complaint] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.complaints)
      .values({
        helpcoreRef: input.helpcoreRef,
        source: input.source,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone ?? null,
        complaintText: input.complaintText,
        lotCodeRaw: input.lotCode,
        lotId,
        status,
        severity: input.severity ?? null,
        intakeAt: now,
        createdByUserId: input.createdByUserId,
      })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.createdByUserId,
      action: "COMPLAINT_INTAKE",
      entityType: "complaint",
      entityId: row!.id,
      before: null,
      after: { status, lotId, source: input.source },
      requestId: input.requestId,
      route: input.route,
    });

    return [row!];
  });

  return { complaint: complaint!, status };
}

// ─── Lot link ─────────────────────────────────────────────────────────────────

export async function linkComplaintLot(input: {
  complaintId: string;
  lotId: string;
  userId: string;
  requestId: string;
  route: string;
}): Promise<schema.Complaint> {
  const complaint = await resolveComplaint(input.complaintId);
  if (complaint.status !== "LOT_UNRESOLVED") {
    throwStatus(409, "Complaint is not in LOT_UNRESOLVED status", "INVALID_TRANSITION");
  }

  const [lot] = await db.select({ id: schema.lots.id }).from(schema.lots).where(eq(schema.lots.id, input.lotId));
  if (!lot) throwStatus(404, "Lot not found");

  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.complaints)
      .set({ lotId: input.lotId, status: "TRIAGE", updatedAt: new Date() })
      .where(eq(schema.complaints.id, input.complaintId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "COMPLAINT_LOT_LINKED",
      entityType: "complaint",
      entityId: input.complaintId,
      before: { lotId: null, status: "LOT_UNRESOLVED" },
      after: { lotId: input.lotId, status: "TRIAGE" },
      requestId: input.requestId,
      route: input.route,
    });

    return [row!];
  });

  return updated!;
}

// ─── Triage ───────────────────────────────────────────────────────────────────

export async function triageComplaint(input: {
  complaintId: string;
  userId: string;
  severity: schema.ComplaintSeverity;
  defectCategory: schema.ComplaintDefectCategory;
  aeFlag: boolean;
  batchLinkConfirmed: boolean;
  notes?: string;
  requestId: string;
  route: string;
}): Promise<schema.Complaint> {
  const complaint = await resolveComplaint(input.complaintId);
  if (complaint.status !== "TRIAGE") {
    throwStatus(409, "Complaint is not in TRIAGE status", "INVALID_TRANSITION");
  }

  const nextStatus: schema.ComplaintStatus = input.aeFlag ? "AE_URGENT_REVIEW" : "INVESTIGATION";
  const now = new Date();

  const [updated] = await db.transaction(async (tx) => {
    await tx.insert(schema.complaintTriages).values({
      complaintId: input.complaintId,
      triagedByUserId: input.userId,
      triagedAt: now,
      severity: input.severity,
      defectCategory: input.defectCategory,
      aeFlag: input.aeFlag,
      batchLinkConfirmed: input.batchLinkConfirmed,
      notes: input.notes ?? null,
    });

    const [row] = await tx
      .update(schema.complaints)
      .set({
        status: nextStatus,
        severity: input.severity,
        defectCategory: input.defectCategory,
        aeFlag: input.aeFlag,
        triagedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.complaints.id, input.complaintId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "COMPLAINT_TRIAGED",
      entityType: "complaint",
      entityId: input.complaintId,
      before: { status: "TRIAGE" },
      after: { status: nextStatus, severity: input.severity, defectCategory: input.defectCategory, aeFlag: input.aeFlag },
      requestId: input.requestId,
      route: input.route,
    });

    return [row!];
  });

  return updated!;
}

// ─── Investigation ────────────────────────────────────────────────────────────

export async function submitInvestigation(input: {
  complaintId: string;
  userId: string;
  rootCause: string;
  scope: string;
  bprId?: string;
  coaId?: string;
  retestRequired: boolean;
  summaryForReview: string;
  requestId: string;
  route: string;
}): Promise<schema.ComplaintInvestigation> {
  const complaint = await resolveComplaint(input.complaintId);
  if (complaint.status !== "INVESTIGATION") {
    throwStatus(409, "Complaint is not in INVESTIGATION status", "INVALID_TRANSITION");
  }

  const now = new Date();

  return db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(schema.complaintInvestigations)
      .values({
        complaintId: input.complaintId,
        investigatedByUserId: input.userId,
        investigatedAt: now,
        rootCause: input.rootCause,
        scope: input.scope,
        bprId: input.bprId ?? null,
        coaId: input.coaId ?? null,
        retestRequired: input.retestRequired,
        summaryForReview: input.summaryForReview,
      })
      .returning();

    await tx.update(schema.complaints)
      .set({ investigatedAt: now, updatedAt: now })
      .where(eq(schema.complaints.id, input.complaintId));

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "COMPLAINT_INVESTIGATED",
      entityType: "complaint",
      entityId: input.complaintId,
      before: null,
      after: { investigationId: inv!.id, retestRequired: input.retestRequired },
      requestId: input.requestId,
      route: input.route,
    });

    return inv!;
  });
}

export async function packageInvestigation(input: {
  complaintId: string;
  investigationId: string;
  userId: string;
  requestId: string;
  route: string;
}): Promise<schema.ComplaintInvestigation> {
  const complaint = await resolveComplaint(input.complaintId);
  if (complaint.status !== "INVESTIGATION") {
    throwStatus(409, "Complaint is not in INVESTIGATION status", "INVALID_TRANSITION");
  }

  const now = new Date();

  const [updated] = await db.transaction(async (tx) => {
    const [inv] = await tx
      .update(schema.complaintInvestigations)
      .set({ packagedAt: now, packagedByUserId: input.userId, updatedAt: now })
      .where(
        and(
          eq(schema.complaintInvestigations.id, input.investigationId),
          eq(schema.complaintInvestigations.complaintId, input.complaintId),
        ),
      )
      .returning();

    if (!inv) throwStatus(404, "Investigation not found for this complaint");

    await tx.update(schema.complaints)
      .set({ status: "AWAITING_DISPOSITION", updatedAt: now })
      .where(eq(schema.complaints.id, input.complaintId));

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "COMPLAINT_INVESTIGATION_PACKAGED",
      entityType: "complaint",
      entityId: input.complaintId,
      before: { status: "INVESTIGATION" },
      after: { status: "AWAITING_DISPOSITION", investigationId: input.investigationId },
      requestId: input.requestId,
      route: input.route,
    });

    return [inv!];
  });

  return updated!;
}

// ─── Lab retest ───────────────────────────────────────────────────────────────

export async function requestLabRetest(input: {
  complaintId: string;
  investigationId: string;
  userId: string;
  lotId: string;
  method: string;
  assignedLabUserId: string;
  requestId: string;
  route: string;
}): Promise<schema.ComplaintLabRetest> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [retest] = await tx
      .insert(schema.complaintLabRetests)
      .values({
        complaintId: input.complaintId,
        investigationId: input.investigationId,
        requestedByUserId: input.userId,
        requestedAt: now,
        lotId: input.lotId,
        method: input.method,
        assignedLabUserId: input.assignedLabUserId,
      })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "COMPLAINT_LAB_RETEST_REQUESTED",
      entityType: "complaint",
      entityId: input.complaintId,
      before: null,
      after: { retestId: retest!.id, method: input.method },
      requestId: input.requestId,
      route: input.route,
    });

    return retest!;
  });
}

export async function completeLabRetest(input: {
  retestId: string;
  complaintId: string;
  userId: string;
  labTestResultId?: string;
  requestId: string;
  route: string;
}): Promise<schema.ComplaintLabRetest> {
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [retest] = await tx
      .update(schema.complaintLabRetests)
      .set({ completedAt: now, labTestResultId: input.labTestResultId ?? null })
      .where(
        and(
          eq(schema.complaintLabRetests.id, input.retestId),
          eq(schema.complaintLabRetests.complaintId, input.complaintId),
          isNull(schema.complaintLabRetests.completedAt),
        ),
      )
      .returning();

    if (!retest) throwStatus(409, "Retest not found or already completed");

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "COMPLAINT_LAB_RETEST_COMPLETED",
      entityType: "complaint",
      entityId: input.complaintId,
      before: null,
      after: { retestId: input.retestId },
      requestId: input.requestId,
      route: input.route,
    });

    return [retest!];
  });
  return updated!;
}

// ─── Urgent review (AE branch) ────────────────────────────────────────────────

export async function submitUrgentReview(input: {
  complaintId: string;
  userId: string;
  serious: boolean;
  seriousCriteria: Record<string, boolean>;
  medwatchRequired: boolean;
  requestId: string;
  route: string;
}): Promise<{ complaint: schema.Complaint; adverseEvent: schema.AdverseEvent }> {
  const complaint = await resolveComplaint(input.complaintId);
  if (complaint.status !== "AE_URGENT_REVIEW") {
    throwStatus(409, "Complaint is not in AE_URGENT_REVIEW status", "INVALID_TRANSITION");
  }

  const saerDays = await getSettingInt("saerClockBusinessDays", 15);
  const now = new Date();
  const dueAt = input.serious ? await addBusinessDays(now, saerDays) : now;

  return db.transaction(async (tx) => {
    const [ae] = await tx
      .insert(schema.adverseEvents)
      .values({
        complaintId: input.complaintId,
        serious: input.serious,
        seriousCriteria: input.seriousCriteria,
        urgentReviewedByUserId: input.userId,
        urgentReviewedAt: now,
        medwatchRequired: input.medwatchRequired,
        clockStartedAt: now,
        dueAt,
        status: "OPEN",
      })
      .returning();

    const [updatedComplaint] = await tx
      .update(schema.complaints)
      .set({ status: "INVESTIGATION", updatedAt: now })
      .where(eq(schema.complaints.id, input.complaintId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "COMPLAINT_AE_URGENT_REVIEWED",
      entityType: "complaint",
      entityId: input.complaintId,
      before: { status: "AE_URGENT_REVIEW" },
      after: { status: "INVESTIGATION", adverseEventId: ae!.id, serious: input.serious, dueAt: dueAt.toISOString() },
      requestId: input.requestId,
      route: input.route,
    });

    return { complaint: updatedComplaint!, adverseEvent: ae! };
  });
}

// ─── Disposition (F-04 ceremony, COMPLAINT_REVIEW) ────────────────────────────

export async function signDisposition(input: {
  complaintId: string;
  userId: string;
  password: string;
  dispositionSummary: string;
  capaRequired: boolean;
  capaRef?: string;
  requestId: string;
  route: string;
}): Promise<schema.Complaint> {
  const complaint = await resolveComplaint(input.complaintId);

  if (complaint.status !== "AWAITING_DISPOSITION") {
    throwStatus(409, "Complaint is not in AWAITING_DISPOSITION status", "INVALID_TRANSITION");
  }

  // Rule 3: AE with medwatch_required must have a SAER submission before closing
  if (complaint.aeFlag) {
    const ae = await getAdverseEvent(input.complaintId);
    if (ae?.medwatchRequired) {
      const saer = ae ? await getSaerSubmission(ae.id) : null;
      if (!saer?.submittedAt) {
        throwStatus(409, "Cannot sign disposition: SAER submission required before closing an AE complaint", "SAER_REQUIRED");
      }
    }
  }

  // F-04 ceremony — verify password outside transaction
  const fullUser = await storage.getUserByEmail(
    await storage.getUserById(input.userId).then((u) => {
      if (!u) throwStatus(404, "User not found");
      return u!.email;
    }),
  );
  if (!fullUser) throwStatus(404, "User not found");
  if (fullUser.lockedUntil && fullUser.lockedUntil > new Date()) {
    throwStatus(423, "Account temporarily locked due to too many failed attempts.", "ACCOUNT_LOCKED");
  }
  const valid = await verifyPassword(fullUser.passwordHash, input.password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throwStatus(401, "Password is incorrect.", "UNAUTHENTICATED");
  }
  await storage.recordSuccessfulLogin(fullUser.id);

  const signedAt = new Date();
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";
  const manifestation = {
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.COMPLAINT_REVIEW} this complaint record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "COMPLAINT_REVIEW" as const,
    entityType: "complaint",
    signedAt: signedAt.toISOString(),
    snapshot: { complaintId: input.complaintId, dispositionSummary: input.dispositionSummary, capaRequired: input.capaRequired },
  };

  return db.transaction(async (tx) => {
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "COMPLAINT_REVIEW",
        entityType: "complaint",
        entityId: input.complaintId,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId: input.requestId,
        manifestationJson: { ...manifestation, entityId: input.complaintId } as Record<string, unknown>,
      })
      .returning();

    const now = new Date();
    const [updated] = await tx
      .update(schema.complaints)
      .set({
        status: "CLOSED",
        dispositionSignatureId: sigRow!.id,
        dispositionSummary: input.dispositionSummary,
        capaRequired: input.capaRequired,
        capaRef: input.capaRef ?? null,
        dispositionedAt: signedAt,
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.complaints.id, input.complaintId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "complaint",
      entityId: input.complaintId,
      before: null,
      after: { signatureId: sigRow!.id, meaning: "COMPLAINT_REVIEW" },
      route: input.route,
      requestId: input.requestId,
      meta: { signatureId: sigRow!.id, meaning: "COMPLAINT_REVIEW" },
    });

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "COMPLAINT_DISPOSITION_SIGNED",
      entityType: "complaint",
      entityId: input.complaintId,
      before: { status: "AWAITING_DISPOSITION" },
      after: { status: "CLOSED", signatureId: sigRow!.id, capaRequired: input.capaRequired },
      requestId: input.requestId,
      route: input.route,
    });

    // Enqueue outbound HelpCore callback (non-blocking, feature-flagged)
    enqueueCallback({
      helpcoreRef: updated!.helpcoreRef,
      complaintId: input.complaintId,
      disposition: {
        summary: input.dispositionSummary,
        signedAt: signedAt.toISOString(),
        signedByRole: "QA",
        capaOpened: input.capaRequired,
        capaRef: input.capaRef ?? null,
      },
    });

    return updated!;
  });
}

// ─── SAER: save draft ─────────────────────────────────────────────────────────

export async function saveSaerDraft(input: {
  complaintId: string;
  adverseEventId: string;
  draftJson: Record<string, unknown>;
  userId: string;
  requestId: string;
  route: string;
}): Promise<schema.SaerSubmission> {
  const [existing] = await db
    .select()
    .from(schema.saerSubmissions)
    .where(eq(schema.saerSubmissions.adverseEventId, input.adverseEventId));

  const now = new Date();

  if (existing) {
    const [updated] = await db
      .update(schema.saerSubmissions)
      .set({ draftJson: input.draftJson, updatedAt: now })
      .where(eq(schema.saerSubmissions.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(schema.saerSubmissions)
    .values({
      adverseEventId: input.adverseEventId,
      draftJson: input.draftJson,
    })
    .returning();

  return created!;
}

// ─── SAER: submit (F-04 ceremony, SAER_SUBMIT) ────────────────────────────────

export async function submitSaer(input: {
  complaintId: string;
  adverseEventId: string;
  userId: string;
  password: string;
  draftJson: Record<string, unknown>;
  requestId: string;
  route: string;
}): Promise<schema.SaerSubmission> {
  // F-04 ceremony — verify password outside transaction
  const fullUser = await storage.getUserByEmail(
    await storage.getUserById(input.userId).then((u) => {
      if (!u) throwStatus(404, "User not found");
      return u!.email;
    }),
  );
  if (!fullUser) throwStatus(404, "User not found");
  if (fullUser.lockedUntil && fullUser.lockedUntil > new Date()) {
    throwStatus(423, "Account temporarily locked due to too many failed attempts.", "ACCOUNT_LOCKED");
  }
  const valid = await verifyPassword(fullUser.passwordHash, input.password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throwStatus(401, "Password is incorrect.", "UNAUTHENTICATED");
  }
  await storage.recordSuccessfulLogin(fullUser.id);

  const submittedAt = new Date();
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";
  const manifestation = {
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.SAER_SUBMIT} this adverse event on ${submittedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "SAER_SUBMIT" as const,
    entityType: "saer_submission",
    signedAt: submittedAt.toISOString(),
    snapshot: { adverseEventId: input.adverseEventId },
  };

  return db.transaction(async (tx) => {
    // Upsert SAER submission row first (without sigId)
    const [existing] = await tx
      .select()
      .from(schema.saerSubmissions)
      .where(eq(schema.saerSubmissions.adverseEventId, input.adverseEventId));

    let saerRow: schema.SaerSubmission;
    if (existing) {
      const [u] = await tx
        .update(schema.saerSubmissions)
        .set({ draftJson: input.draftJson, submittedAt, submittedByUserId: fullUser.id, updatedAt: submittedAt })
        .where(eq(schema.saerSubmissions.id, existing.id))
        .returning();
      saerRow = u!;
    } else {
      const [c] = await tx
        .insert(schema.saerSubmissions)
        .values({ adverseEventId: input.adverseEventId, draftJson: input.draftJson, submittedAt, submittedByUserId: fullUser.id })
        .returning();
      saerRow = c!;
    }

    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "SAER_SUBMIT",
        entityType: "saer_submission",
        entityId: saerRow.id,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId: input.requestId,
        manifestationJson: { ...manifestation, entityId: saerRow.id } as Record<string, unknown>,
      })
      .returning();

    const [finalSaer] = await tx
      .update(schema.saerSubmissions)
      .set({ signatureId: sigRow!.id, updatedAt: submittedAt })
      .where(eq(schema.saerSubmissions.id, saerRow.id))
      .returning();

    await tx
      .update(schema.adverseEvents)
      .set({ status: "SUBMITTED", updatedAt: submittedAt })
      .where(eq(schema.adverseEvents.id, input.adverseEventId));

    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "saer_submission",
      entityId: saerRow.id,
      before: null,
      after: { signatureId: sigRow!.id, meaning: "SAER_SUBMIT" },
      route: input.route,
      requestId: input.requestId,
      meta: { signatureId: sigRow!.id, meaning: "SAER_SUBMIT" },
    });

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "SAER_SUBMITTED",
      entityType: "complaint",
      entityId: input.complaintId,
      before: null,
      after: { saerSubmissionId: saerRow.id, signatureId: sigRow!.id },
      requestId: input.requestId,
      route: input.route,
    });

    return finalSaer!;
  });
}

// ─── SAER: capture acknowledgment ────────────────────────────────────────────

export async function acknowledgesSaer(input: {
  saerSubmissionId: string;
  acknowledgmentRef: string;
  submissionProofPath?: string;
  userId: string;
  requestId: string;
  route: string;
}): Promise<schema.SaerSubmission> {
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.saerSubmissions)
      .set({
        acknowledgmentRef: input.acknowledgmentRef,
        submissionProofPath: input.submissionProofPath ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.saerSubmissions.id, input.saerSubmissionId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "SAER_ACKNOWLEDGED",
      entityType: "saer_submission",
      entityId: input.saerSubmissionId,
      before: null,
      after: { acknowledgmentRef: input.acknowledgmentRef },
      requestId: input.requestId,
      route: input.route,
    });

    return [row!];
  });
  return updated!;
}

// ─── Dashboard summary counts ─────────────────────────────────────────────────

export async function getComplaintsSummary(): Promise<{
  awaitingTriage: number;
  triageOverdue: number;
  aeDueSoon: number;
  awaitingDisposition: number;
  dispositionOverdue: number;
  callbackFailures: number;
}> {
  const { getFailedCallbackIds } = await import("../integrations/helpcore");
  const { businessDaysUntil } = await import("../lib/business-days");

  const triageRows = await db
    .select({ intakeAt: schema.complaints.intakeAt })
    .from(schema.complaints)
    .where(eq(schema.complaints.status, "TRIAGE"));

  const [slaTriageRow] = await db
    .select()
    .from(schema.appSettingsKv)
    .where(eq(schema.appSettingsKv.key, "complaintTriageSlaBusinessDays"));
  const triageSla = slaTriageRow ? parseInt(slaTriageRow.value, 10) : 1;

  const [slaDispRow] = await db
    .select()
    .from(schema.appSettingsKv)
    .where(eq(schema.appSettingsKv.key, "dispositionSlaBusinessDays"));
  const dispSla = slaDispRow ? parseInt(slaDispRow.value, 10) : 5;

  const now = new Date();
  let triageOverdue = 0;
  for (const { intakeAt } of triageRows) {
    const elapsed = await businessDaysUntil(new Date(intakeAt), now);
    if (elapsed >= triageSla) triageOverdue++;
  }

  const dispositionRows = await db
    .select({ investigatedAt: schema.complaints.investigatedAt })
    .from(schema.complaints)
    .where(eq(schema.complaints.status, "AWAITING_DISPOSITION"));

  let dispositionOverdue = 0;
  for (const { investigatedAt } of dispositionRows) {
    if (!investigatedAt) continue;
    const elapsed = await businessDaysUntil(new Date(investigatedAt), now);
    if (elapsed >= dispSla) dispositionOverdue++;
  }

  const openAes = await db
    .select({ dueAt: schema.adverseEvents.dueAt })
    .from(schema.adverseEvents)
    .where(eq(schema.adverseEvents.status, "OPEN"));

  const aeDueSoon = (
    await Promise.all(openAes.map(ae => businessDaysUntil(now, ae.dueAt)))
  ).filter(bds => bds <= 2).length;

  return {
    awaitingTriage: triageRows.length,
    triageOverdue,
    aeDueSoon,
    awaitingDisposition: dispositionRows.length,
    dispositionOverdue,
    callbackFailures: getFailedCallbackIds().length,
  };
}
