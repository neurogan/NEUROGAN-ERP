import { pgTable, text, varchar, decimal, timestamp, pgEnum, boolean, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Enums
export const categoryEnum = pgEnum("category", ["ACTIVE_INGREDIENT", "SUPPORTING_INGREDIENT", "PRIMARY_PACKAGING", "SECONDARY_PACKAGING", "FINISHED_GOOD"]);
export const statusEnum = pgEnum("status", ["ACTIVE", "DISCONTINUED"]);
export const uomEnum = pgEnum("uom", ["g", "mg", "L", "mL", "gal", "pcs", "lb", "oz"]);
export const transactionTypeEnum = pgEnum("transaction_type", ["PO_RECEIPT", "PRODUCTION_CONSUMPTION", "PRODUCTION_OUTPUT", "COUNT_ADJUSTMENT"]);
export const userRoleEnum = pgEnum("user_role", ["ADMIN", "OPERATOR"]);
export const poStatusEnum = pgEnum("po_status", ["DRAFT", "SUBMITTED", "PARTIALLY_RECEIVED", "CLOSED", "CANCELLED"]);

// Products
export const products = pgTable("erp_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  category: text("category").notNull().default("ACTIVE_INGREDIENT"),
  defaultUom: text("default_uom").notNull().default("g"),
  description: text("description"),
  status: text("status").notNull().default("ACTIVE"),
  lowStockThreshold: decimal("low_stock_threshold"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Lots
export const lots = pgTable("erp_lots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  lotNumber: text("lot_number").notNull(),
  supplierName: text("supplier_name"),
  receivedDate: text("received_date"),
  expirationDate: text("expiration_date"),
  supplierCoaUrl: text("supplier_coa_url"),
  neuroganCoaUrl: text("neurogan_coa_url"),
  purchasePrice: decimal("purchase_price"),
  purchaseUom: text("purchase_uom"),
  poReference: text("po_reference"),
  notes: text("notes"),
  quarantineStatus: text("quarantine_status").default("APPROVED"), // QUARANTINED, SAMPLING, PENDING_QC, APPROVED, REJECTED, ON_HOLD
  createdAt: timestamp("created_at").defaultNow(),
});

// Receiving Records (quarantine + visual inspection for incoming materials)
export const receivingRecords = pgTable("erp_receiving_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id"),
  lotId: varchar("lot_id").notNull(),
  supplierId: varchar("supplier_id"),
  uniqueIdentifier: text("unique_identifier").notNull(), // auto-generated RCV-YYYYMMDD-NNN
  dateReceived: text("date_received"),
  quantityReceived: decimal("quantity_received"),
  uom: text("uom"),
  supplierLotNumber: text("supplier_lot_number"),
  // Visual inspection
  containerConditionOk: text("container_condition_ok"), // "true"/"false"
  sealsIntact: text("seals_intact"),
  labelsMatch: text("labels_match"),
  invoiceMatchesPo: text("invoice_matches_po"),
  visualExamNotes: text("visual_exam_notes"),
  visualExamBy: text("visual_exam_by"),
  visualExamAt: timestamp("visual_exam_at"),
  // QC Review
  status: text("status").notNull().default("QUARANTINED"), // QUARANTINED, SAMPLING, PENDING_QC, APPROVED, REJECTED, ON_HOLD
  qcReviewedBy: text("qc_reviewed_by"),
  qcReviewedAt: timestamp("qc_reviewed_at"),
  qcDisposition: text("qc_disposition"), // APPROVED, REJECTED, APPROVED_WITH_CONDITIONS
  qcNotes: text("qc_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Locations
export const locations = pgTable("erp_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
});

// Transactions (append-only audit log)
export const transactions = pgTable("erp_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lotId: varchar("lot_id").notNull(),
  locationId: varchar("location_id").notNull(),
  type: text("type").notNull(), // PO_RECEIPT, PRODUCTION_CONSUMPTION, COUNT_ADJUSTMENT
  quantity: decimal("quantity").notNull(),
  uom: text("uom").notNull(),
  productionBatchId: text("production_batch_id"),
  notes: text("notes"),
  performedBy: text("performed_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Suppliers
export const suppliers = pgTable("erp_suppliers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Purchase Orders
export const purchaseOrders = pgTable("erp_purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poNumber: text("po_number").notNull().unique(),
  supplierId: varchar("supplier_id").notNull(),
  status: text("status").notNull().default("DRAFT"),
  orderDate: text("order_date"),
  expectedDeliveryDate: text("expected_delivery_date"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// PO Line Items
export const poLineItems = pgTable("erp_po_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id").notNull(),
  productId: varchar("product_id").notNull(),
  quantityOrdered: decimal("quantity_ordered").notNull(),
  quantityReceived: decimal("quantity_received").notNull().default("0"),
  unitPrice: decimal("unit_price"),
  uom: text("uom").notNull(),
  lotNumber: text("lot_number"),
  notes: text("notes"),
});

// Production Batches
export const productionBatches = pgTable("erp_production_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchNumber: text("batch_number").notNull().unique(),
  productId: varchar("product_id").notNull(), // finished product being made
  status: text("status").notNull().default("DRAFT"), // DRAFT, IN_PROGRESS, COMPLETED, ON_HOLD
  plannedQuantity: decimal("planned_quantity").notNull(),
  actualQuantity: decimal("actual_quantity"),
  outputUom: text("output_uom").notNull().default("pcs"),
  outputLotNumber: text("output_lot_number"), // new lot# for the finished product
  outputExpirationDate: text("output_expiration_date"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  qcStatus: text("qc_status").default("PENDING"), // PENDING, PASS, FAIL, ON_HOLD
  qcNotes: text("qc_notes"),
  qcDisposition: text("qc_disposition"), // APPROVED_FOR_DISTRIBUTION, REJECTED, REPROCESS
  qcReviewedBy: text("qc_reviewed_by"),
  yieldPercentage: decimal("yield_percentage"),
  operatorName: text("operator_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Recipes (BOM for finished goods — defines materials per 1 unit of output)
export const recipes = pgTable("erp_recipes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(), // the finished good this recipe is for
  name: text("name").notNull(), // e.g. "Standard Formula"
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Recipe Lines (individual material lines in a recipe)
export const recipeLines = pgTable("erp_recipe_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recipeId: varchar("recipe_id").notNull(),
  productId: varchar("product_id").notNull(), // the material/ingredient
  quantity: decimal("quantity").notNull(), // amount needed per 1 unit of output
  uom: text("uom").notNull(),
  notes: text("notes"),
});

// Product Categories (e.g. "Spermidine", "GHK-Cu", "AHK-Cu")
export const productCategories = pgTable("erp_product_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Product-to-Category assignments (many-to-many)
export const productCategoryAssignments = pgTable("erp_product_category_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  categoryId: varchar("category_id").notNull(),
});

// App Settings (single-row key-value store)
export const appSettings = pgTable("erp_app_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name").notNull().default("Neurogan"),
  defaultUom: text("default_uom").notNull().default("g"),
  lowStockThreshold: decimal("low_stock_threshold").notNull().default("1"),
  dateFormat: text("date_format").notNull().default("MM/DD/YYYY"), // MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD
  autoGenerateBatchNumbers: text("auto_generate_batch_numbers").notNull().default("true"),
  batchNumberPrefix: text("batch_number_prefix").notNull().default("BATCH"),
  autoGenerateLotNumbers: text("auto_generate_lot_numbers").notNull().default("true"),
  lotNumberPrefix: text("lot_number_prefix").notNull().default("LOT"),
  fgLotNumberPrefix: text("fg_lot_number_prefix").notNull().default("FG"),
  skuPrefixRawMaterial: text("sku_prefix_raw_material").notNull().default("RA"),
  skuPrefixFinishedGood: text("sku_prefix_finished_good").notNull().default("US"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// COA Documents (Certificates of Analysis)
export const coaDocuments = pgTable("erp_coa_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lotId: varchar("lot_id").notNull(),
  receivingRecordId: varchar("receiving_record_id"),
  productionBatchId: varchar("production_batch_id"),
  sourceType: text("source_type").notNull().default("SUPPLIER"), // INTERNAL_LAB, THIRD_PARTY_LAB, SUPPLIER
  labName: text("lab_name"),
  analystName: text("analyst_name"),
  analysisDate: text("analysis_date"),
  fileName: text("file_name"),
  fileData: text("file_data"), // base64 encoded PDF/image
  documentNumber: text("document_number"),
  testsPerformed: text("tests_performed"), // JSON array: [{ testName, method, specification, result, passFail }]
  overallResult: text("overall_result"), // PASS, FAIL, CONDITIONAL
  identityTestPerformed: text("identity_test_performed"), // "true"/"false"
  identityTestMethod: text("identity_test_method"),
  identityConfirmed: text("identity_confirmed"), // "true"/"false"
  qcReviewedBy: text("qc_reviewed_by"),
  qcReviewedAt: timestamp("qc_reviewed_at"),
  qcAccepted: text("qc_accepted"), // "true"/"false"
  qcNotes: text("qc_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Supplier Qualifications (for relying on supplier COAs per 21 CFR 111.75)
export const supplierQualifications = pgTable("erp_supplier_qualifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  supplierId: varchar("supplier_id").notNull(),
  qualificationDate: text("qualification_date"),
  qualificationMethod: text("qualification_method"),
  qualifiedBy: text("qualified_by"),
  approvedBy: text("approved_by"),
  lastRequalificationDate: text("last_requalification_date"),
  nextRequalificationDue: text("next_requalification_due"),
  requalificationFrequency: text("requalification_frequency"), // e.g. "12 months"
  status: text("status").notNull().default("PENDING"), // QUALIFIED, PENDING, DISQUALIFIED
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Batch Production Records (21 CFR 111.255-260 compliance)
export const batchProductionRecords = pgTable("erp_batch_production_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productionBatchId: varchar("production_batch_id").notNull(),
  batchNumber: text("batch_number").notNull(),
  lotNumber: text("lot_number"),
  productId: varchar("product_id").notNull(),
  recipeId: varchar("recipe_id"),
  status: text("status").notNull().default("IN_PROGRESS"), // IN_PROGRESS, PENDING_QC_REVIEW, APPROVED, REJECTED
  // Yield tracking (Sec. 111.260(f))
  theoreticalYield: decimal("theoretical_yield"),
  actualYield: decimal("actual_yield"),
  yieldPercentage: decimal("yield_percentage"),
  yieldMinThreshold: decimal("yield_min_threshold"),
  yieldMaxThreshold: decimal("yield_max_threshold"),
  yieldDeviation: text("yield_deviation"), // "true"/"false"
  // Equipment & cleaning (Sec. 111.260(b-c))
  processingLines: text("processing_lines"),
  cleaningVerified: text("cleaning_verified"), // "true"/"false"
  cleaningVerifiedBy: text("cleaning_verified_by"),
  cleaningVerifiedAt: timestamp("cleaning_verified_at"),
  cleaningRecordReference: text("cleaning_record_reference"),
  // QC Review (Sec. 111.260(l))
  qcReviewedBy: text("qc_reviewed_by"),
  qcReviewedAt: timestamp("qc_reviewed_at"),
  qcDisposition: text("qc_disposition"), // APPROVED_FOR_DISTRIBUTION, REJECTED, REPROCESS
  qcNotes: text("qc_notes"),
  // Timestamps
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// BPR Steps (per-step documentation with dual verification)
export const bprSteps = pgTable("erp_bpr_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bprId: varchar("bpr_id").notNull(),
  stepNumber: decimal("step_number").notNull(),
  stepDescription: text("step_description").notNull(),
  // Dual verification (Sec. 111.210(h)(3)(ii))
  performedBy: text("performed_by"),
  performedAt: timestamp("performed_at"),
  verifiedBy: text("verified_by"), // MUST differ from performedBy
  verifiedAt: timestamp("verified_at"),
  // Component weighing/measuring (Sec. 111.260(j))
  componentId: varchar("component_id"),
  componentLotId: varchar("component_lot_id"),
  targetWeightMeasure: decimal("target_weight_measure"),
  actualWeightMeasure: decimal("actual_weight_measure"),
  uom: text("uom"),
  weighedBy: text("weighed_by"),
  weightVerifiedBy: text("weight_verified_by"), // MUST differ from weighedBy
  addedBy: text("added_by"),
  additionVerifiedBy: text("addition_verified_by"), // MUST differ from addedBy
  // Results
  monitoringResults: text("monitoring_results"), // JSON
  testResults: text("test_results"), // JSON
  testReference: text("test_reference"),
  notes: text("notes"),
  status: text("status").notNull().default("PENDING"), // PENDING, IN_PROGRESS, COMPLETED, VERIFIED
  createdAt: timestamp("created_at").defaultNow(),
});

// BPR Deviations (Sec. 111.140(b)(3))
export const bprDeviations = pgTable("erp_bpr_deviations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bprId: varchar("bpr_id").notNull(),
  bprStepId: varchar("bpr_step_id"),
  deviationDescription: text("deviation_description").notNull(),
  investigation: text("investigation"),
  impactEvaluation: text("impact_evaluation"),
  correctiveActions: text("corrective_actions"),
  preventiveActions: text("preventive_actions"),
  disposition: text("disposition"),
  scientificRationale: text("scientific_rationale"),
  reportedBy: text("reported_by"),
  reportedAt: timestamp("reported_at"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  signatureOfReviewer: text("signature_of_reviewer"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Production Notes (append-only comment log on batches)
export const productionNotes = pgTable("erp_production_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").notNull(),
  content: text("content").notNull(),
  author: text("author"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Supplier Documents (contracts, COAs, etc.)
export const supplierDocuments = pgTable("erp_supplier_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  supplierId: varchar("supplier_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type"),
  fileSize: decimal("file_size"),
  fileData: text("file_data"), // base64 encoded
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

// Production Input Lines (materials consumed in a batch)
export const productionInputs = pgTable("erp_production_inputs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").notNull(),
  productId: varchar("product_id").notNull(), // the input material
  lotId: varchar("lot_id").notNull(), // specific source lot
  locationId: varchar("location_id").notNull(), // source location
  quantityUsed: decimal("quantity_used").notNull(),
  uom: text("uom").notNull(),
});

// Insert schemas
export const insertProductCategorySchema = createInsertSchema(productCategories).omit({ id: true, createdAt: true });
export const insertProductCategoryAssignmentSchema = createInsertSchema(productCategoryAssignments).omit({ id: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLotSchema = createInsertSchema(lots).omit({ id: true, createdAt: true });
export const insertLocationSchema = createInsertSchema(locations).omit({ id: true });
export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true });
export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true, createdAt: true });
export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPOLineItemSchema = createInsertSchema(poLineItems).omit({ id: true });
export const insertProductionBatchSchema = createInsertSchema(productionBatches).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProductionInputSchema = createInsertSchema(productionInputs).omit({ id: true });
export const insertAppSettingsSchema = createInsertSchema(appSettings).omit({ id: true, updatedAt: true });
export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRecipeLineSchema = createInsertSchema(recipeLines).omit({ id: true });
export const insertProductionNoteSchema = createInsertSchema(productionNotes).omit({ id: true, createdAt: true });
export const insertSupplierDocumentSchema = createInsertSchema(supplierDocuments).omit({ id: true, uploadedAt: true });
export const insertReceivingRecordSchema = createInsertSchema(receivingRecords).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCoaDocumentSchema = createInsertSchema(coaDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSupplierQualificationSchema = createInsertSchema(supplierQualifications).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBprSchema = createInsertSchema(batchProductionRecords).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBprStepSchema = createInsertSchema(bprSteps).omit({ id: true, createdAt: true });
export const insertBprDeviationSchema = createInsertSchema(bprDeviations).omit({ id: true, createdAt: true });

// Types
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Lot = typeof lots.$inferSelect;
export type InsertLot = z.infer<typeof insertLotSchema>;
export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type POLineItem = typeof poLineItems.$inferSelect;
export type InsertPOLineItem = z.infer<typeof insertPOLineItemSchema>;
export type ProductionBatch = typeof productionBatches.$inferSelect;
export type InsertProductionBatch = z.infer<typeof insertProductionBatchSchema>;
export type ProductionInput = typeof productionInputs.$inferSelect;
export type InsertProductionInput = z.infer<typeof insertProductionInputSchema>;
export type Recipe = typeof recipes.$inferSelect;
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type RecipeLine = typeof recipeLines.$inferSelect;
export type InsertRecipeLine = z.infer<typeof insertRecipeLineSchema>;
export type AppSettings = typeof appSettings.$inferSelect;
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type ProductCategory = typeof productCategories.$inferSelect;
export type InsertProductCategory = z.infer<typeof insertProductCategorySchema>;
export type ProductCategoryAssignment = typeof productCategoryAssignments.$inferSelect;
export type InsertProductCategoryAssignment = z.infer<typeof insertProductCategoryAssignmentSchema>;
export type ProductionNote = typeof productionNotes.$inferSelect;
export type InsertProductionNote = z.infer<typeof insertProductionNoteSchema>;
export type SupplierDocument = typeof supplierDocuments.$inferSelect;
export type InsertSupplierDocument = z.infer<typeof insertSupplierDocumentSchema>;
export type ReceivingRecord = typeof receivingRecords.$inferSelect;
export type InsertReceivingRecord = z.infer<typeof insertReceivingRecordSchema>;

export type ReceivingRecordWithDetails = ReceivingRecord & {
  productName: string;
  productSku: string;
  lotNumber: string;
  supplierName: string | null;
};

export type CoaDocument = typeof coaDocuments.$inferSelect;
export type InsertCoaDocument = z.infer<typeof insertCoaDocumentSchema>;
export type SupplierQualification = typeof supplierQualifications.$inferSelect;
export type InsertSupplierQualification = z.infer<typeof insertSupplierQualificationSchema>;

export type CoaDocumentWithDetails = CoaDocument & {
  productName: string;
  productSku: string;
  lotNumber: string;
  supplierName: string | null;
};

export type SupplierQualificationWithDetails = SupplierQualification & {
  supplierName: string;
};

export type BatchProductionRecord = typeof batchProductionRecords.$inferSelect;
export type InsertBpr = z.infer<typeof insertBprSchema>;
export type BprStep = typeof bprSteps.$inferSelect;
export type InsertBprStep = z.infer<typeof insertBprStepSchema>;
export type BprDeviation = typeof bprDeviations.$inferSelect;
export type InsertBprDeviation = z.infer<typeof insertBprDeviationSchema>;

export type BprWithDetails = BatchProductionRecord & {
  productName: string;
  productSku: string;
  steps: BprStep[];
  deviations: BprDeviation[];
};

// Inventory view type (computed from transactions)
export type InventoryItem = {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  lotId: string;
  lotNumber: string;
  locationId: string;
  locationName: string;
  quantity: number;
  uom: string;
  supplierName: string | null;
  expirationDate: string | null;
};

export type InventoryGrouped = {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  defaultUom: string;
  totalQuantity: number;
  lowStockThreshold: number | null;
  lots: {
    lotId: string;
    lotNumber: string;
    supplierName: string | null;
    expirationDate: string | null;
    locations: {
      locationId: string;
      locationName: string;
      quantity: number;
      uom: string;
    }[];
    totalQuantity: number;
  }[];
};

export type POLineItemWithProduct = POLineItem & {
  productName: string;
  productSku: string;
};

export type PurchaseOrderWithDetails = PurchaseOrder & {
  supplierName: string;
  lineItems: POLineItemWithProduct[];
  totalOrdered: number;
  totalReceived: number;
};

export type ProductionInputWithDetails = ProductionInput & {
  productName: string;
  productSku: string;
  lotNumber: string;
  locationName: string;
};

export type ProductionBatchWithDetails = ProductionBatch & {
  productName: string;
  productSku: string;
  inputs: ProductionInputWithDetails[];
  qcDisposition?: string | null;
  qcReviewedBy?: string | null;
  yieldPercentage?: string | null;
};

export type RecipeLineWithDetails = RecipeLine & {
  productName: string;
  productSku: string;
  productCategory: string;
};

export type RecipeWithDetails = Recipe & {
  productName: string;
  productSku: string;
  lines: RecipeLineWithDetails[];
};

// Product with category assignments
export type ProductWithCategories = Product & {
  categories: ProductCategory[];
};

// ─────────────────────────────────────────────────────────────────────────────
// QMS Tables (Phase 1)
// ─────────────────────────────────────────────────────────────────────────────

export const qmsRoleEnum = pgEnum("qms_role", [
  "QC_MANAGER", "PRODUCTION_LEAD", "WAREHOUSE_LEAD",
  "CS_MANAGER", "CHEMIST", "CO_FOUNDER", "ADMIN", "READ_ONLY",
]);

// QMS Users (hardcoded for demo; real bcrypt login is a Phase 4 prerequisite)
export const qmsUsers = pgTable("qms_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("READ_ONLY"),
  pin: text("pin").notNull().default("0000"), // demo re-auth PIN (NOT Part 11 compliant)
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Immutable audit log — INSERT ONLY, no update/delete routes ever exposed
export const qmsAuditLog = pgTable("qms_audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tableName: text("table_name").notNull(),
  recordId: text("record_id").notNull(),
  operation: text("operation").notNull(), // CREATE | UPDATE | DELETE | SIGN | TRANSITION
  actorId: varchar("actor_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  occurredAt: timestamp("occurred_at").defaultNow(),
});

// E-signatures (21 CFR Part 11) — INSERT ONLY
export const qmsSignatures = pgTable("qms_signatures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tableName: text("table_name").notNull(),
  recordId: text("record_id").notNull(),
  signerId: varchar("signer_id").notNull(),
  signerEmail: text("signer_email").notNull(),
  signedAt: timestamp("signed_at").defaultNow(),
  meaning: text("meaning").notNull(), // APPROVED | REJECTED | REVIEWED | TRAINED | RELEASED | CLOSED
  reauthMethod: text("reauth_method").notNull().default("PIN_DEMO"),
  payloadHash: text("payload_hash").notNull(), // SHA-256 of (recordId + signerId + meaning + timestamp)
});

// Lot release gate — one record per lot
export const qmsLotReleases = pgTable("qms_lot_releases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lotId: varchar("lot_id").notNull().unique(),
  lotNumber: text("lot_number").notNull(),
  productName: text("product_name").notNull(),
  productSku: text("product_sku").notNull(),
  bprId: varchar("bpr_id"),
  coaId: varchar("coa_id"),
  status: text("status").notNull().default("PENDING_QC_REVIEW"), // PENDING_QC_REVIEW | APPROVED | REJECTED | ON_HOLD
  decision: text("decision"), // APPROVED | REJECTED | ON_HOLD
  signedBy: varchar("signed_by"),
  signedAt: timestamp("signed_at"),
  signatureId: varchar("signature_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CAPAs
export const qmsCapas = pgTable("qms_capas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  number: text("number").notNull().unique(), // CAPA-2026-XXXX
  title: text("title").notNull(),
  source: text("source").notNull().default("internal"), // fda_observation | customer_complaint | internal_audit | internal
  fdaObs: text("fda_obs"), // e.g. "Obs 5"
  owner: text("owner").notNull(),
  targetDate: text("target_date").notNull(),
  daysLeft: decimal("days_left"),
  phase: text("phase").notNull().default("30d"), // 30d | 90d | 180d
  status: text("status").notNull().default("open"), // open | in_progress | pending_effectiveness | closed | verified | on_hold | reopened
  description: text("description"),
  rootCause: text("root_cause"),
  actionPlan: text("action_plan"),
  effectivenessResult: text("effectiveness_result"),
  asanaUrl: text("asana_url"),
  closedBy: varchar("closed_by"),
  closedAt: timestamp("closed_at"),
  verifiedBy: varchar("verified_by"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CAPA action items
export const qmsCapaActions = pgTable("qms_capa_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  capaId: varchar("capa_id").notNull(),
  description: text("description").notNull(),
  assignedTo: text("assigned_to"),
  dueDate: text("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  status: text("status").notNull().default("open"), // open | complete
  createdAt: timestamp("created_at").defaultNow(),
});

// Customer / quality complaints
export const qmsComplaints = pgTable("qms_complaints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  number: text("number").notNull().unique(), // CMP-2026-XXXX
  category: text("category").notNull().default("quality"), // quality | adverse_event | serious_adverse_event | labeling | foreign_matter
  lotId: varchar("lot_id"),
  lotNumber: text("lot_number"),
  sku: text("sku"),
  productName: text("product_name"),
  source: text("source").default("gorgias"), // gorgias | email | phone | in_person
  gorgiasTicketId: text("gorgias_ticket_id"),
  customerName: text("customer_name"),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"), // open | under_investigation | pending_qc_review | closed | escalated_sae
  lotLinkageRequired: boolean("lot_linkage_required").notNull().default(false),
  rootCause: text("root_cause"),
  correctiveAction: text("corrective_action"),
  closedBy: varchar("closed_by"),
  closedAt: timestamp("closed_at"),
  receivedAt: timestamp("received_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas (QMS)
export const insertQmsUserSchema = createInsertSchema(qmsUsers).omit({ id: true, createdAt: true });
export const insertQmsAuditLogSchema = createInsertSchema(qmsAuditLog).omit({ id: true, occurredAt: true });
export const insertQmsSignatureSchema = createInsertSchema(qmsSignatures).omit({ id: true, signedAt: true });
export const insertQmsLotReleaseSchema = createInsertSchema(qmsLotReleases).omit({ id: true, createdAt: true, updatedAt: true });
export const insertQmsCapaSchema = createInsertSchema(qmsCapas).omit({ id: true, createdAt: true, updatedAt: true });
export const insertQmsCapaActionSchema = createInsertSchema(qmsCapaActions).omit({ id: true, createdAt: true });
export const insertQmsComplaintSchema = createInsertSchema(qmsComplaints).omit({ id: true, createdAt: true, updatedAt: true, receivedAt: true });

// Types (QMS)
export type QmsUser = typeof qmsUsers.$inferSelect;
export type InsertQmsUser = z.infer<typeof insertQmsUserSchema>;
export type QmsAuditLog = typeof qmsAuditLog.$inferSelect;
export type InsertQmsAuditLog = z.infer<typeof insertQmsAuditLogSchema>;
export type QmsSignature = typeof qmsSignatures.$inferSelect;
export type InsertQmsSignature = z.infer<typeof insertQmsSignatureSchema>;
export type QmsLotRelease = typeof qmsLotReleases.$inferSelect;
export type InsertQmsLotRelease = z.infer<typeof insertQmsLotReleaseSchema>;
export type QmsCapa = typeof qmsCapas.$inferSelect;
export type InsertQmsCapa = z.infer<typeof insertQmsCapaSchema>;
export type QmsCapaAction = typeof qmsCapaActions.$inferSelect;
export type InsertQmsCapaAction = z.infer<typeof insertQmsCapaActionSchema>;
export type QmsComplaint = typeof qmsComplaints.$inferSelect;
export type InsertQmsComplaint = z.infer<typeof insertQmsComplaintSchema>;

export type QmsCapaWithActions = QmsCapa & { actions: QmsCapaAction[] };
export type QmsLotReleaseWithDetails = QmsLotRelease & {
  signerName?: string | null;
  signerEmail?: string | null;
};

export type QmsDashboardStats = {
  pendingReleases: number;
  openCapas: number;
  openComplaints: number;
  trainingGaps: number;
};

// Supply chain capacity types
export type MaterialCapacity = {
  productId: string;
  productName: string;
  sku: string;
  requiredPerUnit: number;
  uom: string;
  inStock: number;
  supportsUnits: number;
  inboundFromPOs: number;
  inboundSupportsUnits: number;
  isBottleneck: boolean;
};

export type ProductCapacity = {
  productId: string;
  productName: string;
  sku: string;
  categories: ProductCategory[];
  currentFGStock: number;
  producibleUnits: number;
  inboundProducibleUnits: number;
  inProductionUnits: number;
  activeBatchCount: number;
  totalPotential: number;
  bottleneckMaterial: string | null;
  hasRecipe: boolean;
  materials: MaterialCapacity[];
};

// Dashboard supply chain bottleneck types
export type BottleneckMaterial = {
  materialId: string;
  materialName: string;
  materialSku: string;
  productCount: number;
  inStock: number;
  uom: string;
};

export type LowestCapacityProduct = {
  productId: string;
  productName: string;
  productSku: string;
  totalPotential: number;
  bottleneckMaterial: string | null;
};

export type DashboardSupplyChain = {
  topBottleneckMaterials: BottleneckMaterial[];
  lowestCapacityProducts: LowestCapacityProduct[];
};
