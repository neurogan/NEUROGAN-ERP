import { Pool } from "pg";

/**
 * Auto-create all tables on startup using raw SQL.
 * This runs IF tables don't exist yet — safe to call on every boot.
 */
export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("[migrate] No DATABASE_URL — skipping migrations (using in-memory storage)");
    return;
  }

  console.log("[migrate] Checking database tables...");
  const pool = new Pool({ connectionString });

  try {
    // Check if tables already exist
    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'products'
    `);

    if (rows.length > 0) {
      console.log("[migrate] Tables already exist — skipping creation");
      await pool.end();
      return;
    }

    console.log("[migrate] Creating tables...");

    await pool.query(`
      -- Products
      CREATE TABLE IF NOT EXISTS products (
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

      -- Lots
      CREATE TABLE IF NOT EXISTS lots (
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

      -- Locations
      CREATE TABLE IF NOT EXISTS locations (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        description TEXT
      );

      -- Transactions
      CREATE TABLE IF NOT EXISTS transactions (
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

      -- Suppliers
      CREATE TABLE IF NOT EXISTS suppliers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        contact_email TEXT,
        contact_phone TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Purchase Orders
      CREATE TABLE IF NOT EXISTS purchase_orders (
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

      -- PO Line Items
      CREATE TABLE IF NOT EXISTS po_line_items (
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

      -- Production Batches
      CREATE TABLE IF NOT EXISTS production_batches (
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

      -- Production Inputs
      CREATE TABLE IF NOT EXISTS production_inputs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id VARCHAR NOT NULL,
        product_id VARCHAR NOT NULL,
        lot_id VARCHAR NOT NULL,
        location_id VARCHAR NOT NULL,
        quantity_used DECIMAL NOT NULL,
        uom TEXT NOT NULL
      );

      -- Recipes
      CREATE TABLE IF NOT EXISTS recipes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Recipe Lines
      CREATE TABLE IF NOT EXISTS recipe_lines (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        recipe_id VARCHAR NOT NULL,
        product_id VARCHAR NOT NULL,
        quantity DECIMAL NOT NULL,
        uom TEXT NOT NULL,
        notes TEXT
      );

      -- Product Categories
      CREATE TABLE IF NOT EXISTS product_categories (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Product Category Assignments
      CREATE TABLE IF NOT EXISTS product_category_assignments (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id VARCHAR NOT NULL,
        category_id VARCHAR NOT NULL
      );

      -- App Settings
      CREATE TABLE IF NOT EXISTS app_settings (
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

      -- Receiving Records
      CREATE TABLE IF NOT EXISTS receiving_records (
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

      -- COA Documents
      CREATE TABLE IF NOT EXISTS coa_documents (
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

      -- Supplier Qualifications
      CREATE TABLE IF NOT EXISTS supplier_qualifications (
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

      -- Batch Production Records
      CREATE TABLE IF NOT EXISTS batch_production_records (
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

      -- BPR Steps
      CREATE TABLE IF NOT EXISTS bpr_steps (
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

      -- BPR Deviations
      CREATE TABLE IF NOT EXISTS bpr_deviations (
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

      -- Production Notes
      CREATE TABLE IF NOT EXISTS production_notes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id VARCHAR NOT NULL,
        content TEXT NOT NULL,
        author TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Supplier Documents
      CREATE TABLE IF NOT EXISTS supplier_documents (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id VARCHAR NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT,
        file_size DECIMAL,
        file_data TEXT,
        uploaded_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("[migrate] All tables created successfully!");
  } catch (err) {
    console.error("[migrate] Error creating tables:", err);
    throw err;
  } finally {
    await pool.end();
  }
}
