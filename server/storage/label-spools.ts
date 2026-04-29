// R-04 Label Spool storage layer.
//
// receiveSpool — F-04 inline ceremony (LABEL_SPOOL_RECEIVED) then insert spool row.
// disposeSpool — no ceremony; just state change + LABEL_SPOOL_DISPOSED audit row.
// decrementSpoolQty — atomic UPDATE inside caller-supplied transaction.
// listActiveSpools — FIFO (createdAt asc) list of ACTIVE spools for an artwork.
// getSpool — fetch single spool row by id.

import { db, type Tx } from "../db";
import * as schema from "@shared/schema";
import { eq, and, asc, gte, sql } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";
import { MEANING_VERB } from "../signatures/signatures";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReceiveSpoolInput {
  artworkId: string;
  spoolNumber: string;
  qtyInitial: number;
  locationId?: string | null;
}

// ─── receiveSpool ─────────────────────────────────────────────────────────────

export async function receiveSpool(
  input: ReceiveSpoolInput,
  userId: string,
  password: string,
  requestId: string,
  route: string,
): Promise<schema.LabelSpool> {
  // Pre-flight: verify artwork exists and is APPROVED.
  const [artwork] = await db
    .select()
    .from(schema.labelArtwork)
    .where(eq(schema.labelArtwork.id, input.artworkId));

  if (!artwork) {
    throw Object.assign(new Error("Label artwork not found"), { status: 404 });
  }
  if (artwork.status !== "APPROVED") {
    throw Object.assign(
      new Error(`Cannot receive spool against artwork in state ${artwork.status}`),
      { status: 409, code: "ARTWORK_NOT_APPROVED" },
    );
  }

  // F-04 inline ceremony — verify password outside the transaction.
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
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.LABEL_SPOOL_RECEIVED} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "LABEL_SPOOL_RECEIVED" as const,
    entityType: "label_spool",
    signedAt: signedAt.toISOString(),
    snapshot: {
      artworkId: input.artworkId,
      spoolNumber: input.spoolNumber,
      qtyInitial: input.qtyInitial,
    },
  };

  return await db.transaction(async (tx) => {
    // 1. Insert spool row.
    const [spoolRow] = await tx
      .insert(schema.labelSpools)
      .values({
        artworkId: input.artworkId,
        spoolNumber: input.spoolNumber,
        qtyInitial: input.qtyInitial,
        qtyOnHand: input.qtyInitial,
        locationId: input.locationId ?? null,
        status: "ACTIVE",
      })
      .returning();

    const spoolId = spoolRow!.id;

    // 2. Insert signature row first so we have its ID for the spool UPDATE.
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "LABEL_SPOOL_RECEIVED",
        entityType: "label_spool",
        entityId: spoolId,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId,
        manifestationJson: { ...manifestation, entityId: spoolId } as Record<string, unknown>,
      })
      .returning();

    // 3. UPDATE spool to attach the signature ID.
    const [updated] = await tx
      .update(schema.labelSpools)
      .set({ receivedBySignatureId: sigRow!.id })
      .where(eq(schema.labelSpools.id, spoolId))
      .returning();

    // 4. SIGN audit row.
    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "label_spool",
      entityId: spoolId,
      before: null,
      after: { spoolId, status: "ACTIVE" },
      route,
      requestId,
      meta: { signatureId: sigRow!.id, meaning: "LABEL_SPOOL_RECEIVED" },
    });

    // 5. Domain audit row.
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LABEL_SPOOL_RECEIVED",
      entityType: "label_spool",
      entityId: spoolId,
      before: null,
      after: {
        artworkId: input.artworkId,
        spoolNumber: input.spoolNumber,
        qtyInitial: input.qtyInitial,
        status: "ACTIVE",
        receivedBySignatureId: sigRow!.id,
      },
      requestId,
      route,
    });

    return updated!;
  });
}

// ─── disposeSpool ─────────────────────────────────────────────────────────────
// No F-04 ceremony — operational action only.

export async function disposeSpool(
  id: string,
  reason: string,
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.LabelSpool> {
  // Pre-flight: load spool and validate state.
  const [existing] = await db
    .select()
    .from(schema.labelSpools)
    .where(eq(schema.labelSpools.id, id));

  if (!existing) {
    throw Object.assign(new Error("Label spool not found"), { status: 404 });
  }
  if (existing.status !== "ACTIVE") {
    throw Object.assign(
      new Error(`Cannot dispose spool in state ${existing.status}`),
      { status: 409, code: "SPOOL_INVALID_STATE" },
    );
  }

  const disposedAt = new Date();

  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.labelSpools)
      .set({
        status: "DISPOSED",
        disposedAt,
        disposeReason: reason,
      })
      .where(eq(schema.labelSpools.id, id))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LABEL_SPOOL_DISPOSED",
      entityType: "label_spool",
      entityId: id,
      before: { status: existing.status },
      after: { status: "DISPOSED", disposeReason: reason, disposedAt: disposedAt.toISOString() },
      requestId,
      route,
    });

    return updated!;
  });
}

// ─── decrementSpoolQty ────────────────────────────────────────────────────────
// Must be called inside a caller-supplied Drizzle transaction `tx`.
// Atomically decrements qty_on_hand; sets status=DEPLETED if it reaches 0.
// Throws 409 INSUFFICIENT_SPOOL_QTY if qty_on_hand < qty.

export async function decrementSpoolQty(
  spoolId: string,
  qty: number,
  tx: Tx,
): Promise<schema.LabelSpool> {
  const [updated] = await tx
    .update(schema.labelSpools)
    .set({
      qtyOnHand: sql`qty_on_hand - ${qty}`,
      status: sql`CASE WHEN qty_on_hand - ${qty} = 0 THEN 'DEPLETED' ELSE status END`,
    })
    .where(
      and(
        eq(schema.labelSpools.id, spoolId),
        eq(schema.labelSpools.status, "ACTIVE"),  // only decrement from active spools
        gte(schema.labelSpools.qtyOnHand, qty),   // precondition: won't go negative
      ),
    )
    .returning();

  if (!updated) {
    throw Object.assign(
      new Error("Insufficient spool quantity"),
      { status: 409, code: "INSUFFICIENT_SPOOL_QTY" },
    );
  }

  return updated;
}

// ─── listActiveSpools ─────────────────────────────────────────────────────────

export async function listActiveSpools(artworkId: string): Promise<schema.LabelSpool[]> {
  return db
    .select()
    .from(schema.labelSpools)
    .where(
      and(
        eq(schema.labelSpools.artworkId, artworkId),
        eq(schema.labelSpools.status, "ACTIVE"),
      ),
    )
    .orderBy(asc(schema.labelSpools.createdAt));
}

// ─── getSpool ─────────────────────────────────────────────────────────────────

export async function getSpool(id: string): Promise<schema.LabelSpool | undefined> {
  const [row] = await db
    .select()
    .from(schema.labelSpools)
    .where(eq(schema.labelSpools.id, id));
  return row;
}
