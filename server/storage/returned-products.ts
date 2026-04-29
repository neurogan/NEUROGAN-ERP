// R-06 Returned Products storage layer.
//
// State machine:
//   QUARANTINE → DISPOSED (after F-04 disposition signing)
//
// Auto-investigation: when the count of returns for a given lot reaches or
// exceeds the `returnsInvestigationThresholdCount` app setting, an OPEN
// return_investigation is created — unless one is already open for that lot.

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, ilike, desc, sql } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function throwStatus(status: number, msg: string, code?: string): never {
  throw Object.assign(new Error(msg), { status, ...(code ? { code } : {}) });
}

async function getNextReturnRef(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `RET-${today}`;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.returnedProducts)
    .where(sql`${schema.returnedProducts.returnRef} LIKE ${prefix + "%"}`);
  const seq = (row?.count ?? 0) + 1;
  return `RET-${today}-${String(seq).padStart(3, "0")}`;
}

async function getThreshold(): Promise<number> {
  const [row] = await db
    .select()
    .from(schema.appSettingsKv)
    .where(eq(schema.appSettingsKv.key, "returnsInvestigationThresholdCount"));
  return row ? parseInt(row.value, 10) : 3;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getReturnedProduct(id: string): Promise<schema.ReturnedProduct> {
  const [row] = await db
    .select()
    .from(schema.returnedProducts)
    .where(eq(schema.returnedProducts.id, id));
  if (!row) throwStatus(404, "Returned product not found");
  return row!;
}

export async function listReturnedProducts(filters?: {
  status?: schema.ReturnedProductStatus;
  lotId?: string;
}): Promise<schema.ReturnedProduct[]> {
  const conditions = [];
  if (filters?.status) conditions.push(eq(schema.returnedProducts.status, filters.status));
  if (filters?.lotId) conditions.push(eq(schema.returnedProducts.lotId, filters.lotId));
  return db.select().from(schema.returnedProducts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.returnedProducts.receivedAt));
}

export async function getReturnInvestigation(id: string): Promise<schema.ReturnInvestigation> {
  const [row] = await db
    .select()
    .from(schema.returnInvestigations)
    .where(eq(schema.returnInvestigations.id, id));
  if (!row) throwStatus(404, "Return investigation not found");
  return row!;
}

export async function listReturnInvestigations(filters?: {
  status?: schema.ReturnInvestigationStatus;
  lotId?: string;
}): Promise<schema.ReturnInvestigation[]> {
  const conditions = [];
  if (filters?.status) conditions.push(eq(schema.returnInvestigations.status, filters.status));
  if (filters?.lotId) conditions.push(eq(schema.returnInvestigations.lotId, filters.lotId));
  return db.select().from(schema.returnInvestigations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.returnInvestigations.triggeredAt));
}

export async function getReturnsSummary(): Promise<{
  awaitingDisposition: number;
  openInvestigations: number;
}> {
  const [dispRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.returnedProducts)
    .where(eq(schema.returnedProducts.status, "QUARANTINE"));

  const [invRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.returnInvestigations)
    .where(eq(schema.returnInvestigations.status, "OPEN"));

  return {
    awaitingDisposition: dispRow?.count ?? 0,
    openInvestigations: invRow?.count ?? 0,
  };
}

// ─── Create intake ────────────────────────────────────────────────────────────

export async function createReturnIntake(input: {
  source: schema.ReturnSource;
  lotCodeRaw: string;
  lotId?: string | null;
  qtyReturned: number;
  uom: string;
  wholesaleCustomerName?: string | null;
  carrierTrackingRef?: string | null;
  conditionNotes?: string | null;
  receivedAt: Date;
  userId: string;
  requestId: string;
  route: string;
}): Promise<{ returnedProduct: schema.ReturnedProduct; investigationOpened: boolean }> {
  let lotId = input.lotId ?? null;
  if (!lotId) {
    const [lotRow] = await db
      .select({ id: schema.lots.id })
      .from(schema.lots)
      .where(ilike(schema.lots.lotNumber, input.lotCodeRaw));
    lotId = lotRow?.id ?? null;
  }

  const returnRef = await getNextReturnRef();
  const threshold = await getThreshold();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.returnedProducts)
      .values({
        returnRef,
        source: input.source,
        lotId,
        lotCodeRaw: input.lotCodeRaw,
        qtyReturned: input.qtyReturned,
        uom: input.uom,
        wholesaleCustomerName: input.wholesaleCustomerName ?? null,
        carrierTrackingRef: input.carrierTrackingRef ?? null,
        conditionNotes: input.conditionNotes ?? null,
        receivedByUserId: input.userId,
        receivedAt: input.receivedAt,
        status: "QUARANTINE",
        createdByUserId: input.userId,
      })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "RETURN_INTAKE",
      entityType: "returned_product",
      entityId: row!.id,
      before: null,
      after: { status: "QUARANTINE", returnRef, lotId, source: input.source },
      requestId: input.requestId,
      route: input.route,
    });

    let investigationOpened = false;

    if (lotId) {
      const [{ count: returnsCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.returnedProducts)
        .where(eq(schema.returnedProducts.lotId, lotId));

      const [openInv] = await tx
        .select({ id: schema.returnInvestigations.id })
        .from(schema.returnInvestigations)
        .where(and(
          eq(schema.returnInvestigations.lotId, lotId),
          eq(schema.returnInvestigations.status, "OPEN"),
        ));

      if (returnsCount >= threshold && !openInv) {
        const [inv] = await tx
          .insert(schema.returnInvestigations)
          .values({
            lotId,
            triggeredAt: new Date(),
            returnsCount,
            thresholdAtTrigger: threshold,
          })
          .returning();

        await tx
          .update(schema.returnedProducts)
          .set({ investigationTriggered: true })
          .where(eq(schema.returnedProducts.id, row!.id));

        await tx.insert(schema.auditTrail).values({
          userId: input.userId,
          action: "RETURN_INVESTIGATION_OPENED",
          entityType: "return_investigation",
          entityId: inv!.id,
          before: null,
          after: { lotId, returnsCount, threshold },
          requestId: input.requestId,
          route: input.route,
        });

        investigationOpened = true;
      }
    }

    const [finalRow] = await tx
      .select()
      .from(schema.returnedProducts)
      .where(eq(schema.returnedProducts.id, row!.id));

    return { returnedProduct: finalRow!, investigationOpened };
  });
}

// ─── Disposition (F-04 ceremony, RETURNED_PRODUCT_DISPOSITION) ────────────────

export async function signDisposition(input: {
  returnedProductId: string;
  userId: string;
  password: string;
  disposition: schema.ReturnDisposition;
  dispositionNotes?: string | null;
  requestId: string;
  route: string;
}): Promise<schema.ReturnedProduct> {
  const rp = await getReturnedProduct(input.returnedProductId);
  if (rp.status !== "QUARANTINE") {
    throwStatus(409, "Return is not in QUARANTINE status", "INVALID_TRANSITION");
  }
  if (!rp.lotId) {
    throwStatus(409, "Lot must be confirmed before signing disposition", "LOT_UNRESOLVED");
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
    throwStatus(423, "Account temporarily locked", "ACCOUNT_LOCKED");
  }
  const valid = await verifyPassword(fullUser.passwordHash, input.password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throwStatus(401, "Password is incorrect.", "UNAUTHENTICATED");
  }
  await storage.recordSuccessfulLogin(fullUser.id);

  const signedAt = new Date();
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";

  return db.transaction(async (tx) => {
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "RETURNED_PRODUCT_DISPOSITION",
        entityType: "returned_product",
        entityId: input.returnedProductId,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId: input.requestId,
        manifestationJson: {
          text: `I, ${fullUser.fullName}${titlePart}, hereby issued return disposition for this record on ${signedAt.toISOString()}.`,
          fullName: fullUser.fullName,
          title: fullUser.title ?? null,
          meaning: "RETURNED_PRODUCT_DISPOSITION",
          entityType: "returned_product",
          entityId: input.returnedProductId,
          signedAt: signedAt.toISOString(),
          snapshot: { disposition: input.disposition },
        } as Record<string, unknown>,
      })
      .returning();

    const now = new Date();
    const [updated] = await tx
      .update(schema.returnedProducts)
      .set({
        status: "DISPOSED",
        disposition: input.disposition,
        dispositionNotes: input.dispositionNotes ?? null,
        dispositionSignatureId: sigRow!.id,
        dispositionedByUserId: fullUser.id,
        dispositionedAt: signedAt,
        updatedAt: now,
      })
      .where(eq(schema.returnedProducts.id, input.returnedProductId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "returned_product",
      entityId: input.returnedProductId,
      before: null,
      after: { signatureId: sigRow!.id, meaning: "RETURNED_PRODUCT_DISPOSITION" },
      route: input.route,
      requestId: input.requestId,
      meta: { signatureId: sigRow!.id, meaning: "RETURNED_PRODUCT_DISPOSITION" },
    });

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "RETURN_DISPOSITION_SIGNED",
      entityType: "returned_product",
      entityId: input.returnedProductId,
      before: { status: "QUARANTINE" },
      after: { status: "DISPOSED", disposition: input.disposition, signatureId: sigRow!.id },
      requestId: input.requestId,
      route: input.route,
    });

    return updated!;
  });
}

// ─── Close investigation (F-04 ceremony, RETURN_INVESTIGATION_CLOSE) ──────────

export async function closeReturnInvestigation(input: {
  investigationId: string;
  userId: string;
  password: string;
  rootCause: string;
  correctiveAction: string;
  requestId: string;
  route: string;
}): Promise<schema.ReturnInvestigation> {
  const inv = await getReturnInvestigation(input.investigationId);
  if (inv.status !== "OPEN") {
    throwStatus(409, "Investigation is not open", "INVALID_TRANSITION");
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
    throwStatus(423, "Account temporarily locked", "ACCOUNT_LOCKED");
  }
  const valid = await verifyPassword(fullUser.passwordHash, input.password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throwStatus(401, "Password is incorrect.", "UNAUTHENTICATED");
  }
  await storage.recordSuccessfulLogin(fullUser.id);

  const signedAt = new Date();
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";

  return db.transaction(async (tx) => {
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "RETURN_INVESTIGATION_CLOSE",
        entityType: "return_investigation",
        entityId: input.investigationId,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId: input.requestId,
        manifestationJson: {
          text: `I, ${fullUser.fullName}${titlePart}, hereby closed return investigation for this record on ${signedAt.toISOString()}.`,
          fullName: fullUser.fullName,
          title: fullUser.title ?? null,
          meaning: "RETURN_INVESTIGATION_CLOSE",
          entityType: "return_investigation",
          entityId: input.investigationId,
          signedAt: signedAt.toISOString(),
          snapshot: { rootCause: input.rootCause, correctiveAction: input.correctiveAction },
        } as Record<string, unknown>,
      })
      .returning();

    const now = new Date();
    const [updated] = await tx
      .update(schema.returnInvestigations)
      .set({
        status: "CLOSED",
        rootCause: input.rootCause,
        correctiveAction: input.correctiveAction,
        closedByUserId: fullUser.id,
        closedAt: signedAt,
        closeSignatureId: sigRow!.id,
        updatedAt: now,
      })
      .where(eq(schema.returnInvestigations.id, input.investigationId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "return_investigation",
      entityId: input.investigationId,
      before: null,
      after: { signatureId: sigRow!.id, meaning: "RETURN_INVESTIGATION_CLOSE" },
      route: input.route,
      requestId: input.requestId,
      meta: { signatureId: sigRow!.id, meaning: "RETURN_INVESTIGATION_CLOSE" },
    });

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "RETURN_INVESTIGATION_CLOSED",
      entityType: "return_investigation",
      entityId: input.investigationId,
      before: { status: "OPEN" },
      after: { status: "CLOSED", signatureId: sigRow!.id, rootCause: input.rootCause },
      requestId: input.requestId,
      route: input.route,
    });

    return updated!;
  });
}
