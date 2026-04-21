import { Pool } from "pg";

function makePool(connectionString: string) {
  return new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=require") || connectionString.includes("railway.app")
      ? { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 15000,
  });
}

/**
 * ERP core tables — each uses CREATE TABLE IF NOT EXISTS so this is safe to
 * call on every boot, even when tables already exist.
 */
export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("[migrate] No DATABASE_URL — skipping migrations (using in-memory storage)");
    return;
  }

  console.log("[migrate] Running ERP table migrations...");
  const pool = makePool(connectionString);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS erp_products (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        sku TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL DEFAULT 'ACTIVE_INGREDIENT',
        default_uom TEXT NOT NULL DEFAULT 'g',
        description TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        low_stock_threshold DECIMAL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_lots (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id VARCHAR NOT NULL,
        lot_number TEXT NOT NULL,
        supplier_name TEXT,
        received_date TEXT,
        expiration_date TEXT,
        supplier_coa_url TEXT,
        neurogan_coa_url TEXT,
        purchase_price DECIMAL,
        purchase_uom TEXT,
        po_reference TEXT,
        notes TEXT,
        quarantine_status TEXT DEFAULT 'APPROVED',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_locations (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS erp_transactions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        lot_id VARCHAR NOT NULL,
        location_id VARCHAR NOT NULL,
        type TEXT NOT NULL,
        quantity DECIMAL NOT NULL,
        uom TEXT NOT NULL,
        production_batch_id TEXT,
        notes TEXT,
        performed_by TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_suppliers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        contact_email TEXT,
        contact_phone TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_purchase_orders (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        po_number TEXT NOT NULL UNIQUE,
        supplier_id VARCHAR NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        order_date TEXT,
        expected_delivery_date TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_po_line_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id VARCHAR NOT NULL,
        product_id VARCHAR NOT NULL,
        quantity_ordered DECIMAL NOT NULL,
        quantity_received DECIMAL NOT NULL DEFAULT 0,
        unit_price DECIMAL,
        uom TEXT NOT NULL,
        lot_number TEXT,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS erp_production_batches (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_number TEXT NOT NULL UNIQUE,
        product_id VARCHAR NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        planned_quantity DECIMAL NOT NULL,
        actual_quantity DECIMAL,
        output_uom TEXT NOT NULL DEFAULT 'pcs',
        output_lot_number TEXT,
        output_expiration_date TEXT,
        start_date TEXT,
        end_date TEXT,
        qc_status TEXT DEFAULT 'PENDING',
        qc_notes TEXT,
        qc_disposition TEXT,
        qc_reviewed_by TEXT,
        yield_percentage DECIMAL,
        operator_name TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_production_inputs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id VARCHAR NOT NULL,
        product_id VARCHAR NOT NULL,
        lot_id VARCHAR NOT NULL,
        location_id VARCHAR NOT NULL,
        quantity_used DECIMAL NOT NULL,
        uom TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS erp_recipes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_recipe_lines (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        recipe_id VARCHAR NOT NULL,
        product_id VARCHAR NOT NULL,
        quantity DECIMAL NOT NULL,
        uom TEXT NOT NULL,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS erp_product_categories (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_product_category_assignments (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id VARCHAR NOT NULL,
        category_id VARCHAR NOT NULL
      );

      CREATE TABLE IF NOT EXISTS erp_app_settings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_name TEXT NOT NULL DEFAULT 'Neurogan',
        default_uom TEXT NOT NULL DEFAULT 'g',
        low_stock_threshold DECIMAL NOT NULL DEFAULT 1,
        date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
        auto_generate_batch_numbers TEXT NOT NULL DEFAULT 'true',
        batch_number_prefix TEXT NOT NULL DEFAULT 'BATCH',
        auto_generate_lot_numbers TEXT NOT NULL DEFAULT 'true',
        lot_number_prefix TEXT NOT NULL DEFAULT 'LOT',
        fg_lot_number_prefix TEXT NOT NULL DEFAULT 'FG',
        sku_prefix_raw_material TEXT NOT NULL DEFAULT 'RA',
        sku_prefix_finished_good TEXT NOT NULL DEFAULT 'US',
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_receiving_records (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id VARCHAR,
        lot_id VARCHAR NOT NULL,
        supplier_id VARCHAR,
        unique_identifier TEXT NOT NULL,
        date_received TEXT,
        quantity_received DECIMAL,
        uom TEXT,
        supplier_lot_number TEXT,
        container_condition_ok TEXT,
        seals_intact TEXT,
        labels_match TEXT,
        invoice_matches_po TEXT,
        visual_exam_notes TEXT,
        visual_exam_by TEXT,
        visual_exam_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'QUARANTINED',
        qc_reviewed_by TEXT,
        qc_reviewed_at TIMESTAMP,
        qc_disposition TEXT,
        qc_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_coa_documents (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        lot_id VARCHAR NOT NULL,
        receiving_record_id VARCHAR,
        production_batch_id VARCHAR,
        source_type TEXT NOT NULL DEFAULT 'SUPPLIER',
        lab_name TEXT,
        analyst_name TEXT,
        analysis_date TEXT,
        file_name TEXT,
        file_data TEXT,
        document_number TEXT,
        tests_performed TEXT,
        overall_result TEXT,
        identity_test_performed TEXT,
        identity_test_method TEXT,
        identity_confirmed TEXT,
        qc_reviewed_by TEXT,
        qc_reviewed_at TIMESTAMP,
        qc_accepted TEXT,
        qc_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_supplier_qualifications (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id VARCHAR NOT NULL,
        qualification_date TEXT,
        qualification_method TEXT,
        qualified_by TEXT,
        approved_by TEXT,
        last_requalification_date TEXT,
        next_requalification_due TEXT,
        requalification_frequency TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_batch_production_records (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        production_batch_id VARCHAR NOT NULL,
        batch_number TEXT NOT NULL,
        lot_number TEXT,
        product_id VARCHAR NOT NULL,
        recipe_id VARCHAR,
        status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
        theoretical_yield DECIMAL,
        actual_yield DECIMAL,
        yield_percentage DECIMAL,
        yield_min_threshold DECIMAL,
        yield_max_threshold DECIMAL,
        yield_deviation TEXT,
        processing_lines TEXT,
        cleaning_verified TEXT,
        cleaning_verified_by TEXT,
        cleaning_verified_at TIMESTAMP,
        cleaning_record_reference TEXT,
        qc_reviewed_by TEXT,
        qc_reviewed_at TIMESTAMP,
        qc_disposition TEXT,
        qc_notes TEXT,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_bpr_steps (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        bpr_id VARCHAR NOT NULL,
        step_number DECIMAL NOT NULL,
        step_description TEXT NOT NULL,
        performed_by TEXT,
        performed_at TIMESTAMP,
        verified_by TEXT,
        verified_at TIMESTAMP,
        component_id VARCHAR,
        component_lot_id VARCHAR,
        target_weight_measure DECIMAL,
        actual_weight_measure DECIMAL,
        uom TEXT,
        weighed_by TEXT,
        weight_verified_by TEXT,
        added_by TEXT,
        addition_verified_by TEXT,
        monitoring_results TEXT,
        test_results TEXT,
        test_reference TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_bpr_deviations (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        bpr_id VARCHAR NOT NULL,
        bpr_step_id VARCHAR,
        deviation_description TEXT NOT NULL,
        investigation TEXT,
        impact_evaluation TEXT,
        corrective_actions TEXT,
        preventive_actions TEXT,
        disposition TEXT,
        scientific_rationale TEXT,
        reported_by TEXT,
        reported_at TIMESTAMP,
        reviewed_by TEXT,
        reviewed_at TIMESTAMP,
        signature_of_reviewer TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_production_notes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id VARCHAR NOT NULL,
        content TEXT NOT NULL,
        author TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS erp_supplier_documents (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id VARCHAR NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT,
        file_size DECIMAL,
        file_data TEXT,
        uploaded_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("[migrate] ERP tables ready.");
  } catch (err) {
    console.error("[migrate] ERP migration error:", err);
    throw err;
  } finally {
    await pool.end();
  }
}

/**
 * QMS tables — additive, always runs, never blocks ERP startup.
 * All use CREATE TABLE IF NOT EXISTS so they are safe on existing databases.
 */
export async function runQmsMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("[migrate] No DATABASE_URL — skipping QMS migrations");
    return;
  }

  console.log("[migrate] Running QMS table migrations...");
  const pool = makePool(connectionString);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qms_users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'READ_ONLY',
        pin TEXT NOT NULL DEFAULT '0000',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qms_audit_log (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        actor_id VARCHAR NOT NULL,
        actor_email TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        occurred_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qms_signatures (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        signer_id VARCHAR NOT NULL,
        signer_email TEXT NOT NULL,
        signed_at TIMESTAMP DEFAULT NOW(),
        meaning TEXT NOT NULL,
        reauth_method TEXT NOT NULL DEFAULT 'PIN_DEMO',
        payload_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS qms_lot_releases (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        lot_id VARCHAR NOT NULL UNIQUE,
        lot_number TEXT NOT NULL,
        product_name TEXT NOT NULL,
        product_sku TEXT NOT NULL,
        bpr_id VARCHAR,
        coa_id VARCHAR,
        status TEXT NOT NULL DEFAULT 'PENDING_QC_REVIEW',
        decision TEXT,
        signed_by VARCHAR,
        signed_at TIMESTAMP,
        signature_id VARCHAR,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qms_capas (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        number TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'internal',
        fda_obs TEXT,
        owner TEXT NOT NULL,
        target_date TEXT NOT NULL,
        days_left DECIMAL,
        phase TEXT NOT NULL DEFAULT '30d',
        status TEXT NOT NULL DEFAULT 'open',
        description TEXT,
        root_cause TEXT,
        action_plan TEXT,
        effectiveness_result TEXT,
        asana_url TEXT,
        closed_by VARCHAR,
        closed_at TIMESTAMP,
        verified_by VARCHAR,
        verified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qms_capa_actions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        capa_id VARCHAR NOT NULL,
        description TEXT NOT NULL,
        assigned_to TEXT,
        due_date TEXT,
        completed_at TIMESTAMP,
        completed_by TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qms_complaints (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        number TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL DEFAULT 'quality',
        lot_id VARCHAR,
        lot_number TEXT,
        sku TEXT,
        product_name TEXT,
        source TEXT DEFAULT 'gorgias',
        gorgias_ticket_id TEXT,
        customer_name TEXT,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        lot_linkage_required BOOLEAN NOT NULL DEFAULT FALSE,
        root_cause TEXT,
        corrective_action TEXT,
        closed_by VARCHAR,
        closed_at TIMESTAMP,
        received_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Seed QMS users if not already present
    await pool.query(`
      INSERT INTO qms_users (id, name, email, role, pin) VALUES
        (gen_random_uuid(), 'Carrie (QC Manager)',    'carrie@neurogan.com',  'QC_MANAGER',      '1234'),
        (gen_random_uuid(), 'Marcus R. (Production)', 'marcus@neurogan.com',  'PRODUCTION_LEAD', '2345'),
        (gen_random_uuid(), 'Diane P. (Warehouse)',   'diane@neurogan.com',   'WAREHOUSE_LEAD',  '3456'),
        (gen_random_uuid(), 'CS Manager',             'cs@neurogan.com',      'CS_MANAGER',      '4567'),
        (gen_random_uuid(), 'Co-Founder',             'founder@neurogan.com', 'CO_FOUNDER',      '5678')
      ON CONFLICT (email) DO NOTHING;
    `);

    // Seed CAPAs from FDA 483 observations if not already present
    await pool.query(`
      INSERT INTO qms_capas (id, number, title, source, fda_obs, owner, target_date, days_left, phase, status, description, root_cause, action_plan, asana_url) VALUES
        (gen_random_uuid(), 'CAPA-2026-0001', 'Implement QC lot release gate — no lot ships without QC approval', 'fda_observation', 'Obs 5', 'Carrie (QC)', '2026-05-06', 15, '30d', 'in_progress',
         'FDA observed that lots were shipped without formal QC review. The release queue and database gate now enforce QC sign-off before any shipment endpoint will accept a lot code.',
         NULL,
         'Deploy qms.release table + shipment guard. Train QC on release workflow. Validate on LOT-2026-0401 (Urolithin A) before FDA response.',
         '#'),
        (gen_random_uuid(), 'CAPA-2026-0002', 'Separate weigher and verifier roles — enforced at DB level', 'fda_observation', 'Obs 3', 'Engineering', '2026-05-06', 15, '30d', 'in_progress',
         'FDA observed the same employee acted as both weigher and verifier on NMN 500mg batch LOT-2025-1102. A database CHECK constraint now rejects BPRs where production_lead_id = verifier_id.',
         'No system control enforcing two-person integrity. Verbal policy was insufficient.',
         'DB constraint deployed. BPR form UI shows warning if same person selects both roles. Retrain Production Leads and Warehouse Leads on two-person rule.',
         '#'),
        (gen_random_uuid(), 'CAPA-2026-0003', 'COA review workflow — all incoming COAs reviewed by Chief Chemist', 'fda_observation', 'Obs 4', 'Carrie (QC)', '2026-05-06', 15, '30d', 'in_progress',
         'FDA observed that Certificates of Analysis for incoming Urolithin A and NMN raw materials were not reviewed by QC before materials were used in production.',
         'COAs were filed in Dropbox without a formal review workflow. No system tracked who reviewed what.',
         'COA inbox built in ERP. Chief Chemist reviews and signs each COA before status changes from pending to accepted. Materials cannot enter production with pending COAs.',
         '#'),
        (gen_random_uuid(), 'CAPA-2026-0004', 'Label reconciliation added to all BPRs as a required signed step', 'fda_observation', 'Obs 2', 'Marcus R. (Production)', '2026-05-20', 29, '30d', 'open',
         'FDA found no records of label issue, usage, and destruction reconciliation for NMN and Urolithin A runs. Every BPR must now include a label reconciliation step signed by the Production Lead.',
         NULL,
         'Add label reconciliation step to all MMR templates. Update BPR form. Train all Production Leads. First compliant run target: LOT-2026-0420.',
         '#'),
        (gen_random_uuid(), 'CAPA-2026-0005', 'OOS investigation SOP written and deployed for all finished goods testing', 'fda_observation', 'Obs 7', 'Carrie (QC)', '2026-05-20', 29, '30d', 'open',
         'FDA observed that two out-of-specification results on Urolithin A were not formally investigated. A two-phase OOS SOP (SOP-QC-008) and workflow is being implemented.',
         NULL,
         'Draft SOP-QC-008. Build OOS two-phase workflow in ERP. Train Chief Chemist and QC on Phase 1 (lab) and Phase 2 (production) investigation requirements.',
         '#'),
        (gen_random_uuid(), 'CAPA-2026-0006', 'Complaint lot-linkage enforced — Gorgias macro requires lot code', 'fda_observation', 'Obs 8', 'CS Manager', '2026-06-15', 55, '90d', 'open',
         'Complaints received via Gorgias were not tied to specific lot codes, making it impossible to assess scope of quality issues. Gorgias intake macro now requires lot code and SKU.',
         NULL,
         'Update Gorgias macro. Build Gorgias → ERP webhook. Test with 5 synthetic complaints. 30-day grace period for legacy tickets, then enforce NOT NULL constraint on lot_code.',
         '#'),
        (gen_random_uuid(), 'CAPA-2026-0007', 'Adverse event escalation procedure to co-founder and FDA (21 CFR 111.570)', 'fda_observation', 'Obs 10', 'Carrie (QC)', '2026-06-15', 55, '90d', 'open',
         'FDA found no evidence that serious adverse events were escalated to leadership or evaluated against 21 CFR 111.570 reporting requirements.',
         NULL,
         'Build SAE category in complaint workflow. Automatic Slack alert to QC Manager + co-founder on any complaint categorised as serious_adverse_event. Log FDA-reportable flag.',
         '#'),
        (gen_random_uuid(), 'CAPA-2026-0008', 'Supplier qualification — Symbio Labs COA method validation review', 'fda_observation', 'Obs 6', 'Carrie (QC)', '2026-07-19', 89, '90d', 'open',
         'FDA flagged that COAs using ''Confirm by Input'' and ''Input from Supplier'' test methods are not validated methods. Symbio Labs and all suppliers must provide validated method documentation.',
         NULL,
         'Flag all existing COAs with invalid methods. Contact Symbio Labs for validated HPLC method documentation. Disqualify suppliers unable to provide by 2026-07-01.',
         '#'),
        (gen_random_uuid(), 'CAPA-2026-0009', 'Annual cleaning SOP and training records for all production personnel', 'fda_observation', 'Obs 13', 'Marcus R. (Production)', '2026-07-19', 89, '90d', 'open',
         'No formal cleaning SOP or training records existed for production and encapsulation equipment. SOP-QC-014 (Equipment Cleaning) is being drafted and all relevant personnel will be trained.',
         NULL,
         'Draft SOP-QC-014. Schedule hands-on demonstration training. Capture evidence (photos + sign-off form) per employee. Store in Dropbox under /QMS/Training/.',
         '#')
      ON CONFLICT (number) DO NOTHING;
    `);

    // Seed sample complaints if not already present
    await pool.query(`
      INSERT INTO qms_complaints (id, number, category, sku, product_name, description, status, received_at) VALUES
        (gen_random_uuid(), 'CMP-2026-0021', 'adverse_event', 'UA-60CT-500MG',     'Urolithin A 500mg', 'Customer reported adverse reaction after taking product for 3 days.', 'under_investigation', '2026-04-19'),
        (gen_random_uuid(), 'CMP-2026-0020', 'quality',       'NMN-60CT-500MG',    'NMN 500mg',         'Customer reported capsules had off-odor compared to previous purchase.', 'open', '2026-04-17'),
        (gen_random_uuid(), 'CMP-2026-0018', 'quality',       'OMGA-60CT-1000MG',  'Omega-3 1000mg',    'Capsules arrived broken, approximately 20% damaged.', 'open', '2026-04-14')
      ON CONFLICT (number) DO NOTHING;
    `);

    console.log("[migrate] QMS tables and seed data ready.");
  } catch (err) {
    console.error("[migrate] QMS migration error:", err);
    throw err;
  } finally {
    await pool.end();
  }
}
