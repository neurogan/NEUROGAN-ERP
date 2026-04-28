// R-04 Label Artwork storage layer.
//
// F-04 ceremony pattern:
// approveArtwork and retireArtwork both need to set approvedBySignatureId /
// retiredBySignatureId on the artwork row, which requires the signature ID
// before the UPDATE runs. Since performSignature inserts the signature AFTER
// fn(tx), we use the inline ceremony pattern from equipment.ts — verify
// password, insert signature first, then UPDATE the artwork row with the
// signature ID already in hand.

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";
import { MEANING_VERB } from "../signatures/signatures";

// ─── createArtwork ────────────────────────────────────────────────────────────

export async function createArtwork(
  input: schema.InsertLabelArtwork,
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.LabelArtwork> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.labelArtwork)
      .values({ ...input, status: "DRAFT" })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LABEL_ARTWORK_CREATED",
      entityType: "label_artwork",
      entityId: row!.id,
      after: {
        productId: row!.productId,
        version: row!.version,
        artworkFileName: row!.artworkFileName,
        status: row!.status,
      },
      requestId,
      route,
    });

    return row!;
  });
}

// ─── approveArtwork ──────────────────────────────────────────────────────────

export async function approveArtwork(
  id: string,
  userId: string,
  password: string,
  requestId: string,
  route: string,
): Promise<schema.LabelArtwork> {
  // Pre-flight: load artwork and validate state before ceremony.
  const [existing] = await db
    .select()
    .from(schema.labelArtwork)
    .where(eq(schema.labelArtwork.id, id));

  if (!existing) {
    throw Object.assign(new Error("Label artwork not found"), { status: 404 });
  }
  if (existing.status !== "DRAFT") {
    throw Object.assign(
      new Error(`Cannot approve artwork in state ${existing.status}`),
      { status: 409, code: "ARTWORK_INVALID_STATE" },
    );
  }

  // F-04 inline ceremony — same user-load pattern as equipment.ts.
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
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.ARTWORK_APPROVED} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "ARTWORK_APPROVED" as const,
    entityType: "label_artwork",
    entityId: id,
    signedAt: signedAt.toISOString(),
    snapshot: {
      productId: existing.productId,
      version: existing.version,
      artworkFileName: existing.artworkFileName,
      status: existing.status,
    },
  };

  return await db.transaction(async (tx) => {
    // 1. Insert signature row first so we have its ID for the artwork UPDATE.
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "ARTWORK_APPROVED",
        entityType: "label_artwork",
        entityId: id,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId,
        manifestationJson: manifestation as Record<string, unknown>,
      })
      .returning();

    // 2. UPDATE artwork to APPROVED, setting approvedBySignatureId.
    const [updated] = await tx
      .update(schema.labelArtwork)
      .set({
        status: "APPROVED",
        approvedBySignatureId: sigRow!.id,
        approvedAt: signedAt,
      })
      .where(eq(schema.labelArtwork.id, id))
      .returning();

    // 3. SIGN audit row (mirrors what performSignature would write).
    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "label_artwork",
      entityId: id,
      before: null,
      after: { artworkId: id, status: "APPROVED" },
      route,
      requestId,
      meta: { signatureId: sigRow!.id, meaning: "ARTWORK_APPROVED" },
    });

    // 4. Domain audit row.
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LABEL_ARTWORK_APPROVED",
      entityType: "label_artwork",
      entityId: id,
      before: { status: existing.status },
      after: { status: "APPROVED", approvedBySignatureId: sigRow!.id },
      requestId,
      route,
    });

    return updated!;
  });
}

// ─── retireArtwork ────────────────────────────────────────────────────────────

export async function retireArtwork(
  id: string,
  userId: string,
  password: string,
  requestId: string,
  route: string,
): Promise<schema.LabelArtwork> {
  // Pre-flight: load artwork and validate state before ceremony.
  const [existing] = await db
    .select()
    .from(schema.labelArtwork)
    .where(eq(schema.labelArtwork.id, id));

  if (!existing) {
    throw Object.assign(new Error("Label artwork not found"), { status: 404 });
  }
  if (existing.status !== "APPROVED") {
    throw Object.assign(
      new Error(`Cannot retire artwork in state ${existing.status}`),
      { status: 409, code: "ARTWORK_INVALID_STATE" },
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
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.ARTWORK_RETIRED} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "ARTWORK_RETIRED" as const,
    entityType: "label_artwork",
    entityId: id,
    signedAt: signedAt.toISOString(),
    snapshot: {
      productId: existing.productId,
      version: existing.version,
      artworkFileName: existing.artworkFileName,
      status: existing.status,
    },
  };

  return await db.transaction(async (tx) => {
    // 1. Insert signature row first so we have its ID for the artwork UPDATE.
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "ARTWORK_RETIRED",
        entityType: "label_artwork",
        entityId: id,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId,
        manifestationJson: manifestation as Record<string, unknown>,
      })
      .returning();

    // 2. UPDATE artwork to RETIRED, setting retiredBySignatureId.
    const [updated] = await tx
      .update(schema.labelArtwork)
      .set({
        status: "RETIRED",
        retiredBySignatureId: sigRow!.id,
        retiredAt: signedAt,
      })
      .where(eq(schema.labelArtwork.id, id))
      .returning();

    // 3. SIGN audit row.
    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "label_artwork",
      entityId: id,
      before: null,
      after: { artworkId: id, status: "RETIRED" },
      route,
      requestId,
      meta: { signatureId: sigRow!.id, meaning: "ARTWORK_RETIRED" },
    });

    // 4. Domain audit row.
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LABEL_ARTWORK_RETIRED",
      entityType: "label_artwork",
      entityId: id,
      before: { status: existing.status },
      after: { status: "RETIRED", retiredBySignatureId: sigRow!.id },
      requestId,
      route,
    });

    return updated!;
  });
}

// ─── listArtworkByProduct ─────────────────────────────────────────────────────

export async function listArtworkByProduct(
  productId: string,
): Promise<schema.LabelArtwork[]> {
  return db
    .select()
    .from(schema.labelArtwork)
    .where(eq(schema.labelArtwork.productId, productId))
    .orderBy(desc(schema.labelArtwork.version));
}

// ─── getActiveArtwork ─────────────────────────────────────────────────────────

export async function getActiveArtwork(
  productId: string,
): Promise<schema.LabelArtwork | null> {
  const [row] = await db
    .select()
    .from(schema.labelArtwork)
    .where(and(
      eq(schema.labelArtwork.productId, productId),
      eq(schema.labelArtwork.status, "APPROVED"),
    ))
    .limit(1);
  return row ?? null;
}

// ─── getArtwork ──────────────────────────────────────────────────────────────

export async function getArtwork(id: string): Promise<schema.LabelArtwork | undefined> {
  const [row] = await db
    .select()
    .from(schema.labelArtwork)
    .where(eq(schema.labelArtwork.id, id));
  return row;
}

export async function listDraftArtworks(): Promise<schema.LabelArtwork[]> {
  return db
    .select()
    .from(schema.labelArtwork)
    .where(eq(schema.labelArtwork.status, "DRAFT"))
    .orderBy(desc(schema.labelArtwork.createdAt));
}
