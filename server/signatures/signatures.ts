// F-04: Electronic signature ceremony.
//
// performSignature<T> wraps a regulated state change in a DB transaction and
// inserts the signature row + audit SIGN row atomically. Re-verifies the
// signer's password; a wrong password never advances record state.
//
// Part 11 §11.50 (manifestation), §11.70 (link to record), §11.100 (unique ID),
// §11.200 (re-authentication), §11.300 (controls for ID/password).

import { db, type Tx } from "../db";
import * as schema from "@shared/schema";
import type { SignatureMeaning } from "@shared/schema";
import { verifyPassword } from "../auth/password";
import { storage } from "../storage";
import { errors } from "../errors";

export interface SignatureContext {
  /** Authenticated user performing the signature. */
  userId: string;
  /** Plaintext password — re-verified against the stored hash (§11.200). */
  password: string;
  meaning: SignatureMeaning;
  entityType: string;
  entityId: string;
  commentary?: string | null;
  /** Snapshot of the record being signed — stored in manifestationJson. */
  recordSnapshot: unknown;
  route: string | null;
  requestId: string;
}

// Human-readable verb for each meaning, used in the manifestation text.
const MEANING_VERB: Record<SignatureMeaning, string> = {
  AUTHORED: "authored",
  REVIEWED: "reviewed",
  APPROVED: "approved",
  REJECTED: "rejected",
  QC_DISPOSITION: "issued QC disposition for",
  QA_RELEASE: "authorized QA release of",
  DEVIATION_DISPOSITION: "issued deviation disposition for",
  RETURN_DISPOSITION: "issued return disposition for",
  COMPLAINT_REVIEW: "reviewed complaint for",
  SAER_SUBMIT: "submitted SAER for",
  MMR_APPROVAL: "approved MMR for",
  SPEC_APPROVAL: "approved specification for",
  LAB_APPROVAL: "approved laboratory result for",
  LAB_DISQUALIFICATION: "disqualified laboratory",
  OOS_INVESTIGATION_CLOSE: "closed OOS investigation for",
  EQUIPMENT_QUALIFIED: "qualified equipment for",
  EQUIPMENT_DISQUALIFIED: "disqualified equipment for",
  CALIBRATION_RECORDED: "recorded calibration for",
  CLEANING_VERIFIED: "verified cleaning for",
  LINE_CLEARANCE: "approved line clearance for",
};

// Performs the signature ceremony then calls fn(tx) for the state change —
// all in a single DB transaction. Returns whatever fn returns.
//
// Throws:
//   - 401 UNAUTHENTICATED  if password is wrong (also increments failedLoginCount)
//   - 423 ACCOUNT_LOCKED   if the account is locked
//   - 404 NOT_FOUND        if the user does not exist
export async function performSignature<T>(
  ctx: SignatureContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  // Load the full user row — we need passwordHash and identity snapshot.
  const fullUser = await storage.getUserByEmail(
    // getUserByEmail is the only method that returns passwordHash.
    // We use getUserById to get the email first, then look up by email.
    await storage.getUserById(ctx.userId).then((u) => {
      if (!u) throw errors.notFound("User");
      return u.email;
    }),
  );
  if (!fullUser) throw errors.notFound("User");

  if (fullUser.lockedUntil && fullUser.lockedUntil > new Date()) {
    throw Object.assign(
      new Error("Account temporarily locked due to too many failed attempts."),
      { status: 423, code: "ACCOUNT_LOCKED", details: { lockedUntil: fullUser.lockedUntil } },
    );
  }

  const valid = await verifyPassword(fullUser.passwordHash, ctx.password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throw Object.assign(
      new Error("Password is incorrect."),
      { status: 401, code: "UNAUTHENTICATED" },
    );
  }

  await storage.recordSuccessfulLogin(fullUser.id);

  const signedAt = new Date();
  const verb = MEANING_VERB[ctx.meaning];
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";
  const manifestation = {
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${verb} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: ctx.meaning,
    entityType: ctx.entityType,
    entityId: ctx.entityId,
    signedAt: signedAt.toISOString(),
    snapshot: ctx.recordSnapshot,
  };

  return db.transaction(async (tx) => {
    const result = await fn(tx);

    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: ctx.meaning,
        entityType: ctx.entityType,
        entityId: ctx.entityId,
        commentary: ctx.commentary ?? null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId: ctx.requestId,
        manifestationJson: manifestation as Record<string, unknown>,
      })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: ctx.entityType,
      entityId: ctx.entityId,
      before: null,
      after: result as Record<string, unknown> | null,
      route: ctx.route,
      requestId: ctx.requestId,
      meta: { signatureId: sigRow!.id, meaning: ctx.meaning },
    });

    return result;
  });
}
