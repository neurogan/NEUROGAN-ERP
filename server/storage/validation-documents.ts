// F-10: Storage layer for validation documents (IQ / OQ / PQ / VSR).
//
// Three exported functions:
//   listValidationDocuments  — all docs, no content field (list view performance)
//   getValidationDocument    — single doc with content + joined signature row
//   signValidationDocument   — atomic sign ceremony via performSignature

import { eq, asc } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import type { SelectValidationDocument } from "@shared/schema";
import { errors } from "../errors";
import { performSignature, type SignatureContext } from "../signatures/signatures";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidationDocumentSummary = Omit<SelectValidationDocument, "content"> & {
  signedBy: string | null;
  signedAt: Date | null;
};

export type ValidationDocumentDetail = SelectValidationDocument & {
  signature: typeof schema.electronicSignatures.$inferSelect | null;
};

// ─── listValidationDocuments ──────────────────────────────────────────────────
//
// Returns all documents ordered by module then type, WITHOUT the content field
// (content can be large markdown; omitting it keeps list payloads small).

export async function listValidationDocuments(): Promise<ValidationDocumentSummary[]> {
  const rows = await db
    .select({
      id:          schema.validationDocuments.id,
      docId:       schema.validationDocuments.docId,
      title:       schema.validationDocuments.title,
      type:        schema.validationDocuments.type,
      module:      schema.validationDocuments.module,
      status:      schema.validationDocuments.status,
      signatureId: schema.validationDocuments.signatureId,
      createdAt:   schema.validationDocuments.createdAt,
      updatedAt:   schema.validationDocuments.updatedAt,
      signedBy:    schema.electronicSignatures.fullNameAtSigning,
      signedAt:    schema.electronicSignatures.signedAt,
    })
    .from(schema.validationDocuments)
    .leftJoin(
      schema.electronicSignatures,
      eq(schema.validationDocuments.signatureId, schema.electronicSignatures.id),
    )
    .orderBy(
      asc(schema.validationDocuments.module),
      asc(schema.validationDocuments.type),
    );

  return rows;
}

// ─── getValidationDocument ────────────────────────────────────────────────────
//
// Returns the full document (including content) plus the joined signature row
// when signatureId is set. Returns null if the document does not exist.

export async function getValidationDocument(id: string): Promise<ValidationDocumentDetail | null> {
  const rows = await db
    .select({
      doc: schema.validationDocuments,
      sig: schema.electronicSignatures,
    })
    .from(schema.validationDocuments)
    .leftJoin(
      schema.electronicSignatures,
      eq(schema.validationDocuments.signatureId, schema.electronicSignatures.id),
    )
    .where(eq(schema.validationDocuments.id, id))
    .limit(1);

  if (rows.length === 0) return null;

  const { doc, sig } = rows[0]!;
  return { ...doc, signature: sig ?? null };
}

// ─── signValidationDocument ───────────────────────────────────────────────────
//
// Atomically signs a validation document:
//   1. Fetches the document; throws 404 if missing
//   2. Throws 409 (ALREADY_SIGNED) if already SIGNED
//   3. Calls performSignature — inside the transaction updates status to SIGNED
//   4. After commit, locates the newly-inserted signature row by entityId and
//      writes its id back into signatureId on the document
//   5. Returns the full ValidationDocumentDetail

export async function signValidationDocument(
  id: string,
  ctx: SignatureContext,
): Promise<ValidationDocumentDetail> {
  // 1. Fetch the document.
  const existing = await getValidationDocument(id);
  if (!existing) throw errors.notFound("Validation document");

  // 2. Reject if already signed.
  if (existing.status === "SIGNED") {
    throw errors.alreadySigned();
  }

  // 3. Perform the signature ceremony; update status inside the transaction.
  await performSignature(ctx, async (tx) => {
    await tx
      .update(schema.validationDocuments)
      .set({ status: "SIGNED", updatedAt: new Date() })
      .where(eq(schema.validationDocuments.id, id));
  });

  // 4. After the transaction commits the signature row exists. Find it by
  //    entityId (which performSignature sets to ctx.entityId == id) and link it.
  const [sigRow] = await db
    .select({ id: schema.electronicSignatures.id })
    .from(schema.electronicSignatures)
    .where(eq(schema.electronicSignatures.entityId, id))
    .limit(1);

  if (sigRow) {
    await db
      .update(schema.validationDocuments)
      .set({ signatureId: sigRow.id })
      .where(eq(schema.validationDocuments.id, id));
  }

  // 5. Return the full detail (non-null at this point).
  return (await getValidationDocument(id))!;
}
