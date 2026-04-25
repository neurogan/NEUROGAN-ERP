import {
  pgTable,
  text,
  varchar,
  decimal,
  timestamp,
  pgEnum,
  uuid,
  integer,
  primaryKey,
  jsonb,
  boolean,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Enums
export const categoryEnum = pgEnum("category", ["ACTIVE_INGREDIENT", "SUPPORTING_INGREDIENT", "PRIMARY_PACKAGING", "SECONDARY_PACKAGING", "FINISHED_GOOD"]);
export const statusEnum = pgEnum("status", ["ACTIVE", "DISCONTINUED"]);
export const uomEnum = pgEnum("uom", ["g", "mg", "L", "mL", "gal", "pcs", "lb", "oz"]);
export const transactionTypeEnum = pgEnum("transaction_type", ["PO_RECEIPT", "PRODUCTION_CONSUMPTION", "PRODUCTION_OUTPUT", "COUNT_ADJUSTMENT"]);
export const poStatusEnum = pgEnum("po_status", ["DRAFT", "SUBMITTED", "PARTIALLY_RECEIVED", "CLOSED", "CANCELLED"]);

// F-01: user role + user status as text + Zod unions.
//
// Per AGENTS.md §5.2, enums are declared as text columns + a Zod union rather
// than pgEnum, so values can evolve without requiring a DROP TYPE + CREATE TYPE
// migration dance. The old pgEnum('user_role', ['ADMIN','OPERATOR']) from the
// Perplexity-built scaffold (see 0000_baseline.sql) is dropped by the F-01
// migration; nothing in the codebase referenced it.
export const userRoleEnum = z.enum(["ADMIN", "QA", "PRODUCTION", "WAREHOUSE", "LAB_TECH", "VIEWER"]);
export type UserRole = z.infer<typeof userRoleEnum>;

export const userStatusEnum = z.enum(["ACTIVE", "DISABLED"]);
export type UserStatus = z.infer<typeof userStatusEnum>;

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
  quarantineStatus: text("quarantine_status").default("QUARANTINED"), // QUARANTINED, SAMPLING, PENDING_QC, APPROVED, REJECTED, ON_HOLD
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
  visualExamBy: jsonb("visual_exam_by").$type<{ userId: string | null; fullName: string; title: string | null } | null>(),
  visualExamAt: timestamp("visual_exam_at"),
  // QC Review
  status: text("status").notNull().default("QUARANTINED"), // QUARANTINED, SAMPLING, PENDING_QC, APPROVED, REJECTED, ON_HOLD
  qcReviewedBy: jsonb("qc_reviewed_by").$type<{ userId: string | null; fullName: string; title: string | null } | null>(),
  qcReviewedAt: timestamp("qc_reviewed_at"),
  qcDisposition: text("qc_disposition"), // APPROVED, REJECTED, APPROVED_WITH_CONDITIONS
  qcNotes: text("qc_notes"),
  requiresQualification: boolean("requires_qualification").notNull().default(false),
  qcWorkflowType: text("qc_workflow_type").$type<"FULL_LAB_TEST" | "IDENTITY_CHECK" | "COA_REVIEW" | "EXEMPT" | null>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  samplingPlan: jsonb("sampling_plan").$type<{
    codeLetterLevel2: string;
    sampleSize: number;
    acceptNumber: number;
    rejectNumber: number;
  } | null>(),
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

// Labs registry
export const labStatusEnum = z.enum(["ACTIVE", "INACTIVE", "DISQUALIFIED"]);
export type LabStatus = z.infer<typeof labStatusEnum>;

export const labs = pgTable("erp_labs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  address: text("address"),
  type: text("type").notNull().$type<"IN_HOUSE" | "THIRD_PARTY">(),
  status: text("status").notNull().$type<LabStatus>().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const labTypeEnum = z.enum(["IN_HOUSE", "THIRD_PARTY"]);

export const insertLabSchema = createInsertSchema(labs, {
  type: labTypeEnum,
  status: labStatusEnum.default("ACTIVE"),
}).omit({ id: true, createdAt: true });
export type Lab = typeof labs.$inferSelect;
export type InsertLab = z.infer<typeof insertLabSchema>;

// Approved materials registry
export const approvedMaterials = pgTable(
  "erp_approved_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: varchar("product_id").notNull().references(() => products.id),
    supplierId: varchar("supplier_id").notNull().references(() => suppliers.id),
    approvedByUserId: uuid("approved_by_user_id").notNull().references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.productId, t.supplierId),
  }),
);

export type ApprovedMaterial = typeof approvedMaterials.$inferSelect;

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
  labId: uuid("lab_id").references(() => labs.id),
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

// IdentitySnapshot — stored as jsonb in receiving_records (visual_exam_by, qc_reviewed_by)
export interface IdentitySnapshot {
  userId: string | null;
  fullName: string;
  title: string | null;
}

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
export const insertReceivingRecordSchema = createInsertSchema(receivingRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  requiresQualification: true,
  qcWorkflowType: true,
  visualExamBy: true,
  qcReviewedBy: true,
  samplingPlan: true,
});
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

// ─── F-01: users + user_roles ────────────────────────────────
//
// Required by every downstream regulated ticket. See FDA/neurogan-erp-build-spec.md
// §4.1 for the full data model and §4.3's DoD; authentication (F-02), audit
// trail (F-03), and signature ceremony (F-04) all depend on these tables being
// the sole identity source. Admin deletion is disabled at the app level —
// users are set to status = 'DISABLED', never DELETE-d, per AGENTS.md §4.4 and
// 21 CFR §111.180 retention.

export const users = pgTable("erp_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  title: text("title"),
  passwordHash: text("password_hash").notNull(),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  status: text("status").$type<UserStatus>().notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
});

export const userRoles = pgTable(
  "erp_user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").$type<UserRole>().notNull(),
    grantedByUserId: uuid("granted_by_user_id")
      .notNull()
      .references(() => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.role] }),
  }),
);

// Regulated-safe insert schemas. passwordHash is server-generated; callers
// never set it. status defaults to ACTIVE. createdByUserId comes from
// req.user.id (enforced in F-02's rejectIdentityInBody).
export const insertUserSchema = createInsertSchema(users, {
  email: z.string().email().trim().toLowerCase(),
  fullName: z.string().min(1).trim(),
  title: z.string().trim().nullish(),
  status: userStatusEnum.default("ACTIVE"),
}).omit({
  id: true,
  passwordHash: true,
  passwordChangedAt: true,
  failedLoginCount: true,
  lockedUntil: true,
  createdAt: true,
});

export const insertUserRoleSchema = createInsertSchema(userRoles, {
  role: userRoleEnum,
}).omit({
  grantedAt: true,
});

// Public-facing user response — never includes passwordHash.
// failedLoginCount + lockedUntil are filtered at the route layer for
// non-ADMIN viewers (see server/routes.ts).
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UserRoleRow = typeof userRoles.$inferSelect;
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;

// Shape returned by GET /api/users — flat list of roles, no passwordHash.
export type UserResponse = Omit<User, "passwordHash"> & {
  roles: UserRole[];
};

// Password history — last N hashes per user for reuse checking (D-02).
export const passwordHistory = pgTable("erp_password_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PasswordHistoryRow = typeof passwordHistory.$inferSelect;

// ─── Audit trail (F-03) ────────────────────────────────────────────────────
//
// Append-only record of every regulated write. The database role that the
// application uses is granted INSERT only — UPDATE and DELETE are revoked
// (see migration 0003 and server/db.ts boot check). Part 11 §11.10(e).

export const auditActionEnum = z.enum([
  "CREATE",
  "UPDATE",
  "DELETE_BLOCKED",
  "TRANSITION",
  "SIGN",
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "ROLE_GRANT",
  "ROLE_REVOKE",
  "PASSWORD_ROTATE",
  "LAB_RESULT_ADDED",
  "LAB_QUALIFIED",
  "LAB_DISQUALIFIED",
]);
export type AuditAction = z.infer<typeof auditActionEnum>;

export const auditTrail = pgTable("erp_audit_trail", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").notNull().references(() => users.id),
  action: text("action").$type<AuditAction>().notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  route: text("route"),
  requestId: text("request_id"),
  meta: jsonb("meta"),
});

export type AuditRow = typeof auditTrail.$inferSelect;

export const insertAuditSchema = createInsertSchema(auditTrail, {
  action: auditActionEnum,
}).omit({
  id: true,
  occurredAt: true,
});

// ─── Electronic signatures (F-04) ─────────────────────────────────────────
//
// Part 11 §11.50 / §11.70 / §11.100 / §11.200 / §11.300.
// Each regulated state transition must be accompanied by an e-signature that
// captures the signer's identity snapshot, meaning, and a printable
// manifestation — all in the same DB transaction as the state change.

export const signatureMeaningEnum = z.enum([
  "AUTHORED",
  "REVIEWED",
  "APPROVED",
  "REJECTED",
  "QC_DISPOSITION",
  "QA_RELEASE",
  "DEVIATION_DISPOSITION",
  "RETURN_DISPOSITION",
  "COMPLAINT_REVIEW",
  "SAER_SUBMIT",
  "MMR_APPROVAL",
  "SPEC_APPROVAL",
  "LAB_APPROVAL",
  "LAB_DISQUALIFICATION",
]);
export type SignatureMeaning = z.infer<typeof signatureMeaningEnum>;

export const electronicSignatures = pgTable("erp_electronic_signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").notNull().references(() => users.id),
  meaning: text("meaning").$type<SignatureMeaning>().notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  commentary: text("commentary"),
  fullNameAtSigning: text("full_name_at_signing").notNull(),
  titleAtSigning: text("title_at_signing"),
  requestId: text("request_id").notNull(),
  manifestationJson: jsonb("manifestation_json").notNull(),
});

export type SignatureRow = typeof electronicSignatures.$inferSelect;

export const insertSignatureSchema = createInsertSchema(electronicSignatures, {
  meaning: signatureMeaningEnum,
}).omit({
  id: true,
  signedAt: true,
});

// F-10: Platform and module validation documents (IQ / OQ / PQ / VSR)
export const validationDocumentStatusEnum = z.enum(["DRAFT", "SIGNED"]);
export type ValidationDocumentStatus = z.infer<typeof validationDocumentStatusEnum>;

export const validationDocumentTypeEnum = z.enum(["IQ", "OQ", "PQ", "VSR"]);
export type ValidationDocumentType = z.infer<typeof validationDocumentTypeEnum>;

export const validationDocuments = pgTable("erp_validation_documents", {
  id:          uuid("id").primaryKey().defaultRandom(),
  docId:       text("doc_id").notNull().unique(),
  title:       text("title").notNull(),
  type:        text("type").$type<ValidationDocumentType>().notNull(),
  module:      text("module").notNull(),
  content:     text("content").notNull(),
  status:      text("status").$type<ValidationDocumentStatus>().notNull().default("DRAFT"),
  signatureId: uuid("signature_id").references(() => electronicSignatures.id),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertValidationDocumentSchema = createInsertSchema(validationDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectValidationDocumentSchema = createSelectSchema(validationDocuments);
export type InsertValidationDocument = z.infer<typeof insertValidationDocumentSchema>;
export type SelectValidationDocument = z.infer<typeof selectValidationDocumentSchema>;

// T-06: Per-analyte lab test results (21 CFR §111.75 — test against specifications)
// Each row records one analyte result linked to a COA document and the person
// who performed the test. coaDocumentId uses varchar to match coaDocuments.id.
export const labTestResults = pgTable("erp_lab_test_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  coaDocumentId: varchar("coa_document_id").notNull().references(() => coaDocuments.id),
  analyteName: text("analyte_name").notNull(),
  resultValue: text("result_value").notNull(),
  resultUnits: text("result_units"),
  specMin: text("spec_min"),
  specMax: text("spec_max"),
  pass: boolean("pass").notNull(),
  testedByUserId: uuid("tested_by_user_id").notNull().references(() => users.id),
  testedAt: timestamp("tested_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLabTestResultSchema = createInsertSchema(labTestResults).omit({
  id: true, createdAt: true, testedAt: true, testedByUserId: true, coaDocumentId: true,
});
export type InsertLabTestResult = z.infer<typeof insertLabTestResultSchema>;
export type LabTestResult = typeof labTestResults.$inferSelect;

// Lab Qualifications (T-07) ─────────────────────────────────────────────────
export const labQualifications = pgTable("erp_lab_qualifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  labId: uuid("lab_id").notNull().references(() => labs.id),
  eventType: text("event_type").notNull().$type<"QUALIFIED" | "DISQUALIFIED">(),
  performedByUserId: uuid("performed_by_user_id").notNull().references(() => users.id),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  qualificationMethod: text("qualification_method"),
  requalificationFrequencyMonths: integer("requalification_frequency_months"),
  nextRequalificationDue: text("next_requalification_due"), // ISO date string "YYYY-MM-DD"
  notes: text("notes"),
});

export const insertLabQualificationSchema = createInsertSchema(labQualifications).omit({
  id: true,
  performedAt: true,
});
export type LabQualification = typeof labQualifications.$inferSelect;
export type InsertLabQualification = z.infer<typeof insertLabQualificationSchema>;
export type LabQualificationWithDetails = LabQualification & { performedByName: string };
