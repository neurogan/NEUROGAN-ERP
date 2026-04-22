import {
  type Product, type InsertProduct,
  type Lot, type InsertLot,
  type Location, type InsertLocation,
  type Transaction, type InsertTransaction,
  type InventoryGrouped,
  type Supplier, type InsertSupplier,
  type PurchaseOrder, type InsertPurchaseOrder,
  type POLineItem, type InsertPOLineItem,
  type PurchaseOrderWithDetails, type POLineItemWithProduct,
  type ProductionBatch, type InsertProductionBatch,
  type ProductionInput, type InsertProductionInput,
  type ProductionBatchWithDetails, type ProductionInputWithDetails,
  type Recipe, type InsertRecipe,
  type RecipeLine, type InsertRecipeLine,
  type RecipeWithDetails, type RecipeLineWithDetails,
  type AppSettings, type InsertAppSettings,
  type ProductCategory, type InsertProductCategory,
  type ProductCategoryAssignment,
  type ProductWithCategories,
  type ProductCapacity, type MaterialCapacity,
  type ProductionNote, type InsertProductionNote,
  type SupplierDocument, type InsertSupplierDocument,
  type BottleneckMaterial, type LowestCapacityProduct, type DashboardSupplyChain,
  type ReceivingRecord, type InsertReceivingRecord, type ReceivingRecordWithDetails,
  type CoaDocument, type InsertCoaDocument, type CoaDocumentWithDetails,
  type SupplierQualification, type InsertSupplierQualification, type SupplierQualificationWithDetails,
  type BatchProductionRecord, type InsertBpr, type BprStep, type InsertBprStep,
  type BprDeviation, type InsertBprDeviation, type BprWithDetails,
} from "@shared/schema";

export interface TransactionFilters {
  productId?: string;
  lotId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  productionBatchId?: string;
}

export interface TransactionWithDetails extends Transaction {
  productId: string;
  productName: string;
  lotNumber: string;
  locationName: string;
}

// FIFO allocation types
export interface StockByLotLocation {
  lotId: string;
  lotNumber: string;
  locationId: string;
  locationName: string;
  availableQty: number;
  expirationDate: string | null;
  uom: string;
}

export interface FIFOAllocation {
  lotId: string;
  lotNumber: string;
  locationId: string;
  locationName: string;
  quantity: number;
  expirationDate: string | null;
  uom: string;
}

export interface StockShortage {
  productId: string;
  productName: string;
  sku: string;
  requested: number;
  available: number;
  uom: string;
}

export interface InboundPO {
  id: string;
  poNumber: string;
  supplierName: string;
  status: string;
  expectedDeliveryDate: string | null;
  lineItemCount: number;
  totalOrdered: number;
  totalReceived: number;
}

export interface ActiveBatchDetail {
  id: string;
  batchNumber: string;
  productName: string;
  productSku: string;
  status: string;
  plannedQuantity: string;
  outputUom: string;
  startedAt: string | null; // updatedAt when status changed to IN_PROGRESS
  createdAt: string;
}

export interface OpenPODetail {
  id: string;
  poNumber: string;
  supplierName: string;
  status: string;
  expectedDeliveryDate: string | null;
  materials: { name: string; sku: string; qtyOrdered: number; qtyReceived: number; uom: string }[];
  totalOrdered: number;
  totalReceived: number;
}

export interface LowStockItem {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  defaultUom: string;
  totalQuantity: number;
  threshold: number;
}

export interface DashboardStats {
  activeBatches: ActiveBatchDetail[];
  openPOs: OpenPODetail[];
  lowStockItems: LowStockItem[];
  recentTransactions: TransactionWithDetails[];
}

export interface IStorage {
  // Products
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(data: InsertProduct): Promise<Product>;
  updateProduct(id: string, data: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: string): Promise<boolean>;

  // Lots
  getLots(productId?: string): Promise<Lot[]>;
  getLot(id: string): Promise<Lot | undefined>;
  getLotsByProduct(productId: string): Promise<Lot[]>;
  createLot(data: InsertLot): Promise<Lot>;
  updateLot(id: string, data: Partial<InsertLot>): Promise<Lot | undefined>;

  // Locations
  getLocations(): Promise<Location[]>;
  getLocation(id: string): Promise<Location | undefined>;
  createLocation(data: InsertLocation): Promise<Location>;
  updateLocation(id: string, data: Partial<InsertLocation>): Promise<Location | undefined>;
  deleteLocation(id: string): Promise<boolean>;

  // Transactions
  getTransactions(filters?: TransactionFilters): Promise<TransactionWithDetails[]>;
  createTransaction(data: InsertTransaction): Promise<Transaction>;

  // Inventory
  getInventory(): Promise<InventoryGrouped[]>;

  // Suppliers
  getSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | undefined>;
  createSupplier(data: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: string, data: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: string): Promise<boolean>;

  // Purchase Orders
  getPurchaseOrders(filters?: { status?: string; supplierId?: string }): Promise<PurchaseOrderWithDetails[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrderWithDetails | undefined>;
  createPurchaseOrder(data: InsertPurchaseOrder, lineItems: Omit<InsertPOLineItem, "purchaseOrderId">[]): Promise<PurchaseOrderWithDetails>;
  updatePurchaseOrder(id: string, data: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined>;
  updatePurchaseOrderStatus(id: string, status: string): Promise<PurchaseOrder | undefined>;

  // PO Receiving
  receivePOLineItem(lineItemId: string, quantity: number, lotNumber: string, locationId: string, supplierName?: string, expirationDate?: string, receivedDate?: string): Promise<{ lot: Lot; transaction: Transaction }>;

  // Production Batches
  getProductionBatches(filters?: { status?: string }): Promise<ProductionBatchWithDetails[]>;
  getProductionBatch(id: string): Promise<ProductionBatchWithDetails | undefined>;
  createProductionBatch(data: InsertProductionBatch, inputs: Omit<InsertProductionInput, "batchId">[]): Promise<ProductionBatchWithDetails>;
  updateProductionBatch(id: string, data: Partial<InsertProductionBatch>, inputs?: Omit<InsertProductionInput, "batchId">[]): Promise<ProductionBatch | undefined>;
  deleteProductionBatch(id: string): Promise<boolean>;
  completeProductionBatch(id: string, actualQuantity: number, outputLotNumber: string, outputExpirationDate: string | null, locationId: string, qcStatus?: string, qcNotes?: string, endDate?: string, qcDisposition?: string, qcReviewedBy?: string, yieldPercentage?: string): Promise<ProductionBatchWithDetails>;
  getNextBatchNumber(): Promise<string>;
  getNextOutputLotNumber(): Promise<string>;

  // Stock availability & FIFO
  getAvailableStock(productId: string): Promise<StockByLotLocation[]>;
  allocateFIFO(productId: string, quantity: number): Promise<FIFOAllocation[]>;
  validateStockForInputs(inputs: { productId: string; quantity: number }[]): Promise<StockShortage[]>;
  deleteCompletedBatch(id: string): Promise<boolean>;

  // Recipes
  getRecipes(productId?: string): Promise<RecipeWithDetails[]>;
  getRecipe(id: string): Promise<RecipeWithDetails | undefined>;
  createRecipe(data: InsertRecipe, lines: Omit<InsertRecipeLine, "recipeId">[]): Promise<RecipeWithDetails>;
  updateRecipe(id: string, data: Partial<InsertRecipe>, lines?: Omit<InsertRecipeLine, "recipeId">[]): Promise<RecipeWithDetails | undefined>;
  deleteRecipe(id: string): Promise<boolean>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(data: Partial<InsertAppSettings>): Promise<AppSettings>;

  // Product Categories
  getProductCategories(): Promise<ProductCategory[]>;
  createProductCategory(data: InsertProductCategory): Promise<ProductCategory>;
  deleteProductCategory(id: string): Promise<boolean>;
  getProductCategoryAssignments(productId?: string): Promise<ProductCategoryAssignment[]>;
  assignProductCategory(productId: string, categoryId: string): Promise<ProductCategoryAssignment>;
  unassignProductCategory(productId: string, categoryId: string): Promise<boolean>;
  getProductsWithCategories(): Promise<ProductWithCategories[]>;

  // Production Notes
  getProductionNotes(batchId: string): Promise<ProductionNote[]>;
  createProductionNote(data: InsertProductionNote): Promise<ProductionNote>;

  // Supplier Documents
  getSupplierDocuments(supplierId: string): Promise<SupplierDocument[]>;
  createSupplierDocument(data: InsertSupplierDocument): Promise<SupplierDocument>;
  deleteSupplierDocument(id: string): Promise<boolean>;
  getSupplierDocument(id: string): Promise<SupplierDocument | undefined>;

  // Supply Chain Capacity
  getSupplyChainCapacity(): Promise<ProductCapacity[]>;

  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;

  // Dashboard Supply Chain
  getDashboardSupplyChain(): Promise<DashboardSupplyChain>;

  // Receiving & Quarantine
  getReceivingRecords(filters?: { status?: string }): Promise<ReceivingRecordWithDetails[]>;
  getReceivingRecord(id: string): Promise<ReceivingRecordWithDetails | undefined>;
  createReceivingRecord(data: InsertReceivingRecord): Promise<ReceivingRecord>;
  updateReceivingRecord(id: string, data: Partial<InsertReceivingRecord>): Promise<ReceivingRecord | undefined>;
  qcReviewReceivingRecord(id: string, disposition: string, reviewedBy: string, notes?: string): Promise<ReceivingRecord | undefined>;
  getNextReceivingIdentifier(): Promise<string>;
  getQuarantinedLots(): Promise<ReceivingRecordWithDetails[]>;

  // COA Documents
  getCoaDocuments(filters?: { lotId?: string; productionBatchId?: string; sourceType?: string; overallResult?: string }): Promise<CoaDocumentWithDetails[]>;
  getCoaDocument(id: string): Promise<CoaDocumentWithDetails | undefined>;
  createCoaDocument(data: InsertCoaDocument): Promise<CoaDocument>;
  updateCoaDocument(id: string, data: Partial<InsertCoaDocument>): Promise<CoaDocument | undefined>;
  qcReviewCoa(id: string, accepted: boolean, reviewedBy: string, notes?: string): Promise<CoaDocument | undefined>;
  getCoasByLot(lotId: string): Promise<CoaDocumentWithDetails[]>;

  // Supplier Qualifications
  getSupplierQualifications(supplierId?: string): Promise<SupplierQualificationWithDetails[]>;
  getSupplierQualification(id: string): Promise<SupplierQualificationWithDetails | undefined>;
  createSupplierQualification(data: InsertSupplierQualification): Promise<SupplierQualification>;
  updateSupplierQualification(id: string, data: Partial<InsertSupplierQualification>): Promise<SupplierQualification | undefined>;

  // Batch Production Records
  getBprs(filters?: { status?: string; productionBatchId?: string }): Promise<BprWithDetails[]>;
  getBpr(id: string): Promise<BprWithDetails | undefined>;
  getBprByBatchId(productionBatchId: string): Promise<BprWithDetails | undefined>;
  createBpr(data: InsertBpr): Promise<BatchProductionRecord>;
  updateBpr(id: string, data: Partial<InsertBpr>): Promise<BatchProductionRecord | undefined>;
  submitBprForReview(id: string): Promise<BatchProductionRecord | undefined>;
  qcReviewBpr(id: string, disposition: string, reviewedBy: string, notes?: string): Promise<BatchProductionRecord | undefined>;

  // BPR Steps
  addBprStep(bprId: string, data: InsertBprStep): Promise<BprStep>;
  updateBprStep(bprId: string, stepId: string, data: Partial<InsertBprStep>): Promise<BprStep | undefined>;

  // BPR Deviations
  addBprDeviation(bprId: string, data: InsertBprDeviation): Promise<BprDeviation>;
}

// DATABASE_URL is required. The legacy MemStorage fallback was removed —
// it had no persistence, no audit trail, and no attribution, which makes it
// fundamentally incompatible with 21 CFR §111.180 records retention and every
// Part 11 control (see FDA/AGENTS.md §4.4 and FDA/erp-gap-analysis-and-roadmap.md §4.1).
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required. For local dev, see AGENTS.md §2 (cp .env.example .env.local, " +
    "then fill in DATABASE_URL). For Railway deploys, ensure the Postgres service is linked " +
    "to this environment (both staging and production have it — check railway.json)."
  );
}

import { DatabaseStorage } from "./db-storage";

export const storage: IStorage = new DatabaseStorage();
