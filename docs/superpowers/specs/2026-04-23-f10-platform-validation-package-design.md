# F-10 — Platform Validation Package Design

**Date:** 2026-04-23
**Ticket:** F-10 (neurogan-erp-build-spec.md §4.10)
**Preconditions:** F-01 through F-09 merged and passing CI

---

## 1. Goal

Produce the GAMP 5 Category 5 platform validation package (IQ, OQ, PQ, VSR) as records inside the ERP itself, signed by Carrie Treat using the existing F-04 electronic signature ceremony. No printing, no DocuSign, no external tools.

---

## 2. Data Model

### New table: `erp_validation_documents`

```ts
validationDocuments = pgTable("erp_validation_documents", {
  id:          uuid("id").primaryKey().defaultRandom(),
  docId:       text("doc_id").notNull().unique(),          // e.g. "IQ-PLATFORM", "VSR-R-01"
  title:       text("title").notNull(),
  type:        text("type").notNull(),                     // "IQ" | "OQ" | "PQ" | "VSR"
  module:      text("module").notNull(),                   // "PLATFORM" | "R-01" | ...
  content:     text("content").notNull(),                  // markdown body
  status:      text("status").notNull().default("DRAFT"),  // "DRAFT" | "SIGNED"
  signatureId: uuid("signature_id")
                 .references(() => electronicSignatures.id), // null until signed
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
```

Reuses `erp_electronic_signatures` (F-04) with:
- `entityType = "validation_document"`
- `entityId = validationDocuments.id`
- `meaning = "APPROVED"`

Once `status = "SIGNED"`, content is frozen. No update endpoint exists — content changes require a new row with a new `docId` and a change-control entry in the validation scaffold.

---

## 3. API

All endpoints require QA or ADMIN role (403 otherwise).

| Method | Path | Response | Notes |
|---|---|---|---|
| `GET` | `/api/validation-documents` | `200 DocumentSummary[]` | List — no content body, just metadata |
| `GET` | `/api/validation-documents/:id` | `200 DocumentDetail` | Full markdown content + signature block if signed |
| `POST` | `/api/validation-documents/:id/sign` | `200 DocumentDetail` | Body: `{ password, commentary? }`. Runs F-04 ceremony. 409 if already signed. 401 on wrong password. |
| `GET` | `/api/validation-documents/:id/signature` | `200 SignatureBlock` | Name, title, meaning, timestamp, manifestation. 404 if unsigned. |

---

## 4. UI

### New top-level nav tab: "Quality"

Added to `navItems` in `client/src/App.tsx`. Will house all QA-facing pages as Phase 1 modules are built. Visible to QA and ADMIN roles only.

### `/quality/validation` — Document list

Table with columns: Title, Type, Module, Status (Draft / Signed), Signed By, Signed At.
QA and ADMIN only.

### `/quality/validation/:id` — Document detail

- Renders the markdown `content` field as formatted text
- If `status = "DRAFT"`: Sign button at the bottom
- Sign button opens the existing `<SignatureCeremony>` dialog (no new component needed) with meaning `APPROVED`
- If `status = "SIGNED"`: locked signature block showing name, title, meaning, timestamp. Sign button hidden.
- Audit tab showing the history of this record (reuses existing audit trail infrastructure)

---

## 5. Seeded documents for F-10 (Platform)

Four documents seeded via `server/seed/test/fixtures/validationDocuments.ts` and also via a standalone seed script for production:

| docId | title | type |
|---|---|---|
| `IQ-PLATFORM` | Installation Qualification — Platform | IQ |
| `OQ-PLATFORM` | Operational Qualification — Platform | OQ |
| `PQ-PLATFORM` | Performance Qualification — Platform | PQ |
| `VSR-PLATFORM` | Validation Summary Report — Platform | VSR |

Content of each document is the populated GAMP 5 protocol from `FDA/validation-scaffold.md`, converted to markdown and stored in the DB. The OQ document references the specific test files and test names from the existing Vitest/supertest suite.

---

## 6. Error handling

| Scenario | Response |
|---|---|
| Document already signed | 409 `ALREADY_SIGNED` |
| Wrong password | 401 (failure count increments per F-02) |
| Non-QA/Admin role | 403 |
| Document not found | 404 |

---

## 7. Tests

- Integration: sign a document → status = SIGNED, signature row exists in `erp_electronic_signatures`, re-sign returns 409
- Integration: wrong password → 401, document remains DRAFT
- Integration: PRODUCTION role → 403 on all four endpoints
- Integration: GET list → returns all documents without content body
- Integration: GET detail of signed doc → includes signature block

No state machine unit tests needed (DRAFT → SIGNED is a one-way, one-step transition with no branching).

---

## 8. Validation hooks

Adds to `validation-scaffold.md`:
- URS-F-10-01: Platform validation documents shall be signed within the ERP using Part 11-compliant electronic signatures
- FRS-F-10-01: `POST /api/validation-documents/:id/sign` runs the F-04 ceremony and locks the document
- DS-F-10-01: `erp_validation_documents` table; content frozen on SIGNED; signature FK to `erp_electronic_signatures`
- OQ-F-10-01: Sign a document, verify locked; wrong password stays DRAFT; role 403

---

## 9. Out of scope

- Editing documents through the UI (content is seeded, changes go through change control)
- PDF export (documents live in the ERP; external export is a Phase 2 / audit-prep item if needed)
- Module VSR documents (R-01 through R-06) — seeded as part of their respective tickets using the same module
