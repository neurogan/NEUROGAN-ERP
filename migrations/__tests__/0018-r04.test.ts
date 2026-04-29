// migrations/__tests__/0018-r04.test.ts
// Migration 0018 smoke-tests: verifies that all R-04 tables, columns,
// CHECK constraints, UNIQUE indexes, and app_settings_kv seed rows exist
// after the migration has been applied to the test database.
//
// Run: DATABASE_URL=postgresql://... pnpm test migrations/__tests__/0018-r04.test.ts -- --run

import { describe, it, expect } from "vitest";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

// Helper: returns column names for a given table.
async function columnNames(table: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = ${table}
    ORDER BY ordinal_position
  `);
  return result.rows.map((r) => (r as { column_name: string }).column_name);
}

// Helper: returns true if the table exists.
async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = ${table}
  `);
  return result.rows.length > 0;
}

describeIfDb("migration 0018 — R-04 labeling & reconciliation tables", () => {
  // ── erp_label_artwork ───────────────────────────────────────────────────

  it("erp_label_artwork exists", async () => {
    expect(await tableExists("erp_label_artwork")).toBe(true);
  });

  it("erp_label_artwork has expected columns", async () => {
    const cols = await columnNames("erp_label_artwork");
    expect(cols).toContain("id");
    expect(cols).toContain("product_id");
    expect(cols).toContain("version");
    expect(cols).toContain("artwork_file_data");
    expect(cols).toContain("artwork_file_name");
    expect(cols).toContain("artwork_mime_type");
    expect(cols).toContain("variable_data_spec");
    expect(cols).toContain("status");
    expect(cols).toContain("approved_by_signature_id");
    expect(cols).toContain("approved_at");
    expect(cols).toContain("retired_by_signature_id");
    expect(cols).toContain("retired_at");
    expect(cols).toContain("created_at");
  });

  it("UNIQUE (product_id, version) on erp_label_artwork", async () => {
    // Insert a product row so we have a valid product_id to work with.
    const [prod] = (
      await db.execute(sql`
        INSERT INTO erp_products (name, sku)
        VALUES ('R04-Test-Product', 'R04-TST-' || extract(epoch from now())::bigint)
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    const productId = prod.id;

    try {
      await db.execute(sql`
        INSERT INTO erp_label_artwork (product_id, version, artwork_file_data, artwork_mime_type, variable_data_spec, status)
        VALUES (${productId}, 'v1', 'data', 'image/png', '{}', 'DRAFT')
      `);
      // Second insert with same (product_id, version) must fail.
      await expect(
        db.execute(sql`
          INSERT INTO erp_label_artwork (product_id, version, artwork_file_data, artwork_mime_type, variable_data_spec, status)
          VALUES (${productId}, 'v1', 'data2', 'image/png', '{}', 'DRAFT')
        `)
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`DELETE FROM erp_label_artwork WHERE product_id = ${productId}`);
      await db.execute(sql`DELETE FROM erp_products WHERE id = ${productId}`);
    }
  });

  // ── erp_label_spools ────────────────────────────────────────────────────

  it("erp_label_spools exists with expected columns", async () => {
    expect(await tableExists("erp_label_spools")).toBe(true);
    const cols = await columnNames("erp_label_spools");
    expect(cols).toContain("id");
    expect(cols).toContain("artwork_id");
    expect(cols).toContain("spool_number");
    expect(cols).toContain("qty_initial");
    expect(cols).toContain("qty_on_hand");
    expect(cols).toContain("location_id");
    expect(cols).toContain("status");
    expect(cols).toContain("received_by_signature_id");
    expect(cols).toContain("disposed_by_signature_id");
    expect(cols).toContain("disposed_at");
    expect(cols).toContain("dispose_reason");
    expect(cols).toContain("created_at");
  });

  it("qty_on_hand CHECK rejects negative values", async () => {
    // We need a valid artwork_id — insert a temporary product + artwork.
    const [prod] = (
      await db.execute(sql`
        INSERT INTO erp_products (name, sku)
        VALUES ('R04-Spool-Test', 'R04-SP-' || extract(epoch from now())::bigint)
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    const productId = prod.id;

    const [art] = (
      await db.execute(sql`
        INSERT INTO erp_label_artwork (product_id, version, artwork_file_data, artwork_mime_type, variable_data_spec, status)
        VALUES (${productId}, 'v1', 'data', 'image/png', '{}', 'DRAFT')
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    const artworkId = art.id;

    try {
      await expect(
        db.execute(sql`
          INSERT INTO erp_label_spools (artwork_id, spool_number, qty_initial, qty_on_hand, status)
          VALUES (${artworkId}, 'S-001', 100, -1, 'ACTIVE')
        `)
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`DELETE FROM erp_label_spools WHERE artwork_id = ${artworkId}`);
      await db.execute(sql`DELETE FROM erp_label_artwork WHERE id = ${artworkId}`);
      await db.execute(sql`DELETE FROM erp_products WHERE id = ${productId}`);
    }
  });

  it("qty_initial CHECK rejects zero", async () => {
    // We need a valid artwork_id — insert a temporary product + artwork.
    const [prod] = (
      await db.execute(sql`
        INSERT INTO erp_products (name, sku)
        VALUES ('R04-QtyInit-Test', 'R04-QI-' || extract(epoch from now())::bigint)
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    const productId = prod.id;

    const [art] = (
      await db.execute(sql`
        INSERT INTO erp_label_artwork (product_id, version, artwork_file_data, artwork_mime_type, variable_data_spec, status)
        VALUES (${productId}, 'v1', 'data', 'image/png', '{}', 'DRAFT')
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    const artworkId = art.id;

    try {
      await expect(
        db.execute(sql`
          INSERT INTO erp_label_spools (artwork_id, spool_number, qty_initial, qty_on_hand, status)
          VALUES (${artworkId}, 'S-INIT-001', 0, 0, 'ACTIVE')
        `)
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`DELETE FROM erp_label_spools WHERE artwork_id = ${artworkId}`);
      await db.execute(sql`DELETE FROM erp_label_artwork WHERE id = ${artworkId}`);
      await db.execute(sql`DELETE FROM erp_products WHERE id = ${productId}`);
    }
  });

  // ── erp_label_issuance_log ──────────────────────────────────────────────

  it("erp_label_issuance_log exists with expected columns", async () => {
    expect(await tableExists("erp_label_issuance_log")).toBe(true);
    const cols = await columnNames("erp_label_issuance_log");
    expect(cols).toContain("id");
    expect(cols).toContain("bpr_id");
    expect(cols).toContain("spool_id");
    expect(cols).toContain("artwork_id");
    expect(cols).toContain("quantity_issued");
    expect(cols).toContain("issued_by_user_id");
    expect(cols).toContain("issued_at");
  });

  // ── erp_label_print_jobs ────────────────────────────────────────────────

  it("erp_label_print_jobs exists with expected columns", async () => {
    expect(await tableExists("erp_label_print_jobs")).toBe(true);
    const cols = await columnNames("erp_label_print_jobs");
    expect(cols).toContain("id");
    expect(cols).toContain("issuance_log_id");
    expect(cols).toContain("lot");
    expect(cols).toContain("expiry");
    expect(cols).toContain("qty_printed");
    expect(cols).toContain("adapter");
    expect(cols).toContain("status");
    expect(cols).toContain("result_json");
    expect(cols).toContain("signature_id");
    expect(cols).toContain("created_at");
  });

  // ── erp_label_reconciliations ───────────────────────────────────────────

  it("erp_label_reconciliations exists with expected columns", async () => {
    expect(await tableExists("erp_label_reconciliations")).toBe(true);
    const cols = await columnNames("erp_label_reconciliations");
    expect(cols).toContain("id");
    expect(cols).toContain("bpr_id");
    expect(cols).toContain("qty_issued");
    expect(cols).toContain("qty_applied");
    expect(cols).toContain("qty_destroyed");
    expect(cols).toContain("qty_returned");
    expect(cols).toContain("variance");
    expect(cols).toContain("tolerance_exceeded");
    expect(cols).toContain("proof_file_data");
    expect(cols).toContain("proof_mime_type");
    expect(cols).toContain("deviation_id");
    expect(cols).toContain("signature_id");
    expect(cols).toContain("reconciled_at");
  });

  it("UNIQUE bpr_id on erp_label_reconciliations", async () => {
    // Insert a minimal BPR to get a valid bpr_id.
    // erp_batch_production_records.id is varchar (gen_random_uuid default).
    const [prod] = (
      await db.execute(sql`
        INSERT INTO erp_products (name, sku)
        VALUES ('R04-Rec-Product', 'R04-REC-' || extract(epoch from now())::bigint)
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    const productId = prod.id;

    const batchNum = `R04-BPR-${Date.now()}`;
    const [bpr] = (
      await db.execute(sql`
        INSERT INTO erp_batch_production_records
          (production_batch_id, batch_number, product_id, status)
        VALUES (${productId}, ${batchNum}, ${productId}, 'IN_PROGRESS')
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    const bprId = bpr.id;

    try {
      await db.execute(sql`
        INSERT INTO erp_label_reconciliations
          (bpr_id, qty_issued, qty_applied, qty_destroyed, qty_returned, variance, tolerance_exceeded)
        VALUES (${bprId}, 100, 90, 5, 5, 0, false)
      `);
      // Second reconciliation for same BPR must fail.
      await expect(
        db.execute(sql`
          INSERT INTO erp_label_reconciliations
            (bpr_id, qty_issued, qty_applied, qty_destroyed, qty_returned, variance, tolerance_exceeded)
          VALUES (${bprId}, 100, 80, 5, 5, 10, false)
        `)
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`DELETE FROM erp_label_reconciliations WHERE bpr_id = ${bprId}`);
      await db.execute(sql`DELETE FROM erp_batch_production_records WHERE id = ${bprId}`);
      await db.execute(sql`DELETE FROM erp_products WHERE id = ${productId}`);
    }
  });

  it("CHECK (tolerance_exceeded = false) OR (deviation_id IS NOT NULL) on reconciliations", async () => {
    // When tolerance_exceeded = true and deviation_id IS NULL → should fail.
    const [prod2] = (
      await db.execute(sql`
        INSERT INTO erp_products (name, sku)
        VALUES ('R04-Check-Product', 'R04-CHK-' || extract(epoch from now())::bigint)
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    const productId2 = prod2.id;

    const batchNum2 = `R04-BPR2-${Date.now()}`;
    const [bpr] = (
      await db.execute(sql`
        INSERT INTO erp_batch_production_records
          (production_batch_id, batch_number, product_id, status)
        VALUES (${productId2}, ${batchNum2}, ${productId2}, 'IN_PROGRESS')
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    const bprId = bpr.id;

    try {
      await expect(
        db.execute(sql`
          INSERT INTO erp_label_reconciliations
            (bpr_id, qty_issued, qty_applied, qty_destroyed, qty_returned, variance, tolerance_exceeded, deviation_id)
          VALUES (${bprId}, 100, 80, 5, 5, 10, true, NULL)
        `)
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`DELETE FROM erp_label_reconciliations WHERE bpr_id = ${bprId}`);
      await db.execute(sql`DELETE FROM erp_batch_production_records WHERE id = ${bprId}`);
      await db.execute(sql`DELETE FROM erp_products WHERE id = ${productId2}`);
    }
  });

  // ── erp_sops ────────────────────────────────────────────────────────────

  it("erp_sops exists with expected columns", async () => {
    expect(await tableExists("erp_sops")).toBe(true);
    const cols = await columnNames("erp_sops");
    expect(cols).toContain("id");
    expect(cols).toContain("code");
    expect(cols).toContain("title");
    expect(cols).toContain("version");
    expect(cols).toContain("status");
    expect(cols).toContain("approved_by_signature_id");
    expect(cols).toContain("approved_at");
    expect(cols).toContain("retired_by_signature_id");
    expect(cols).toContain("retired_at");
    expect(cols).toContain("created_at");
  });

  it("UNIQUE (code, version) on erp_sops", async () => {
    try {
      await db.execute(sql`
        INSERT INTO erp_sops (code, title, version, status)
        VALUES ('SOP-TEST-001', 'Test SOP', 'v1', 'DRAFT')
      `);
      await expect(
        db.execute(sql`
          INSERT INTO erp_sops (code, title, version, status)
          VALUES ('SOP-TEST-001', 'Duplicate SOP', 'v1', 'DRAFT')
        `)
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`DELETE FROM erp_sops WHERE code = 'SOP-TEST-001'`);
    }
  });

  // ── erp_bpr_steps extension ─────────────────────────────────────────────

  it("erp_bpr_steps has sop_code and sop_version columns", async () => {
    const cols = await columnNames("erp_bpr_steps");
    expect(cols).toContain("sop_code");
    expect(cols).toContain("sop_version");
  });

  // ── erp_app_settings_kv seed rows ───────────────────────────────────────

  it("app_settings_kv rows seeded: labelToleranceAbs", async () => {
    const result = await db.execute(sql`
      SELECT value FROM erp_app_settings_kv WHERE key = 'labelToleranceAbs'
    `);
    expect(result.rows.length).toBe(1);
    expect((result.rows[0] as { value: string }).value).toBe("5");
  });

  it("app_settings_kv rows seeded: labelPrintAdapter", async () => {
    const result = await db.execute(sql`
      SELECT value FROM erp_app_settings_kv WHERE key = 'labelPrintAdapter'
    `);
    expect(result.rows.length).toBe(1);
    expect((result.rows[0] as { value: string }).value).toBe("STUB");
  });

  it("app_settings_kv rows seeded: labelPrintHost", async () => {
    const result = await db.execute(sql`
      SELECT value FROM erp_app_settings_kv WHERE key = 'labelPrintHost'
    `);
    expect(result.rows.length).toBe(1);
  });

  it("app_settings_kv rows seeded: labelPrintPort", async () => {
    const result = await db.execute(sql`
      SELECT value FROM erp_app_settings_kv WHERE key = 'labelPrintPort'
    `);
    expect(result.rows.length).toBe(1);
    expect((result.rows[0] as { value: string }).value).toBe("9100");
  });

  it("app_settings_kv ON CONFLICT DO NOTHING is idempotent", async () => {
    // Re-running the seed INSERT should not error and should not overwrite.
    await expect(
      db.execute(sql`
        INSERT INTO erp_app_settings_kv (key, value) VALUES
          ('labelToleranceAbs',  '5'),
          ('labelPrintAdapter',  'STUB'),
          ('labelPrintHost',     ''),
          ('labelPrintPort',     '9100')
        ON CONFLICT (key) DO NOTHING
      `)
    ).resolves.not.toThrow();

    // Value must still be the original '5', not changed.
    const result = await db.execute(sql`
      SELECT value FROM erp_app_settings_kv WHERE key = 'labelToleranceAbs'
    `);
    expect((result.rows[0] as { value: string }).value).toBe("5");
  });
});
