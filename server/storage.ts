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
import { randomUUID } from "crypto";

export interface TransactionFilters {
  productId?: string;
  lotId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  productionBatchId?: string;
}

export interface TransactionWithDetails extends Transaction {
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

export class MemStorage implements IStorage {
  private products: Map<string, Product>;
  private lots: Map<string, Lot>;
  private locations: Map<string, Location>;
  private transactions: Map<string, Transaction>;
  private suppliers: Map<string, Supplier>;
  private purchaseOrders: Map<string, PurchaseOrder>;
  private poLineItems: Map<string, POLineItem>;
  private productionBatches: Map<string, ProductionBatch>;
  private productionInputs: Map<string, ProductionInput>;
  private recipes: Map<string, Recipe>;
  private recipeLines: Map<string, RecipeLine>;
  private settings: AppSettings;
  private productCategoriesMap: Map<string, ProductCategory>;
  private productCategoryAssignments: Map<string, ProductCategoryAssignment>;
  private productionNotesMap: Map<string, ProductionNote>;
  private supplierDocumentsMap: Map<string, SupplierDocument>;
  private receivingRecordsMap: Map<string, ReceivingRecord>;
  private coaDocumentsMap: Map<string, CoaDocument>;
  private supplierQualificationsMap: Map<string, SupplierQualification>;
  private bprMap: Map<string, BatchProductionRecord>;
  private bprStepsMap: Map<string, BprStep>;
  private bprDeviationsMap: Map<string, BprDeviation>;

  constructor() {
    this.products = new Map();
    this.lots = new Map();
    this.locations = new Map();
    this.transactions = new Map();
    this.suppliers = new Map();
    this.purchaseOrders = new Map();
    this.poLineItems = new Map();
    this.productionBatches = new Map();
    this.productionInputs = new Map();
    this.recipes = new Map();
    this.recipeLines = new Map();
    this.productCategoriesMap = new Map();
    this.productCategoryAssignments = new Map();
    this.productionNotesMap = new Map();
    this.supplierDocumentsMap = new Map();
    this.receivingRecordsMap = new Map();
    this.coaDocumentsMap = new Map();
    this.supplierQualificationsMap = new Map();
    this.bprMap = new Map();
    this.bprStepsMap = new Map();
    this.bprDeviationsMap = new Map();
    this.settings = {
      id: randomUUID(),
      companyName: "Neurogan",
      defaultUom: "g",
      lowStockThreshold: "1",
      dateFormat: "MM/DD/YYYY",
      autoGenerateBatchNumbers: "true",
      batchNumberPrefix: "BATCH",
      autoGenerateLotNumbers: "true",
      lotNumberPrefix: "LOT",
      fgLotNumberPrefix: "FG",
      skuPrefixRawMaterial: "RA",
      skuPrefixFinishedGood: "US",
      updatedAt: new Date(),
    };
    this.seed();
  }

  private seed() {
    const now = new Date();

    // ─── Locations (from spreadsheet) ───
    this.locations.set("loc-1", { id: "loc-1", name: "23W.1.1", description: "Warehouse 23W, Section 1, Shelf 1" });
    this.locations.set("loc-2", { id: "loc-2", name: "23W.3.1", description: "Warehouse 23W, Section 3, Shelf 1" });
    this.locations.set("loc-3", { id: "loc-3", name: "23w.2.1", description: "Warehouse 23W, Section 2, Shelf 1" });
    this.locations.set("loc-4", { id: "loc-4", name: "Lab Fridge", description: "Laboratory refrigerator for samples and small quantities" });
    this.locations.set("loc-5", { id: "loc-5", name: "Room 2 Fridge", description: "Temperature-controlled fridge in Room 2" });
    this.locations.set("loc-6", { id: "loc-6", name: "Room 3 Freezer", description: "Deep freezer in Room 3" });

    // ─── Products (69 active ingredients from Feb-2026 snapshot) ───
    this.products.set("prod-1", { id: "prod-1", name: "AHK-Cu", sku: "RA-AHKCU", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-2", { id: "prod-2", name: "AKK", sku: "RA-AKKMU", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-3", { id: "prod-3", name: "AOD", sku: "RA-AOD96", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-4", { id: "prod-4", name: "Acetyl Octapeptide-3", sku: "RA-ACOCT", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-5", { id: "prod-5", name: "BPC-157", sku: "RA-BPC15", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-6", { id: "prod-6", name: "Berberine", sku: "RA-BERBN", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-7", { id: "prod-7", name: "Bremelanotide", sku: "RA-BRMEL", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-8", { id: "prod-8", name: "CBD (Delta 9 Gummy Pre-mix)", sku: "RA-CBDGM", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-9", { id: "prod-9", name: "CBD Broad Spectrum", sku: "RA-CBDBS", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-10", { id: "prod-10", name: "CBD Distillate", sku: "RA-CBDDT", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-11", { id: "prod-11", name: "CBD Isolate", sku: "RA-CBDIS", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-12", { id: "prod-12", name: "CBDa Isolate", sku: "RA-CBDAI", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-13", { id: "prod-13", name: "CBG Distillate", sku: "RA-CBGDT", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-14", { id: "prod-14", name: "CBG Isolate", sku: "RA-CBGIS", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-15", { id: "prod-15", name: "CBN Isolate", sku: "RA-CBNIS", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-16", { id: "prod-16", name: "CJC-1295", sku: "RA-CJC12", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-17", { id: "prod-17", name: "Cornstarch", sku: "RA-CRNST", category: "SUPPORTING_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-18", { id: "prod-18", name: "DSIP", sku: "RA-DSIPM", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-19", { id: "prod-19", name: "Deazaflavin", sku: "RA-DEAZF", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-20", { id: "prod-20", name: "Dihydroberberine", sku: "RA-DHBER", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-21", { id: "prod-21", name: "Dipeptide Diaminobutyroyl Benzylamide Diacetate", sku: "RA-DDABD", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-22", { id: "prod-22", name: "Dynorphin A", sku: "RA-DYNOA", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-23", { id: "prod-23", name: "Epitalon", sku: "RA-EPITL", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-24", { id: "prod-24", name: "Firmapress", sku: "RA-FIRMP", category: "SUPPORTING_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-25", { id: "prod-25", name: "GHK-Cu", sku: "RA-GHKCU", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-26", { id: "prod-26", name: "Ginkgo Biloba Extract", sku: "RA-GINKB", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-27", { id: "prod-27", name: "Green Tea Extract EGCG", sku: "RA-EGCGT", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-28", { id: "prod-28", name: "Hypocretin-2", sku: "RA-HYPO2", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-29", { id: "prod-29", name: "Inulin", sku: "RA-INULN", category: "SUPPORTING_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-30", { id: "prod-30", name: "Ipamorelin", sku: "RA-IPAMR", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-31", { id: "prod-31", name: "Kisspeptin", sku: "RA-KISSP", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-32", { id: "prod-32", name: "L-Ergothioneine", sku: "RA-LERGO", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-33", { id: "prod-33", name: "Liposomal Luteolin 50%", sku: "RA-LLUT5", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-34", { id: "prod-34", name: "Liposomal NMN 50%", sku: "RA-LNMN5", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-35", { id: "prod-35", name: "Liposomal NR", sku: "RA-LIPNR", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-36", { id: "prod-36", name: "Liposomal Spermidine 70%", sku: "RA-LSPD7", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-37", { id: "prod-37", name: "Liposomal Vitamin C", sku: "RA-LVITC", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-38", { id: "prod-38", name: "Luteolin", sku: "RA-LUTEO", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-39", { id: "prod-39", name: "MK-677 (Itamorelin)", sku: "RA-MK677", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-40", { id: "prod-40", name: "MOTS-C", sku: "RA-MOTSC", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-41", { id: "prod-41", name: "Melanotan II", sku: "RA-MELT2", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-42", { id: "prod-42", name: "NAD", sku: "RA-NADPL", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-43", { id: "prod-43", name: "NAD IV grade", sku: "RA-NADIV", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-44", { id: "prod-44", name: "NMN", sku: "RA-NMNPL", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-45", { id: "prod-45", name: "NMN (EXP)", sku: "RA-NMNEX", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-46", { id: "prod-46", name: "NMN IV grade", sku: "RA-NMNIV", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-47", { id: "prod-47", name: "NR", sku: "RA-NRPLN", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-48", { id: "prod-48", name: "NR (EXP)", sku: "RA-NREXP", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-49", { id: "prod-49", name: "Nattokinase", sku: "RA-NATTO", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-50", { id: "prod-50", name: "Oxytocin", sku: "RA-OXYTO", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-51", { id: "prod-51", name: "PEA", sku: "RA-PEAPL", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-52", { id: "prod-52", name: "PEA (Ultra-micronized)", sku: "RA-PEAUM", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-53", { id: "prod-53", name: "PQQ", sku: "RA-PQQPL", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-54", { id: "prod-54", name: "Phosphatidylserine 20%", sku: "RA-PS20P", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-55", { id: "prod-55", name: "Resveratrol", sku: "RA-RESVR", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-56", { id: "prod-56", name: "SS-31", sku: "RA-SS31P", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-57", { id: "prod-57", name: "Sea Kelp Extract (10:1)", sku: "RA-SKELP", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-58", { id: "prod-58", name: "Seamoss/Carrageenan Extract", sku: "RA-SMOSS", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-59", { id: "prod-59", name: "Selank", sku: "RA-SELNK", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-60", { id: "prod-60", name: "Semaglutide", sku: "RA-SEMAG", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-61", { id: "prod-61", name: "Semax", sku: "RA-SEMAX", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-62", { id: "prod-62", name: "Soursop/Cherimoya Extract", sku: "RA-SRCHM", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-63", { id: "prod-63", name: "Spermidine", sku: "RA-SPDNE", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-64", { id: "prod-64", name: "Spermidine 3HCl", sku: "RA-SPD3H", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-65", { id: "prod-65", name: "TB-500", sku: "RA-TB500", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-66", { id: "prod-66", name: "Tesamorelin", sku: "RA-TESAM", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-67", { id: "prod-67", name: "Thymalin", sku: "RA-THYML", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-68", { id: "prod-68", name: "Tirzepatide", sku: "RA-TIRZP", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-69", { id: "prod-69", name: "Urolithin A", sku: "RA-UROLA", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    // ─── Finished Goods (85 Neurogan Health products) ───
    this.products.set("prod-70", { id: "prod-70", name: "AHK-Cu Hair Elixir Expert 4800mg", sku: "US-ACN01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-71", { id: "prod-71", name: "AHK-CU + GHK-CU Hair Serum Pro", sku: "US-AGN01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-72", { id: "prod-72", name: "AHK-CU + GHK-CU Hair Serum Pro", sku: "US-AGN02", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-73", { id: "prod-73", name: "Akkermansia Capsules 30B CFU (150mg AKK + 100mg EGCC + 150mg NMN + 100mg Berberine + 50mg Trans-Resveratrol + 20mg Inulin each), 60ct.", sku: "US-AKC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-74", { id: "prod-74", name: "Akkermansia Probiotic Powder 2B CFU AKK + 250mg Inulin", sku: "US-AKP01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-75", { id: "prod-75", name: "Apigenin Capsules", sku: "US-APG10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-76", { id: "prod-76", name: "Berberine Capsules", sku: "US-BBC10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-77", { id: "prod-77", name: "BPC-157 Tablets 1,000mg total, 60ct.", sku: "US-BPT10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-78", { id: "prod-78", name: "BPC-157 Tablets 1,000mg total, 90ct.", sku: "US-BPT20", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-79", { id: "prod-79", name: "BPC-157 Tablets 500mg total, 60ct.", sku: "US-BPT50", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-80", { id: "prod-80", name: "BPC-157 Tablets 500mg total, 90ct.", sku: "US-BPT60", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-81", { id: "prod-81", name: "Face Age Upgrade Kit (Fisetin Capsules + GHK-Cu Tablets + GHK-Cu Face Cream 1,200mg + Liposomal NMN Drops + Spermidine Tablets)", sku: "US-BSB01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-82", { id: "prod-82", name: "CoEnzyme Q10 Capsules (CoQ10)", sku: "US-CEQ01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-83", { id: "prod-83", name: "Advanced GHK-Cu Neck & Face Serum", sku: "US-CPD01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-84", { id: "prod-84", name: "GHK-Cu Copper Peptide Eye Serum", sku: "US-CPG04", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-85", { id: "prod-85", name: "GHK-Cu Copper Peptide Tablets", sku: "US-CPG05", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-86", { id: "prod-86", name: "GHK-Cu Copper Peptide Face Cream", sku: "US-CPG09", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-87", { id: "prod-87", name: "GHK-Cu Copper Peptide Neck & Face Serum (MCG)", sku: "US-CPG12", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-88", { id: "prod-88", name: "Advanced GHK-Cu Copper Peptide Face Cream 2400mg", sku: "US-CPG25", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-89", { id: "prod-89", name: "Advanced GHK-Cu Copper Peptide Face Cream 2400mg", sku: "US-CPG28", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-90", { id: "prod-90", name: "GHK-Cu Copper Peptide Hair & Scalp Serum", sku: "US-CPH01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-91", { id: "prod-91", name: "GHK-Cu Copper Peptide Hair & Scalp Serum", sku: "US-CPH03", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-92", { id: "prod-92", name: "Dihydroberberine Capsules 15,000mg total, 60ct.", sku: "US-DHB01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-93", { id: "prod-93", name: "Dihydromyricetin Capsules (DHM)", sku: "US-DHM01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-94", { id: "prod-94", name: "Deazaflavin Capsules", sku: "US-DZC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-95", { id: "prod-95", name: "Ecdysterone Supplement", sku: "US-ECC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-96", { id: "prod-96", name: "Epicatechin Capsules", sku: "US-ET207", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-97", { id: "prod-97", name: "Fisetin Capsules", sku: "US-FTC10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-98", { id: "prod-98", name: "Fenugreek Seed Capsules", sku: "US-FTT01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-99", { id: "prod-99", name: "Ginkgo Biloba Capsules", sku: "US-GBC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-100", { id: "prod-100", name: "GHK-Cu Nasal Spray 50mg total, 10ml", sku: "US-GHN50", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-101", { id: "prod-101", name: "Glutathione Capsules 51,600mg total, 120ct.", sku: "US-GLL01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-102", { id: "prod-102", name: "Himalayan Tartary Buckwheat (HTB) Capsules", sku: "US-HTB01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-103", { id: "prod-103", name: "Liposomal NAD+ Capsules 500mg each  60ct.", sku: "US-LDC10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-104", { id: "prod-104", name: "Liposomal Fisetin Capsules", sku: "US-LF101", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-105", { id: "prod-105", name: "Liposomal Luteolin Tablets 20mg each 60ct.", sku: "US-LLC10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-106", { id: "prod-106", name: "Liposomal NMN Capsules 700mg each 60ct.", sku: "US-LMC10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-107", { id: "prod-107", name: "L-Ergothioneine Tablets", sku: "US-LR100", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-108", { id: "prod-108", name: "L-Ergothioneine Drops", sku: "US-LR102", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-109", { id: "prod-109", name: "Liposomal Spermidine Capsules 20mg each 60ct.", sku: "US-LS101", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-110", { id: "prod-110", name: "Liposomal Urolithin A Capsules", sku: "US-LU101", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-111", { id: "prod-111", name: "Luteolin Tablets", sku: "US-LUT01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-112", { id: "prod-112", name: "Liposomal Vit C Capsules 500mg each 60ct.", sku: "US-LVC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-113", { id: "prod-113", name: "Maca Root Capsules", sku: "US-MRC12", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-114", { id: "prod-114", name: "NAD+ Capsules", sku: "US-NDC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-115", { id: "prod-115", name: "NAD+ Capsules 30,000mg total, 60ct.", sku: "US-NDC50", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-116", { id: "prod-116", name: "NADH Tablets", sku: "US-NDH01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-117", { id: "prod-117", name: "Liposomal NAD+ Liquid Drops", sku: "US-NDL10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-118", { id: "prod-118", name: "NAD Nasal Spray", sku: "US-NDN01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-119", { id: "prod-119", name: "NAD + Resveratrol Capsules", sku: "US-NDR01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-120", { id: "prod-120", name: "Nattokinase Capsules", sku: "US-NKC10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-121", { id: "prod-121", name: "NMN Gummies 200mg", sku: "US-NM109", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-122", { id: "prod-122", name: "NMN Tablets", sku: "US-NM111", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-123", { id: "prod-123", name: "NMN Capsules 500MG", sku: "US-NMC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-124", { id: "prod-124", name: "NMN Gummies 12,000mg total, 60ct.", sku: "US-NMG10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-125", { id: "prod-125", name: "Liposomal NMN Drops", sku: "US-NML10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-126", { id: "prod-126", name: "NMN Capsules", sku: "US-NMN90", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-127", { id: "prod-127", name: "NMN Capsules", sku: "US-NMN91", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-128", { id: "prod-128", name: "NMN Powder", sku: "US-NMP01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-129", { id: "prod-129", name: "NMN + Resveratrol Capsules", sku: "US-NMR01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-130", { id: "prod-130", name: "NMN + Resveratrol Capsules", sku: "US-NMR20", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-131", { id: "prod-131", name: "Liposomal Nicotinamide Riboside Drops", sku: "US-NRL10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-132", { id: "prod-132", name: "Nicotinamide Riboside Capsules (NR Pro)", sku: "US-NRP07", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-133", { id: "prod-133", name: "Nicotinamide Riboside Capsules (NR Pro)", sku: "US-NRP10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-134", { id: "prod-134", name: "Pentadecanoic Acid Capsules 9,000mg total, 90ct.", sku: "US-PAC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-135", { id: "prod-135", name: "Phosphatidylserine Capsules 15,000mg total, 60ct.", sku: "US-PHC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-136", { id: "prod-136", name: "PEA Pro Capsules", sku: "US-PL103", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-137", { id: "prod-137", name: "Pomegranate Extract 60,000mg total, 120ct.", sku: "US-POM01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-138", { id: "prod-138", name: "Pregnenolone Tablets", sku: "US-PRG01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-139", { id: "prod-139", name: "Himalayan Shilajit Capsules", sku: "US-SHP01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-140", { id: "prod-140", name: "Fulvic Acid Capsules", sku: "US-SHP02", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-141", { id: "prod-141", name: "Fulvic Acid Drops", sku: "US-SHP03", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-142", { id: "prod-142", name: "Sea Moss Capsules", sku: "US-SMC20", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-143", { id: "prod-143", name: "Spermidine Tablets", sku: "US-SMD10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-144", { id: "prod-144", name: "Spermidine Drops", sku: "US-SMD13", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-145", { id: "prod-145", name: "Spermidine Gummies", sku: "US-SMD14", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-146", { id: "prod-146", name: "Taurine Capsules", sku: "US-TC102", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-147", { id: "prod-147", name: "Resveratrol Capsules", sku: "US-TRC63", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-148", { id: "prod-148", name: "Trigonelline Supplement", sku: "US-TRT10", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-149", { id: "prod-149", name: "Urolithin A Capsules", sku: "US-UAC01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-150", { id: "prod-150", name: "Urolithin A Pro Capsules", sku: "US-UAC02", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-151", { id: "prod-151", name: "Urolithin A Pro Capsules", sku: "US-UAC03", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-152", { id: "prod-152", name: "Urolithin A Gummies", sku: "US-UAG01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-153", { id: "prod-153", name: "Urolithin A Powder", sku: "US-UAP01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-154", { id: "prod-154", name: "Diamond Blue Face Cream", sku: "US-UAT01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    // ─── Lots (96 lots from spreadsheet) ───
    this.lots.set("lot-1", { id: "lot-1", productId: "prod-4", lotNumber: "20250620", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-2", { id: "lot-2", productId: "prod-1", lotNumber: "N/A", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-3", { id: "lot-3", productId: "prod-2", lotNumber: "AKK-20241104", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-4", { id: "lot-4", productId: "prod-3", lotNumber: "SW20251022", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-5", { id: "lot-5", productId: "prod-6", lotNumber: "B250705", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-6", { id: "lot-6", productId: "prod-5", lotNumber: "SW20251113", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-7", { id: "lot-7", productId: "prod-5", lotNumber: "251001", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-8", { id: "lot-8", productId: "prod-5", lotNumber: "BPC221101", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-9", { id: "lot-9", productId: "prod-7", lotNumber: "BRE241101", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-10", { id: "lot-10", productId: "prod-8", lotNumber: "Batch 101", supplierName: "Resonate Foods Batch 105", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-11", { id: "lot-11", productId: "prod-9", lotNumber: "Batch 47", supplierName: "Made by Neurogan", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-12", { id: "lot-12", productId: "prod-10", lotNumber: "Batch 106", supplierName: "GVB Biopharma", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-13", { id: "lot-13", productId: "prod-10", lotNumber: "Batch 106-1 Barrel 1", supplierName: "GVB Biopharma", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-14", { id: "lot-14", productId: "prod-10", lotNumber: "Batch 97-1 Barrel 2", supplierName: "GVB Biopharma", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-15", { id: "lot-15", productId: "prod-11", lotNumber: "Batch 103", supplierName: "Resonate Foods", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-16", { id: "lot-16", productId: "prod-11", lotNumber: "Batch 107", supplierName: null, receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-17", { id: "lot-17", productId: "prod-12", lotNumber: "Batch 5", supplierName: "GenCanna", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-18", { id: "lot-18", productId: "prod-13", lotNumber: "Batch 11-1 Bucket 2", supplierName: "Resonate Foods", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-19", { id: "lot-19", productId: "prod-13", lotNumber: "Batch 11", supplierName: "FloraWorks", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-20", { id: "lot-20", productId: "prod-14", lotNumber: "Batch 14", supplierName: "Resonate Foods", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-21", { id: "lot-21", productId: "prod-14", lotNumber: "Batch 15", supplierName: "GVB Biopharma", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-22", { id: "lot-22", productId: "prod-15", lotNumber: "Batch 21", supplierName: "Rex LLC", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-23", { id: "lot-23", productId: "prod-16", lotNumber: "251001", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-24", { id: "lot-24", productId: "prod-17", lotNumber: "YMDF240301", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-25", { id: "lot-25", productId: "prod-19", lotNumber: "TDHS251201", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-26", { id: "lot-26", productId: "prod-20", lotNumber: "20250801", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-27", { id: "lot-27", productId: "prod-21", lotNumber: "20251118", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-28", { id: "lot-28", productId: "prod-18", lotNumber: "251001", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-29", { id: "lot-29", productId: "prod-22", lotNumber: "20251115", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-30", { id: "lot-30", productId: "prod-23", lotNumber: "250803", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-31", { id: "lot-31", productId: "prod-23", lotNumber: "250402", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-32", { id: "lot-32", productId: "prod-23", lotNumber: "220601", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-33", { id: "lot-33", productId: "prod-24", lotNumber: "FIRWH-1208-2501", supplierName: "LFA Machines", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-34", { id: "lot-34", productId: "prod-24", lotNumber: "FIRWH-0209-25A0", supplierName: "LFA Machines", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-35", { id: "lot-35", productId: "prod-24", lotNumber: "Press82525", supplierName: "LFA Machines", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-36", { id: "lot-36", productId: "prod-24", lotNumber: "FIRWH-0402-2654", supplierName: "LFA Machines", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-37", { id: "lot-37", productId: "prod-24", lotNumber: "N/A", supplierName: "LFA Machines", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-38", { id: "lot-38", productId: "prod-25", lotNumber: "20251002", supplierName: "Hope Pharmatech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-39", { id: "lot-39", productId: "prod-25", lotNumber: "GHK251218", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-40", { id: "lot-40", productId: "prod-25", lotNumber: "GHK260113", supplierName: null, receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-41", { id: "lot-41", productId: "prod-25", lotNumber: "N/A", supplierName: null, receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-42", { id: "lot-42", productId: "prod-26", lotNumber: "N/A", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-43", { id: "lot-43", productId: "prod-27", lotNumber: "N/A", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-44", { id: "lot-44", productId: "prod-28", lotNumber: "SW20251101", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-45", { id: "lot-45", productId: "prod-29", lotNumber: "U-F-JF20250630", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-46", { id: "lot-46", productId: "prod-30", lotNumber: "250201", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-47", { id: "lot-47", productId: "prod-31", lotNumber: "250201", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-48", { id: "lot-48", productId: "prod-32", lotNumber: "20250714-NB", supplierName: null, receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-49", { id: "lot-49", productId: "prod-33", lotNumber: "ZZT-251122", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-50", { id: "lot-50", productId: "prod-34", lotNumber: "LNMN-N-251204", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-51", { id: "lot-51", productId: "prod-35", lotNumber: "N/A", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-52", { id: "lot-52", productId: "prod-36", lotNumber: "ZZT-251118", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-53", { id: "lot-53", productId: "prod-37", lotNumber: "20250927-N", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-54", { id: "lot-54", productId: "prod-38", lotNumber: "B11241108", supplierName: "Bonerge", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-55", { id: "lot-55", productId: "prod-41", lotNumber: "MLNT241101", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-56", { id: "lot-56", productId: "prod-39", lotNumber: "20251204", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-57", { id: "lot-57", productId: "prod-40", lotNumber: "SW20251020", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-58", { id: "lot-58", productId: "prod-42", lotNumber: "20250807", supplierName: null, receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-59", { id: "lot-59", productId: "prod-42", lotNumber: "20250702", supplierName: null, receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-60", { id: "lot-60", productId: "prod-42", lotNumber: "251002", supplierName: null, receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-61", { id: "lot-61", productId: "prod-42", lotNumber: "BT01N325H150", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-62", { id: "lot-62", productId: "prod-42", lotNumber: "N/A", supplierName: null, receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-63", { id: "lot-63", productId: "prod-43", lotNumber: "BT01N325H150", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-64", { id: "lot-64", productId: "prod-49", lotNumber: "N/A", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-65", { id: "lot-65", productId: "prod-44", lotNumber: "B03250708SP-N", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-66", { id: "lot-66", productId: "prod-44", lotNumber: "B03250709SP-N", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-67", { id: "lot-67", productId: "prod-44", lotNumber: "20250701-H", supplierName: "Hope Pharmatech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-68", { id: "lot-68", productId: "prod-44", lotNumber: "20251009-H", supplierName: "Hope Pharmatech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-69", { id: "lot-69", productId: "prod-46", lotNumber: "BT05M125J072", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-70", { id: "lot-70", productId: "prod-47", lotNumber: "20250902-H", supplierName: "Hope Pharmatech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-71", { id: "lot-71", productId: "prod-47", lotNumber: "210707", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-72", { id: "lot-72", productId: "prod-50", lotNumber: "OXY241201", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-73", { id: "lot-73", productId: "prod-51", lotNumber: "PEA241004", supplierName: "Hope Pharmatech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-74", { id: "lot-74", productId: "prod-51", lotNumber: "PEA231215", supplierName: "Hope Pharmatech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-75", { id: "lot-75", productId: "prod-52", lotNumber: "MPEA230604", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-76", { id: "lot-76", productId: "prod-54", lotNumber: "WG20241120-N", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-77", { id: "lot-77", productId: "prod-53", lotNumber: "20250615-N", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-78", { id: "lot-78", productId: "prod-55", lotNumber: "RES01-25021201", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-79", { id: "lot-79", productId: "prod-57", lotNumber: "YZHZ240801", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-80", { id: "lot-80", productId: "prod-58", lotNumber: "N/A", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-81", { id: "lot-81", productId: "prod-59", lotNumber: "250801", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-82", { id: "lot-82", productId: "prod-60", lotNumber: "SM-20251020", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-83", { id: "lot-83", productId: "prod-61", lotNumber: "251001", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-84", { id: "lot-84", productId: "prod-62", lotNumber: "N/A", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-85", { id: "lot-85", productId: "prod-63", lotNumber: "N/A", supplierName: null, receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-86", { id: "lot-86", productId: "prod-64", lotNumber: "20250429", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-87", { id: "lot-87", productId: "prod-56", lotNumber: "SW20251201", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-88", { id: "lot-88", productId: "prod-65", lotNumber: "250201", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-89", { id: "lot-89", productId: "prod-66", lotNumber: "SW20251017", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-90", { id: "lot-90", productId: "prod-67", lotNumber: "SW20251110", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-91", { id: "lot-91", productId: "prod-68", lotNumber: "TR202509101", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-92", { id: "lot-92", productId: "prod-69", lotNumber: "ULA251101", supplierName: "Hope Pharmatech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-93", { id: "lot-93", productId: "prod-69", lotNumber: "ULAG251201", supplierName: "Effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-94", { id: "lot-94", productId: "prod-69", lotNumber: "20260112", supplierName: "Nutrition Biotech", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-95", { id: "lot-95", productId: "prod-45", lotNumber: "NMNH240302", supplierName: "effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });
    this.lots.set("lot-96", { id: "lot-96", productId: "prod-48", lotNumber: "NR230901", supplierName: "effepharm", receivedDate: null, expirationDate: null, supplierCoaUrl: null, neuroganCoaUrl: null, purchasePrice: null, purchaseUom: null, poReference: null, notes: null, createdAt: now });

    // ─── Transactions (117 from Feb-2026 inventory snapshot) ───
    this.transactions.set("tx-1", { id: "tx-1", lotId: "lot-1", locationId: "loc-5", type: "PO_RECEIPT", quantity: "14.9", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-2", { id: "tx-2", lotId: "lot-2", locationId: "loc-5", type: "PO_RECEIPT", quantity: "500", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-3", { id: "tx-3", lotId: "lot-2", locationId: "loc-5", type: "PRODUCTION_CONSUMPTION", quantity: "-727", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-4", { id: "tx-4", lotId: "lot-3", locationId: "loc-1", type: "PO_RECEIPT", quantity: "5000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-5", { id: "tx-5", lotId: "lot-4", locationId: "loc-6", type: "PO_RECEIPT", quantity: "5", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-6", { id: "tx-6", lotId: "lot-5", locationId: "loc-1", type: "PO_RECEIPT", quantity: "200000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-7", { id: "tx-7", lotId: "lot-6", locationId: "loc-5", type: "PO_RECEIPT", quantity: "250", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-8", { id: "tx-8", lotId: "lot-7", locationId: "loc-6", type: "PO_RECEIPT", quantity: "50", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-9", { id: "tx-9", lotId: "lot-8", locationId: "loc-6", type: "PO_RECEIPT", quantity: "9.4", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-10", { id: "tx-10", lotId: "lot-9", locationId: "loc-6", type: "PO_RECEIPT", quantity: "14", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-11", { id: "tx-11", lotId: "lot-10", locationId: "loc-1", type: "PO_RECEIPT", quantity: "370", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-12", { id: "tx-12", lotId: "lot-11", locationId: "loc-1", type: "PO_RECEIPT", quantity: "24", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-13", { id: "tx-13", lotId: "lot-12", locationId: "loc-1", type: "PO_RECEIPT", quantity: "3700", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-14", { id: "tx-14", lotId: "lot-12", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-1094", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-15", { id: "tx-15", lotId: "lot-13", locationId: "loc-1", type: "PO_RECEIPT", quantity: "33200", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-16", { id: "tx-16", lotId: "lot-13", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-1560", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-17", { id: "tx-17", lotId: "lot-14", locationId: "loc-1", type: "PO_RECEIPT", quantity: "6150", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-18", { id: "tx-18", lotId: "lot-15", locationId: "loc-1", type: "PO_RECEIPT", quantity: "17600", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-19", { id: "tx-19", lotId: "lot-16", locationId: "loc-1", type: "PO_RECEIPT", quantity: "200000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-20", { id: "tx-20", lotId: "lot-17", locationId: "loc-1", type: "PO_RECEIPT", quantity: "600", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-21", { id: "tx-21", lotId: "lot-18", locationId: "loc-1", type: "PO_RECEIPT", quantity: "750", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-22", { id: "tx-22", lotId: "lot-19", locationId: "loc-1", type: "PO_RECEIPT", quantity: "55.38", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-23", { id: "tx-23", lotId: "lot-21", locationId: "loc-1", type: "PO_RECEIPT", quantity: "8350", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-24", { id: "tx-24", lotId: "lot-22", locationId: "loc-1", type: "PO_RECEIPT", quantity: "7750", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-25", { id: "tx-25", lotId: "lot-23", locationId: "loc-6", type: "PO_RECEIPT", quantity: "10", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-26", { id: "tx-26", lotId: "lot-24", locationId: "loc-3", type: "PO_RECEIPT", quantity: "4700", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-27", { id: "tx-27", lotId: "lot-25", locationId: "loc-1", type: "PO_RECEIPT", quantity: "5000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-28", { id: "tx-28", lotId: "lot-26", locationId: "loc-1", type: "PO_RECEIPT", quantity: "50000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-29", { id: "tx-29", lotId: "lot-27", locationId: "loc-6", type: "PO_RECEIPT", quantity: "10", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-30", { id: "tx-30", lotId: "lot-28", locationId: "loc-6", type: "PO_RECEIPT", quantity: "30", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-31", { id: "tx-31", lotId: "lot-29", locationId: "loc-6", type: "PO_RECEIPT", quantity: "10", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-32", { id: "tx-32", lotId: "lot-30", locationId: "loc-4", type: "PO_RECEIPT", quantity: "5", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-33", { id: "tx-33", lotId: "lot-31", locationId: "loc-6", type: "PO_RECEIPT", quantity: "67.21", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-34", { id: "tx-34", lotId: "lot-32", locationId: "loc-6", type: "PO_RECEIPT", quantity: "4.43", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-35", { id: "tx-35", lotId: "lot-33", locationId: "loc-1", type: "PO_RECEIPT", quantity: "25000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-36", { id: "tx-36", lotId: "lot-34", locationId: "loc-1", type: "PO_RECEIPT", quantity: "178500", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-37", { id: "tx-37", lotId: "lot-35", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-62550", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-38", { id: "tx-38", lotId: "lot-36", locationId: "loc-1", type: "PO_RECEIPT", quantity: "400000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-39", { id: "tx-39", lotId: "lot-37", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-28000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-40", { id: "tx-40", lotId: "lot-37", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-49500", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-41", { id: "tx-41", lotId: "lot-38", locationId: "loc-4", type: "PO_RECEIPT", quantity: "12400", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-42", { id: "tx-42", lotId: "lot-38", locationId: "loc-4", type: "PRODUCTION_CONSUMPTION", quantity: "-7500", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-43", { id: "tx-43", lotId: "lot-39", locationId: "loc-5", type: "PO_RECEIPT", quantity: "4000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-44", { id: "tx-44", lotId: "lot-39", locationId: "loc-5", type: "PRODUCTION_CONSUMPTION", quantity: "-2500", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-45", { id: "tx-45", lotId: "lot-39", locationId: "loc-5", type: "PRODUCTION_CONSUMPTION", quantity: "-600", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-46", { id: "tx-46", lotId: "lot-40", locationId: "loc-5", type: "PO_RECEIPT", quantity: "2570", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-47", { id: "tx-47", lotId: "lot-41", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-765", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-48", { id: "tx-48", lotId: "lot-38", locationId: "loc-4", type: "PO_RECEIPT", quantity: "12.5", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-49", { id: "tx-49", lotId: "lot-38", locationId: "loc-4", type: "PRODUCTION_CONSUMPTION", quantity: "-517", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-50", { id: "tx-50", lotId: "lot-38", locationId: "loc-4", type: "PRODUCTION_CONSUMPTION", quantity: "-1900", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-51", { id: "tx-51", lotId: "lot-41", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-50", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-52", { id: "tx-52", lotId: "lot-41", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-597", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-53", { id: "tx-53", lotId: "lot-41", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-7600", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-54", { id: "tx-54", lotId: "lot-41", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-7600", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-55", { id: "tx-55", lotId: "lot-42", locationId: "loc-2", type: "PO_RECEIPT", quantity: "14960", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-56", { id: "tx-56", lotId: "lot-43", locationId: "loc-2", type: "PO_RECEIPT", quantity: "10000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-57", { id: "tx-57", lotId: "lot-44", locationId: "loc-6", type: "PO_RECEIPT", quantity: "10", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-58", { id: "tx-58", lotId: "lot-45", locationId: "loc-2", type: "PO_RECEIPT", quantity: "100000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-59", { id: "tx-59", lotId: "lot-46", locationId: "loc-6", type: "PO_RECEIPT", quantity: "23.47", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-60", { id: "tx-60", lotId: "lot-47", locationId: "loc-6", type: "PO_RECEIPT", quantity: "24", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-61", { id: "tx-61", lotId: "lot-48", locationId: "loc-5", type: "PO_RECEIPT", quantity: "1760", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-62", { id: "tx-62", lotId: "lot-49", locationId: "loc-2", type: "PO_RECEIPT", quantity: "5000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-63", { id: "tx-63", lotId: "lot-50", locationId: "loc-1", type: "PO_RECEIPT", quantity: "3750", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-64", { id: "tx-64", lotId: "lot-51", locationId: "loc-1", type: "PO_RECEIPT", quantity: "900", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-65", { id: "tx-65", lotId: "lot-52", locationId: "loc-1", type: "PO_RECEIPT", quantity: "5000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-66", { id: "tx-66", lotId: "lot-53", locationId: "loc-2", type: "PO_RECEIPT", quantity: "80000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-67", { id: "tx-67", lotId: "lot-54", locationId: "loc-2", type: "PO_RECEIPT", quantity: "20000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-68", { id: "tx-68", lotId: "lot-55", locationId: "loc-6", type: "PO_RECEIPT", quantity: "10", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-69", { id: "tx-69", lotId: "lot-56", locationId: "loc-6", type: "PO_RECEIPT", quantity: "10.14", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-70", { id: "tx-70", lotId: "lot-57", locationId: "loc-6", type: "PO_RECEIPT", quantity: "10", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-71", { id: "tx-71", lotId: "lot-58", locationId: "loc-3", type: "PO_RECEIPT", quantity: "75000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-72", { id: "tx-72", lotId: "lot-59", locationId: "loc-3", type: "PO_RECEIPT", quantity: "35000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-73", { id: "tx-73", lotId: "lot-60", locationId: "loc-3", type: "PO_RECEIPT", quantity: "8150", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-74", { id: "tx-74", lotId: "lot-61", locationId: "loc-4", type: "PO_RECEIPT", quantity: "1000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-75", { id: "tx-75", lotId: "lot-62", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-7400", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-76", { id: "tx-76", lotId: "lot-62", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-50000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-77", { id: "tx-77", lotId: "lot-63", locationId: "loc-1", type: "PO_RECEIPT", quantity: "1000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-78", { id: "tx-78", lotId: "lot-64", locationId: "loc-2", type: "PO_RECEIPT", quantity: "15800", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-79", { id: "tx-79", lotId: "lot-64", locationId: "loc-2", type: "PRODUCTION_CONSUMPTION", quantity: "-4000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-80", { id: "tx-80", lotId: "lot-65", locationId: "loc-3", type: "PO_RECEIPT", quantity: "75000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-81", { id: "tx-81", lotId: "lot-66", locationId: "loc-3", type: "PO_RECEIPT", quantity: "120000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-82", { id: "tx-82", lotId: "lot-67", locationId: "loc-1", type: "PO_RECEIPT", quantity: "36250", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-83", { id: "tx-83", lotId: "lot-68", locationId: "loc-1", type: "PO_RECEIPT", quantity: "200000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-84", { id: "tx-84", lotId: "lot-69", locationId: "loc-4", type: "PO_RECEIPT", quantity: "1000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-85", { id: "tx-85", lotId: "lot-70", locationId: "loc-1", type: "PO_RECEIPT", quantity: "50000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-86", { id: "tx-86", lotId: "lot-71", locationId: "loc-6", type: "PO_RECEIPT", quantity: "100.83", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-87", { id: "tx-87", lotId: "lot-72", locationId: "loc-6", type: "PO_RECEIPT", quantity: "50", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-88", { id: "tx-88", lotId: "lot-73", locationId: "loc-1", type: "PO_RECEIPT", quantity: "6700", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-89", { id: "tx-89", lotId: "lot-74", locationId: "loc-1", type: "PO_RECEIPT", quantity: "25000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-90", { id: "tx-90", lotId: "lot-74", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-25000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-91", { id: "tx-91", lotId: "lot-75", locationId: "loc-1", type: "PO_RECEIPT", quantity: "3700", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-92", { id: "tx-92", lotId: "lot-76", locationId: "loc-2", type: "PO_RECEIPT", quantity: "20000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-93", { id: "tx-93", lotId: "lot-77", locationId: "loc-5", type: "PO_RECEIPT", quantity: "500", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-94", { id: "tx-94", lotId: "lot-78", locationId: "loc-1", type: "PO_RECEIPT", quantity: "25000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-95", { id: "tx-95", lotId: "lot-78", locationId: "loc-1", type: "PO_RECEIPT", quantity: "100000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-96", { id: "tx-96", lotId: "lot-79", locationId: "loc-2", type: "PO_RECEIPT", quantity: "23700", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-97", { id: "tx-97", lotId: "lot-80", locationId: "loc-1", type: "PO_RECEIPT", quantity: "30000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-98", { id: "tx-98", lotId: "lot-81", locationId: "loc-6", type: "PO_RECEIPT", quantity: "9.87", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-99", { id: "tx-99", lotId: "lot-82", locationId: "loc-6", type: "PO_RECEIPT", quantity: "9.94", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-100", { id: "tx-100", lotId: "lot-83", locationId: "loc-6", type: "PO_RECEIPT", quantity: "10", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-101", { id: "tx-101", lotId: "lot-84", locationId: "loc-1", type: "PO_RECEIPT", quantity: "36000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-102", { id: "tx-102", lotId: "lot-85", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-1270", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-103", { id: "tx-103", lotId: "lot-85", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-1230", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-104", { id: "tx-104", lotId: "lot-86", locationId: "loc-1", type: "PO_RECEIPT", quantity: "10000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-105", { id: "tx-105", lotId: "lot-87", locationId: "loc-6", type: "PO_RECEIPT", quantity: "9.8", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-106", { id: "tx-106", lotId: "lot-88", locationId: "loc-6", type: "PO_RECEIPT", quantity: "21.7", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-107", { id: "tx-107", lotId: "lot-89", locationId: "loc-6", type: "PO_RECEIPT", quantity: "5", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-108", { id: "tx-108", lotId: "lot-90", locationId: "loc-6", type: "PO_RECEIPT", quantity: "10", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-109", { id: "tx-109", lotId: "lot-91", locationId: "loc-4", type: "PO_RECEIPT", quantity: "9.77", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-110", { id: "tx-110", lotId: "lot-92", locationId: "loc-1", type: "PO_RECEIPT", quantity: "10000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-111", { id: "tx-111", lotId: "lot-93", locationId: "loc-1", type: "PO_RECEIPT", quantity: "200000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-112", { id: "tx-112", lotId: "lot-93", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-180000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-113", { id: "tx-113", lotId: "lot-93", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-3000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-114", { id: "tx-114", lotId: "lot-94", locationId: "loc-1", type: "PO_RECEIPT", quantity: "195000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-115", { id: "tx-115", lotId: "lot-94", locationId: "loc-1", type: "PRODUCTION_CONSUMPTION", quantity: "-195000", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - production/adjustment", performedBy: "import", createdAt: now });
    this.transactions.set("tx-116", { id: "tx-116", lotId: "lot-95", locationId: "loc-5", type: "PO_RECEIPT", quantity: "260", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });
    this.transactions.set("tx-117", { id: "tx-117", lotId: "lot-96", locationId: "loc-5", type: "PO_RECEIPT", quantity: "100", uom: "g", productionBatchId: null, notes: "Inventory snapshot import - received stock", performedBy: "import", createdAt: now });

    // ─── New materials from Master Recipes ───
    this.products.set("prod-155", { id: "prod-155", name: "Aroma Land Facial Cream", sku: "RA-ARLFC", category: "SUPPORTING_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-156", { id: "prod-156", name: "Blend Scent #1", sku: "RA-BLSC1", category: "SUPPORTING_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-157", { id: "prod-157", name: "Distillate Water", sku: "RA-DW922", category: "SUPPORTING_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-158", { id: "prod-158", name: "Epicatechin", sku: "RA-EPICT", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-159", { id: "prod-159", name: "Epigallocatechin", sku: "RA-EPIGA", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-160", { id: "prod-160", name: "Fisetin", sku: "RA-FISTN", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-161", { id: "prod-161", name: "Capsule Shell 1#", sku: "RA-KG101", category: "SUPPORTING_INGREDIENT", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-162", { id: "prod-162", name: "Capsule Shell 00#", sku: "RA-KG963", category: "SUPPORTING_INGREDIENT", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-163", { id: "prod-163", name: "Kojic Acid & Niacinamide Base", sku: "RA-KOJNB", category: "SUPPORTING_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-164", { id: "prod-164", name: "Gelatin", sku: "RA-S-17034B-W", category: "SUPPORTING_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-165", { id: "prod-165", name: "Strawberry Flavor", sku: "RA-SF904", category: "SUPPORTING_INGREDIENT", defaultUom: "mL", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-166", { id: "prod-166", name: "Stevia", sku: "RA-STEVA", category: "SUPPORTING_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-167", { id: "prod-167", name: "Taurine 99.60%", sku: "RA-TAURN", category: "ACTIVE_INGREDIENT", defaultUom: "g", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-168", { id: "prod-168", name: "Vegetarian Capsule Shell #4", sku: "RA-VCS04", category: "SUPPORTING_INGREDIENT", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-169", { id: "prod-169", name: "Copper Peptide GHK-CU Face Cream 2oz", sku: "US-CPG01", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });
    this.products.set("prod-170", { id: "prod-170", name: "NMN Powder 60000mg 2oz Bag", sku: "US-NMP60", category: "FINISHED_GOOD", defaultUom: "pcs", description: null, status: "ACTIVE", lowStockThreshold: null, createdAt: now, updatedAt: now });

    // ─── Recipes from Master Recipes Calculator ───
    this.recipes.set("recipe-1", { id: "recipe-1", productId: "prod-73", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-2", { id: "recipe-2", productId: "prod-71", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-3", { id: "recipe-3", productId: "prod-83", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-4", { id: "recipe-4", productId: "prod-169", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-5", { id: "recipe-5", productId: "prod-85", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-6", { id: "recipe-6", productId: "prod-87", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-7", { id: "recipe-7", productId: "prod-88", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-8", { id: "recipe-8", productId: "prod-90", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-9", { id: "recipe-9", productId: "prod-100", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-10", { id: "recipe-10", productId: "prod-94", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-11", { id: "recipe-11", productId: "prod-92", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-12", { id: "recipe-12", productId: "prod-96", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-13", { id: "recipe-13", productId: "prod-97", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-14", { id: "recipe-14", productId: "prod-104", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-15", { id: "recipe-15", productId: "prod-105", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-16", { id: "recipe-16", productId: "prod-103", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-17", { id: "recipe-17", productId: "prod-114", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-18", { id: "recipe-18", productId: "prod-117", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-19", { id: "recipe-19", productId: "prod-119", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-20", { id: "recipe-20", productId: "prod-106", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-21", { id: "recipe-21", productId: "prod-123", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-22", { id: "recipe-22", productId: "prod-125", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-23", { id: "recipe-23", productId: "prod-126", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-24", { id: "recipe-24", productId: "prod-128", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-25", { id: "recipe-25", productId: "prod-170", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-26", { id: "recipe-26", productId: "prod-118", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-27", { id: "recipe-27", productId: "prod-136", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-28", { id: "recipe-28", productId: "prod-147", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-29", { id: "recipe-29", productId: "prod-142", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-30", { id: "recipe-30", productId: "prod-109", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-31", { id: "recipe-31", productId: "prod-143", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-32", { id: "recipe-32", productId: "prod-144", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-33", { id: "recipe-33", productId: "prod-146", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-34", { id: "recipe-34", productId: "prod-149", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-35", { id: "recipe-35", productId: "prod-150", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });
    this.recipes.set("recipe-36", { id: "recipe-36", productId: "prod-112", name: "Standard Formula", notes: null, createdAt: now, updatedAt: now });

    // ─── Recipe Lines ───
    this.recipeLines.set("rl-1", { id: "rl-1", recipeId: "recipe-1", productId: "prod-2", quantity: "14.0625", uom: "g", notes: null });
    this.recipeLines.set("rl-2", { id: "rl-2", recipeId: "recipe-1", productId: "prod-44", quantity: "14.0625", uom: "g", notes: null });
    this.recipeLines.set("rl-3", { id: "rl-3", recipeId: "recipe-1", productId: "prod-6", quantity: "9.070312", uom: "g", notes: null });
    this.recipeLines.set("rl-4", { id: "rl-4", recipeId: "recipe-1", productId: "prod-159", quantity: "9.070312", uom: "g", notes: null });
    this.recipeLines.set("rl-5", { id: "rl-5", recipeId: "recipe-1", productId: "prod-55", quantity: "4.535156", uom: "g", notes: null });
    this.recipeLines.set("rl-6", { id: "rl-6", recipeId: "recipe-1", productId: "prod-29", quantity: "1.8", uom: "g", notes: null });
    this.recipeLines.set("rl-7", { id: "rl-7", recipeId: "recipe-1", productId: "prod-162", quantity: "90.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-8", { id: "rl-8", recipeId: "recipe-2", productId: "prod-157", quantity: "55.371901", uom: "g", notes: null });
    this.recipeLines.set("rl-9", { id: "rl-9", recipeId: "recipe-2", productId: "prod-1", quantity: "2.429752", uom: "g", notes: null });
    this.recipeLines.set("rl-10", { id: "rl-10", recipeId: "recipe-2", productId: "prod-25", quantity: "2.479339", uom: "g", notes: null });
    this.recipeLines.set("rl-11", { id: "rl-11", recipeId: "recipe-3", productId: "prod-163", quantity: "26.25", uom: "g", notes: null });
    this.recipeLines.set("rl-12", { id: "rl-12", recipeId: "recipe-3", productId: "prod-157", quantity: "3.0", uom: "g", notes: null });
    this.recipeLines.set("rl-13", { id: "rl-13", recipeId: "recipe-3", productId: "prod-25", quantity: "1.29", uom: "g", notes: null });
    this.recipeLines.set("rl-14", { id: "rl-14", recipeId: "recipe-3", productId: "prod-156", quantity: "0.06", uom: "g", notes: null });
    this.recipeLines.set("rl-15", { id: "rl-15", recipeId: "recipe-4", productId: "prod-155", quantity: "9.6", uom: "g", notes: null });
    this.recipeLines.set("rl-16", { id: "rl-16", recipeId: "recipe-4", productId: "prod-157", quantity: "0.06", uom: "g", notes: null });
    this.recipeLines.set("rl-17", { id: "rl-17", recipeId: "recipe-4", productId: "prod-25", quantity: "0.02", uom: "g", notes: null });
    this.recipeLines.set("rl-18", { id: "rl-18", recipeId: "recipe-5", productId: "prod-25", quantity: "0.1791", uom: "g", notes: null });
    this.recipeLines.set("rl-19", { id: "rl-19", recipeId: "recipe-5", productId: "prod-24", quantity: "14.85", uom: "g", notes: null });
    this.recipeLines.set("rl-20", { id: "rl-20", recipeId: "recipe-6", productId: "prod-163", quantity: "29.0", uom: "g", notes: null });
    this.recipeLines.set("rl-21", { id: "rl-21", recipeId: "recipe-6", productId: "prod-157", quantity: "2.0", uom: "g", notes: null });
    this.recipeLines.set("rl-22", { id: "rl-22", recipeId: "recipe-6", productId: "prod-25", quantity: "0.71", uom: "g", notes: null });
    this.recipeLines.set("rl-23", { id: "rl-23", recipeId: "recipe-6", productId: "prod-156", quantity: "0.05", uom: "g", notes: null });
    this.recipeLines.set("rl-24", { id: "rl-24", recipeId: "recipe-7", productId: "prod-155", quantity: "53.333333", uom: "g", notes: null });
    this.recipeLines.set("rl-25", { id: "rl-25", recipeId: "recipe-7", productId: "prod-157", quantity: "5.833333", uom: "g", notes: null });
    this.recipeLines.set("rl-26", { id: "rl-26", recipeId: "recipe-7", productId: "prod-25", quantity: "2.508333", uom: "g", notes: null });
    this.recipeLines.set("rl-27", { id: "rl-27", recipeId: "recipe-7", productId: "prod-156", quantity: "0.066667", uom: "g", notes: null });
    this.recipeLines.set("rl-28", { id: "rl-28", recipeId: "recipe-8", productId: "prod-157", quantity: "57.466667", uom: "mL", notes: null });
    this.recipeLines.set("rl-29", { id: "rl-29", recipeId: "recipe-8", productId: "prod-25", quantity: "2.533333", uom: "g", notes: null });
    this.recipeLines.set("rl-30", { id: "rl-30", recipeId: "recipe-9", productId: "prod-25", quantity: "0.05625", uom: "g", notes: null });
    this.recipeLines.set("rl-31", { id: "rl-31", recipeId: "recipe-9", productId: "prod-157", quantity: "9.9625", uom: "mL", notes: null });
    this.recipeLines.set("rl-32", { id: "rl-32", recipeId: "recipe-10", productId: "prod-19", quantity: "9.0", uom: "g", notes: null });
    this.recipeLines.set("rl-33", { id: "rl-33", recipeId: "recipe-10", productId: "prod-168", quantity: "150.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-34", { id: "rl-34", recipeId: "recipe-11", productId: "prod-20", quantity: "15.0", uom: "g", notes: null });
    this.recipeLines.set("rl-35", { id: "rl-35", recipeId: "recipe-11", productId: "prod-161", quantity: "60.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-36", { id: "rl-36", recipeId: "recipe-12", productId: "prod-158", quantity: "30.0", uom: "g", notes: null });
    this.recipeLines.set("rl-37", { id: "rl-37", recipeId: "recipe-12", productId: "prod-162", quantity: "60.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-38", { id: "rl-38", recipeId: "recipe-13", productId: "prod-160", quantity: "15.0", uom: "g", notes: null });
    this.recipeLines.set("rl-39", { id: "rl-39", recipeId: "recipe-13", productId: "prod-162", quantity: "30.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-40", { id: "rl-40", recipeId: "recipe-14", productId: "prod-160", quantity: "30.0", uom: "g", notes: null });
    this.recipeLines.set("rl-41", { id: "rl-41", recipeId: "recipe-14", productId: "prod-162", quantity: "60.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-42", { id: "rl-42", recipeId: "recipe-15", productId: "prod-38", quantity: "6.0", uom: "g", notes: null });
    this.recipeLines.set("rl-43", { id: "rl-43", recipeId: "recipe-15", productId: "prod-24", quantity: "18.0", uom: "g", notes: null });
    this.recipeLines.set("rl-44", { id: "rl-44", recipeId: "recipe-16", productId: "prod-42", quantity: "30.0", uom: "g", notes: null });
    this.recipeLines.set("rl-45", { id: "rl-45", recipeId: "recipe-16", productId: "prod-162", quantity: "60.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-46", { id: "rl-46", recipeId: "recipe-17", productId: "prod-42", quantity: "81.325301", uom: "g", notes: null });
    this.recipeLines.set("rl-47", { id: "rl-47", recipeId: "recipe-17", productId: "prod-162", quantity: "90.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-48", { id: "rl-48", recipeId: "recipe-18", productId: "prod-42", quantity: "18.5", uom: "g", notes: null });
    this.recipeLines.set("rl-49", { id: "rl-49", recipeId: "recipe-18", productId: "prod-157", quantity: "36.75", uom: "mL", notes: null });
    this.recipeLines.set("rl-50", { id: "rl-50", recipeId: "recipe-18", productId: "prod-166", quantity: "7.5", uom: "g", notes: null });
    this.recipeLines.set("rl-51", { id: "rl-51", recipeId: "recipe-18", productId: "prod-165", quantity: "4.0", uom: "mL", notes: null });
    this.recipeLines.set("rl-52", { id: "rl-52", recipeId: "recipe-19", productId: "prod-42", quantity: "27.272727", uom: "g", notes: null });
    this.recipeLines.set("rl-53", { id: "rl-53", recipeId: "recipe-19", productId: "prod-55", quantity: "27.272727", uom: "g", notes: null });
    this.recipeLines.set("rl-54", { id: "rl-54", recipeId: "recipe-19", productId: "prod-162", quantity: "90.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-55", { id: "rl-55", recipeId: "recipe-20", productId: "prod-34", quantity: "30.0", uom: "g", notes: null });
    this.recipeLines.set("rl-56", { id: "rl-56", recipeId: "recipe-20", productId: "prod-162", quantity: "60.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-57", { id: "rl-57", recipeId: "recipe-21", productId: "prod-44", quantity: "42.0", uom: "g", notes: null });
    this.recipeLines.set("rl-58", { id: "rl-58", recipeId: "recipe-21", productId: "prod-161", quantity: "120.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-59", { id: "rl-59", recipeId: "recipe-22", productId: "prod-34", quantity: "18.0", uom: "g", notes: null });
    this.recipeLines.set("rl-60", { id: "rl-60", recipeId: "recipe-22", productId: "prod-157", quantity: "32.5", uom: "mL", notes: null });
    this.recipeLines.set("rl-61", { id: "rl-61", recipeId: "recipe-22", productId: "prod-166", quantity: "8.0", uom: "g", notes: null });
    this.recipeLines.set("rl-62", { id: "rl-62", recipeId: "recipe-22", productId: "prod-165", quantity: "4.5", uom: "mL", notes: null });
    this.recipeLines.set("rl-63", { id: "rl-63", recipeId: "recipe-23", productId: "prod-44", quantity: "81.818182", uom: "g", notes: null });
    this.recipeLines.set("rl-64", { id: "rl-64", recipeId: "recipe-23", productId: "prod-162", quantity: "90.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-65", { id: "rl-65", recipeId: "recipe-24", productId: "prod-44", quantity: "30.1", uom: "g", notes: null });
    this.recipeLines.set("rl-66", { id: "rl-66", recipeId: "recipe-25", productId: "prod-44", quantity: "60.2", uom: "g", notes: null });
    this.recipeLines.set("rl-67", { id: "rl-67", recipeId: "recipe-26", productId: "prod-44", quantity: "0.85", uom: "g", notes: null });
    this.recipeLines.set("rl-68", { id: "rl-68", recipeId: "recipe-26", productId: "prod-157", quantity: "9.225", uom: "mL", notes: null });
    this.recipeLines.set("rl-69", { id: "rl-69", recipeId: "recipe-27", productId: "prod-52", quantity: "46.272494", uom: "g", notes: null });
    this.recipeLines.set("rl-70", { id: "rl-70", recipeId: "recipe-27", productId: "prod-162", quantity: "90.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-71", { id: "rl-71", recipeId: "recipe-28", productId: "prod-55", quantity: "63.02521", uom: "g", notes: null });
    this.recipeLines.set("rl-72", { id: "rl-72", recipeId: "recipe-28", productId: "prod-162", quantity: "90.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-73", { id: "rl-73", recipeId: "recipe-29", productId: "prod-58", quantity: "60.0", uom: "g", notes: null });
    this.recipeLines.set("rl-74", { id: "rl-74", recipeId: "recipe-29", productId: "prod-162", quantity: "120.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-75", { id: "rl-75", recipeId: "recipe-30", productId: "prod-64", quantity: "7.247525", uom: "g", notes: null });
    this.recipeLines.set("rl-76", { id: "rl-76", recipeId: "recipe-30", productId: "prod-24", quantity: "7.60396", uom: "g", notes: null });
    this.recipeLines.set("rl-77", { id: "rl-77", recipeId: "recipe-30", productId: "prod-168", quantity: "120.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-78", { id: "rl-78", recipeId: "recipe-31", productId: "prod-64", quantity: "1.47", uom: "g", notes: null });
    this.recipeLines.set("rl-79", { id: "rl-79", recipeId: "recipe-31", productId: "prod-164", quantity: "0.96", uom: "g", notes: null });
    this.recipeLines.set("rl-80", { id: "rl-80", recipeId: "recipe-31", productId: "prod-24", quantity: "33.6", uom: "g", notes: null });
    this.recipeLines.set("rl-81", { id: "rl-81", recipeId: "recipe-32", productId: "prod-64", quantity: "2.485323", uom: "g", notes: null });
    this.recipeLines.set("rl-82", { id: "rl-82", recipeId: "recipe-32", productId: "prod-157", quantity: "47.945205", uom: "mL", notes: null });
    this.recipeLines.set("rl-83", { id: "rl-83", recipeId: "recipe-32", productId: "prod-165", quantity: "3.013699", uom: "mL", notes: null });
    this.recipeLines.set("rl-84", { id: "rl-84", recipeId: "recipe-32", productId: "prod-166", quantity: "7.671233", uom: "g", notes: null });
    this.recipeLines.set("rl-85", { id: "rl-85", recipeId: "recipe-33", productId: "prod-167", quantity: "96.503497", uom: "g", notes: null });
    this.recipeLines.set("rl-86", { id: "rl-86", recipeId: "recipe-33", productId: "prod-162", quantity: "120.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-87", { id: "rl-87", recipeId: "recipe-34", productId: "prod-69", quantity: "42.857143", uom: "g", notes: null });
    this.recipeLines.set("rl-88", { id: "rl-88", recipeId: "recipe-34", productId: "prod-162", quantity: "60.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-89", { id: "rl-89", recipeId: "recipe-35", productId: "prod-69", quantity: "61.696658", uom: "g", notes: null });
    this.recipeLines.set("rl-90", { id: "rl-90", recipeId: "recipe-35", productId: "prod-162", quantity: "120.0", uom: "pcs", notes: null });
    this.recipeLines.set("rl-91", { id: "rl-91", recipeId: "recipe-36", productId: "prod-37", quantity: "30.0", uom: "g", notes: null });
    this.recipeLines.set("rl-92", { id: "rl-92", recipeId: "recipe-36", productId: "prod-162", quantity: "60.0", uom: "pcs", notes: null });

  }

  // ─── Products ───────────────────────────────────────────

  async getProducts(): Promise<Product[]> {
    return Array.from(this.products.values());
  }

  async getProduct(id: string): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async createProduct(data: InsertProduct): Promise<Product> {
    const id = randomUUID();
    const now = new Date();
    const product: Product = {
      id,
      name: data.name,
      sku: data.sku,
      category: data.category ?? "ACTIVE_INGREDIENT",
      defaultUom: data.defaultUom ?? "g",
      description: data.description ?? null,
      status: data.status ?? "ACTIVE",
      lowStockThreshold: data.lowStockThreshold ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.products.set(id, product);
    return product;
  }

  async updateProduct(id: string, data: Partial<InsertProduct>): Promise<Product | undefined> {
    const existing = this.products.get(id);
    if (!existing) return undefined;
    const updated: Product = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.products.set(id, updated);
    return updated;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const exists = this.products.has(id);
    if (!exists) return false;
    // Clean up related lots, transactions, recipe lines, recipes
    for (const [lotId, lot] of this.lots) {
      if (lot.productId === id) {
        // Remove transactions for this lot
        for (const [txId, tx] of this.transactions) {
          if (tx.lotId === lotId) this.transactions.delete(txId);
        }
        this.lots.delete(lotId);
      }
    }
    // Remove recipes for this product
    for (const [recipeId, recipe] of this.recipes) {
      if (recipe.productId === id) {
        for (const [lineId, line] of this.recipeLines) {
          if (line.recipeId === recipeId) this.recipeLines.delete(lineId);
        }
        this.recipes.delete(recipeId);
      }
    }
    // Remove recipe lines that reference this product as a material
    for (const [lineId, line] of this.recipeLines) {
      if (line.productId === id) this.recipeLines.delete(lineId);
    }
    this.products.delete(id);
    return true;
  }

  // ─── Lots ──────────────────────────────────────────────

  async getLots(productId?: string): Promise<Lot[]> {
    const all = Array.from(this.lots.values());
    if (productId) return all.filter(l => l.productId === productId);
    return all;
  }

  async getLot(id: string): Promise<Lot | undefined> {
    return this.lots.get(id);
  }

  async getLotsByProduct(productId: string): Promise<Lot[]> {
    return Array.from(this.lots.values()).filter(l => l.productId === productId);
  }

  async createLot(data: InsertLot): Promise<Lot> {
    const id = randomUUID();
    const lot: Lot = {
      id,
      productId: data.productId,
      lotNumber: data.lotNumber,
      supplierName: data.supplierName ?? null,
      receivedDate: data.receivedDate ?? null,
      expirationDate: data.expirationDate ?? null,
      supplierCoaUrl: data.supplierCoaUrl ?? null,
      neuroganCoaUrl: data.neuroganCoaUrl ?? null,
      purchasePrice: data.purchasePrice ?? null,
      purchaseUom: data.purchaseUom ?? null,
      poReference: data.poReference ?? null,
      notes: data.notes ?? null,
      createdAt: new Date(),
    };
    this.lots.set(id, lot);
    return lot;
  }

  async updateLot(id: string, data: Partial<InsertLot>): Promise<Lot | undefined> {
    const existing = this.lots.get(id);
    if (!existing) return undefined;
    const updated: Lot = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
    };
    this.lots.set(id, updated);
    return updated;
  }

  // ─── Locations ─────────────────────────────────────────

  async getLocations(): Promise<Location[]> {
    return Array.from(this.locations.values());
  }

  async getLocation(id: string): Promise<Location | undefined> {
    return this.locations.get(id);
  }

  async createLocation(data: InsertLocation): Promise<Location> {
    const id = randomUUID();
    const location: Location = {
      id,
      name: data.name,
      description: data.description ?? null,
    };
    this.locations.set(id, location);
    return location;
  }

  async updateLocation(id: string, data: Partial<InsertLocation>): Promise<Location | undefined> {
    const existing = this.locations.get(id);
    if (!existing) return undefined;
    const updated: Location = {
      ...existing,
      ...data,
      id: existing.id,
    };
    this.locations.set(id, updated);
    return updated;
  }

  async deleteLocation(id: string): Promise<boolean> {
    return this.locations.delete(id);
  }

  // ─── Transactions ──────────────────────────────────────

  async getTransactions(filters?: TransactionFilters): Promise<TransactionWithDetails[]> {
    let txns = Array.from(this.transactions.values());

    if (filters) {
      if (filters.lotId) {
        txns = txns.filter(t => t.lotId === filters.lotId);
      }
      if (filters.type) {
        txns = txns.filter(t => t.type === filters.type);
      }
      if (filters.productionBatchId) {
        txns = txns.filter(t => t.productionBatchId === filters.productionBatchId);
      }
      if (filters.productId) {
        const productLotIds = new Set(
          Array.from(this.lots.values())
            .filter(l => l.productId === filters.productId)
            .map(l => l.id)
        );
        txns = txns.filter(t => productLotIds.has(t.lotId));
      }
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom);
        txns = txns.filter(t => t.createdAt && t.createdAt >= from);
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        txns = txns.filter(t => t.createdAt && t.createdAt <= to);
      }
    }

    // Sort by createdAt descending
    txns.sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt ? b.createdAt.getTime() : 0;
      return bTime - aTime;
    });

    // Enrich with product name, lot number, location name, batch number
    return txns.map(t => {
      const lot = this.lots.get(t.lotId);
      const product = lot ? this.products.get(lot.productId) : undefined;
      const location = this.locations.get(t.locationId);
      const batch = t.productionBatchId ? this.productionBatches.get(t.productionBatchId) : undefined;
      return {
        ...t,
        productName: product?.name ?? "Unknown",
        lotNumber: lot?.lotNumber ?? "Unknown",
        locationName: location?.name ?? "Unknown",
        batchNumber: batch?.batchNumber ?? null,
      };
    });
  }

  async createTransaction(data: InsertTransaction): Promise<Transaction> {
    const id = randomUUID();
    const tx: Transaction = {
      id,
      lotId: data.lotId,
      locationId: data.locationId,
      type: data.type,
      quantity: data.quantity,
      uom: data.uom,
      productionBatchId: data.productionBatchId ?? null,
      notes: data.notes ?? null,
      performedBy: data.performedBy ?? null,
      createdAt: new Date(),
    };
    this.transactions.set(id, tx);
    return tx;
  }

  // ─── Inventory ─────────────────────────────────────────

  async getInventory(): Promise<InventoryGrouped[]> {
    const allTxns = Array.from(this.transactions.values());

    // Step 1: Sum quantities by lotId + locationId
    const quantityMap = new Map<string, number>();
    const uomMap = new Map<string, string>();
    for (const tx of allTxns) {
      const key = `${tx.lotId}|${tx.locationId}`;
      const current = quantityMap.get(key) ?? 0;
      quantityMap.set(key, current + parseFloat(tx.quantity));
      uomMap.set(key, tx.uom);
    }

    // Step 2: Group by product → lot → location
    const productMap = new Map<string, InventoryGrouped>();

    for (const [key, quantity] of quantityMap.entries()) {
      if (quantity <= 0) continue;

      const [lotId, locationId] = key.split("|");
      const lot = this.lots.get(lotId);
      if (!lot) continue;
      const product = this.products.get(lot.productId);
      if (!product) continue;
      const location = this.locations.get(locationId);
      if (!location) continue;

      const uom = uomMap.get(key) ?? product.defaultUom;

      // Get or create product entry
      if (!productMap.has(product.id)) {
        productMap.set(product.id, {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          category: product.category,
          defaultUom: product.defaultUom,
          totalQuantity: 0,
          lowStockThreshold: product.lowStockThreshold ? parseFloat(product.lowStockThreshold) : null,
          lots: [],
        });
      }
      const productEntry = productMap.get(product.id)!;

      // Find or create lot entry
      let lotEntry = productEntry.lots.find(l => l.lotId === lotId);
      if (!lotEntry) {
        lotEntry = {
          lotId,
          lotNumber: lot.lotNumber,
          supplierName: lot.supplierName,
          expirationDate: lot.expirationDate,
          locations: [],
          totalQuantity: 0,
        };
        productEntry.lots.push(lotEntry);
      }

      // Add location
      lotEntry.locations.push({
        locationId,
        locationName: location.name,
        quantity,
        uom,
      });

      lotEntry.totalQuantity += quantity;
      productEntry.totalQuantity += quantity;
    }

    return Array.from(productMap.values());
  }

  // ─── Suppliers ─────────────────────────────────────────

  async getSuppliers(): Promise<Supplier[]> {
    return Array.from(this.suppliers.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    return this.suppliers.get(id);
  }

  async createSupplier(data: InsertSupplier): Promise<Supplier> {
    const id = randomUUID();
    const supplier: Supplier = {
      id,
      name: data.name,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      notes: data.notes ?? null,
      createdAt: new Date(),
    };
    this.suppliers.set(id, supplier);
    return supplier;
  }

  async updateSupplier(id: string, data: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const existing = this.suppliers.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.suppliers.set(id, updated);
    return updated;
  }

  async deleteSupplier(id: string): Promise<boolean> {
    return this.suppliers.delete(id);
  }

  // ─── Purchase Orders ──────────────────────────────────────

  private enrichPO(po: PurchaseOrder): PurchaseOrderWithDetails {
    const supplier = this.suppliers.get(po.supplierId);
    const lineItems: POLineItemWithProduct[] = Array.from(this.poLineItems.values())
      .filter(li => li.purchaseOrderId === po.id)
      .map(li => {
        const product = this.products.get(li.productId);
        return {
          ...li,
          productName: product?.name ?? "Unknown",
          productSku: product?.sku ?? "Unknown",
        };
      });
    const totalOrdered = lineItems.reduce((sum, li) => sum + parseFloat(li.quantityOrdered), 0);
    const totalReceived = lineItems.reduce((sum, li) => sum + parseFloat(li.quantityReceived), 0);
    return {
      ...po,
      supplierName: supplier?.name ?? "Unknown",
      lineItems,
      totalOrdered,
      totalReceived,
    };
  }

  async getPurchaseOrders(filters?: { status?: string; supplierId?: string }): Promise<PurchaseOrderWithDetails[]> {
    let pos = Array.from(this.purchaseOrders.values());
    if (filters?.status) pos = pos.filter(po => po.status === filters.status);
    if (filters?.supplierId) pos = pos.filter(po => po.supplierId === filters.supplierId);
    pos.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });
    return pos.map(po => this.enrichPO(po));
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrderWithDetails | undefined> {
    const po = this.purchaseOrders.get(id);
    if (!po) return undefined;
    return this.enrichPO(po);
  }

  async createPurchaseOrder(data: InsertPurchaseOrder, lineItems: Omit<InsertPOLineItem, "purchaseOrderId">[]): Promise<PurchaseOrderWithDetails> {
    const id = randomUUID();
    const po: PurchaseOrder = {
      id,
      poNumber: data.poNumber,
      supplierId: data.supplierId,
      status: data.status ?? "DRAFT",
      orderDate: data.orderDate ?? null,
      expectedDeliveryDate: data.expectedDeliveryDate ?? null,
      notes: data.notes ?? null,
      createdBy: data.createdBy ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.purchaseOrders.set(id, po);

    for (const li of lineItems) {
      const liId = randomUUID();
      const lineItem: POLineItem = {
        id: liId,
        purchaseOrderId: id,
        productId: li.productId,
        quantityOrdered: li.quantityOrdered,
        quantityReceived: li.quantityReceived ?? "0",
        unitPrice: li.unitPrice ?? null,
        uom: li.uom,
        lotNumber: li.lotNumber ?? null,
        notes: li.notes ?? null,
      };
      this.poLineItems.set(liId, lineItem);
    }

    return this.enrichPO(po);
  }

  async updatePurchaseOrder(id: string, data: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const existing = this.purchaseOrders.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.purchaseOrders.set(id, updated);
    return updated;
  }

  async updatePurchaseOrderStatus(id: string, status: string): Promise<PurchaseOrder | undefined> {
    const existing = this.purchaseOrders.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, status, updatedAt: new Date() };
    this.purchaseOrders.set(id, updated);
    return updated;
  }

  // ─── PO Receiving ──────────────────────────────────────

  async receivePOLineItem(
    lineItemId: string,
    quantity: number,
    lotNumber: string,
    locationId: string,
    supplierName?: string,
    expirationDate?: string,
    receivedDate?: string,
  ): Promise<{ lot: Lot; transaction: Transaction }> {
    const lineItem = this.poLineItems.get(lineItemId);
    if (!lineItem) throw new Error("Line item not found");

    const po = this.purchaseOrders.get(lineItem.purchaseOrderId);
    if (!po) throw new Error("Purchase order not found");

    const product = this.products.get(lineItem.productId);
    if (!product) throw new Error("Product not found");

    const supplier = this.suppliers.get(po.supplierId);

    // Create lot
    const lot = await this.createLot({
      productId: lineItem.productId,
      lotNumber,
      supplierName: supplierName ?? supplier?.name ?? null,
      receivedDate: receivedDate ?? new Date().toISOString().slice(0, 10),
      expirationDate: expirationDate ?? null,
      poReference: po.poNumber,
    });

    // Create inventory transaction
    const transaction = await this.createTransaction({
      lotId: lot.id,
      locationId,
      type: "PO_RECEIPT",
      quantity: String(Math.abs(quantity)),
      uom: lineItem.uom,
      notes: `Received against PO ${po.poNumber}`,
      performedBy: "admin",
    });

    // Set quarantine status on the new lot
    (lot as any).quarantineStatus = "QUARANTINED";

    // Auto-create receiving record
    const rcvId = await this.getNextReceivingIdentifier();
    const rcvRecord: ReceivingRecord = {
      id: randomUUID(),
      purchaseOrderId: po.id,
      lotId: lot.id,
      supplierId: null,
      uniqueIdentifier: rcvId,
      dateReceived: receivedDate ?? new Date().toISOString().slice(0, 10),
      quantityReceived: String(quantity),
      uom: lineItem.uom,
      supplierLotNumber: lotNumber,
      containerConditionOk: null,
      sealsIntact: null,
      labelsMatch: null,
      invoiceMatchesPo: null,
      visualExamNotes: null,
      visualExamBy: null,
      visualExamAt: null,
      status: "QUARANTINED",
      qcReviewedBy: null,
      qcReviewedAt: null,
      qcDisposition: null,
      qcNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.receivingRecordsMap.set(rcvRecord.id, rcvRecord);

    // Update line item received quantity
    const newReceived = parseFloat(lineItem.quantityReceived) + Math.abs(quantity);
    this.poLineItems.set(lineItemId, {
      ...lineItem,
      quantityReceived: String(newReceived),
    });

    // Auto-update PO status
    const allLineItems = Array.from(this.poLineItems.values())
      .filter(li => li.purchaseOrderId === po.id);
    const allFullyReceived = allLineItems.every(
      li => parseFloat(li.quantityReceived) >= parseFloat(li.quantityOrdered)
    );
    const someReceived = allLineItems.some(
      li => parseFloat(li.quantityReceived) > 0
    );

    if (allFullyReceived) {
      await this.updatePurchaseOrderStatus(po.id, "CLOSED");
    } else if (someReceived) {
      await this.updatePurchaseOrderStatus(po.id, "PARTIALLY_RECEIVED");
    }

    return { lot, transaction };
  }

  // ─── Production Batches ──────────────────────────────────

  private enrichBatch(batch: ProductionBatch): ProductionBatchWithDetails {
    const product = this.products.get(batch.productId);
    const inputs: ProductionInputWithDetails[] = Array.from(this.productionInputs.values())
      .filter(pi => pi.batchId === batch.id)
      .map(pi => {
        const inputProduct = this.products.get(pi.productId);
        const lot = this.lots.get(pi.lotId);
        const location = this.locations.get(pi.locationId);
        return {
          ...pi,
          productName: inputProduct?.name ?? "Unknown",
          productSku: inputProduct?.sku ?? "Unknown",
          lotNumber: lot?.lotNumber ?? "Unknown",
          locationName: location?.name ?? "Unknown",
        };
      });
    return {
      ...batch,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "Unknown",
      inputs,
    };
  }

  async getProductionBatches(filters?: { status?: string }): Promise<ProductionBatchWithDetails[]> {
    let batches = Array.from(this.productionBatches.values());
    if (filters?.status) batches = batches.filter(b => b.status === filters.status);
    batches.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });
    return batches.map(b => this.enrichBatch(b));
  }

  async getProductionBatch(id: string): Promise<ProductionBatchWithDetails | undefined> {
    const batch = this.productionBatches.get(id);
    if (!batch) return undefined;
    return this.enrichBatch(batch);
  }

  async createProductionBatch(data: InsertProductionBatch, inputs: Omit<InsertProductionInput, "batchId">[]): Promise<ProductionBatchWithDetails> {
    // Validate batch number uniqueness
    const existingBatch = Array.from(this.productionBatches.values()).find(b => b.batchNumber === data.batchNumber);
    if (existingBatch) {
      throw new Error(`Batch number ${data.batchNumber} already exists. Please use a unique batch number.`);
    }

    // Validate all input lots are approved (not quarantined)
    for (const input of inputs) {
      const lot = this.lots.get(input.lotId);
      if (lot && (lot as any).quarantineStatus && (lot as any).quarantineStatus !== "APPROVED") {
        throw new Error(`Lot ${lot.lotNumber} is ${(lot as any).quarantineStatus} and cannot be used in production. Only APPROVED lots can be used.`);
      }
    }

    const id = randomUUID();
    const now = new Date();
    const batch: ProductionBatch = {
      id,
      batchNumber: data.batchNumber,
      productId: data.productId,
      status: data.status ?? "DRAFT",
      plannedQuantity: data.plannedQuantity,
      actualQuantity: data.actualQuantity ?? null,
      outputUom: data.outputUom ?? "pcs",
      outputLotNumber: data.outputLotNumber ?? null,
      outputExpirationDate: data.outputExpirationDate ?? null,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      qcStatus: data.qcStatus ?? "PENDING",
      qcNotes: data.qcNotes ?? null,
      operatorName: data.operatorName ?? null,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.productionBatches.set(id, batch);

    for (const input of inputs) {
      let lotId = input.lotId;
      let locationId = input.locationId;

      // For secondary packaging, create/find a default lot if not provided
      const inputProduct = this.products.get(input.productId);
      if (inputProduct?.category === "SECONDARY_PACKAGING") {
        if (!lotId) {
          // Find or create a NO-LOT lot for this product
          const existingNoLot = Array.from(this.lots.values()).find(
            l => l.productId === input.productId && l.lotNumber === "NO-LOT"
          );
          if (existingNoLot) {
            lotId = existingNoLot.id;
          } else {
            const noLot = await this.createLot({ productId: input.productId, lotNumber: "NO-LOT" });
            lotId = noLot.id;
          }
        }
        if (!locationId) {
          // Use the first available location
          const firstLoc = Array.from(this.locations.values())[0];
          locationId = firstLoc?.id ?? "";
        }
      }

      const inputId = randomUUID();
      const pi: ProductionInput = {
        id: inputId,
        batchId: id,
        productId: input.productId,
        lotId: lotId,
        locationId: locationId,
        quantityUsed: input.quantityUsed,
        uom: input.uom,
      };
      this.productionInputs.set(inputId, pi);
    }

    return this.enrichBatch(batch);
  }

  async updateProductionBatch(id: string, data: Partial<InsertProductionBatch>, inputs?: Omit<InsertProductionInput, "batchId">[]): Promise<ProductionBatch | undefined> {
    const existing = this.productionBatches.get(id);
    if (!existing) return undefined;

    // If transitioning to IN_PROGRESS, validate all input lots are approved
    if (data.status === "IN_PROGRESS" && existing.status !== "IN_PROGRESS") {
      // Check existing inputs for this batch
      const batchInputs = Array.from(this.productionInputs.values()).filter(pi => pi.batchId === id);
      for (const input of batchInputs) {
        const lot = this.lots.get(input.lotId);
        if (lot && (lot as any).quarantineStatus && (lot as any).quarantineStatus !== "APPROVED") {
          throw new Error(`Lot ${lot.lotNumber} is ${(lot as any).quarantineStatus} and cannot be used in production. Only APPROVED lots can be used.`);
        }
      }
    }

    // If new inputs are provided, validate they are all approved
    if (inputs) {
      for (const input of inputs) {
        const lot = this.lots.get(input.lotId);
        if (lot && (lot as any).quarantineStatus && (lot as any).quarantineStatus !== "APPROVED") {
          throw new Error(`Lot ${lot.lotNumber} is ${(lot as any).quarantineStatus} and cannot be used in production. Only APPROVED lots can be used.`);
        }
      }
    }

    const updated: ProductionBatch = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.productionBatches.set(id, updated);

    // If inputs provided, replace all existing inputs
    if (inputs) {
      // Delete old inputs
      const keysToDelete = Array.from(this.productionInputs.entries())
        .filter(([_, pi]) => pi.batchId === id)
        .map(([key]) => key);
      for (const key of keysToDelete) {
        this.productionInputs.delete(key);
      }
      // Create new inputs
      for (const input of inputs) {
        let lotId = input.lotId;
        let locationId = input.locationId;

        const inputProduct = this.products.get(input.productId);
        if (inputProduct?.category === "SECONDARY_PACKAGING") {
          if (!lotId) {
            const existingNoLot = Array.from(this.lots.values()).find(
              l => l.productId === input.productId && l.lotNumber === "NO-LOT"
            );
            if (existingNoLot) {
              lotId = existingNoLot.id;
            } else {
              const noLot = await this.createLot({ productId: input.productId, lotNumber: "NO-LOT" });
              lotId = noLot.id;
            }
          }
          if (!locationId) {
            const firstLoc = Array.from(this.locations.values())[0];
            locationId = firstLoc?.id ?? "";
          }
        }

        const inputId = randomUUID();
        const pi: ProductionInput = {
          id: inputId,
          batchId: id,
          productId: input.productId,
          lotId: lotId,
          locationId: locationId,
          quantityUsed: input.quantityUsed,
          uom: input.uom,
        };
        this.productionInputs.set(inputId, pi);
      }
    }

    // Auto-create BPR when batch starts production
    if (data.status === "IN_PROGRESS") {
      const existingBpr = await this.getBprByBatchId(id);
      if (!existingBpr) {
        const batch = this.productionBatches.get(id)!;
        const recipe = Array.from(this.recipes.values()).find(r => r.productId === batch.productId);
        await this.createBpr({
          productionBatchId: id,
          batchNumber: batch.batchNumber,
          lotNumber: batch.outputLotNumber ?? null,
          productId: batch.productId,
          recipeId: recipe?.id ?? null,
          status: "IN_PROGRESS",
          theoreticalYield: batch.plannedQuantity,
          startedAt: new Date(),
        });
      }
    }

    return updated;
  }

  async deleteProductionBatch(id: string): Promise<boolean> {
    const batch = this.productionBatches.get(id);
    if (!batch) return false;
    if (batch.status !== "DRAFT") return false;
    // Delete associated inputs
    const keysToDelete = Array.from(this.productionInputs.entries())
      .filter(([_, pi]) => pi.batchId === id)
      .map(([key]) => key);
    for (const key of keysToDelete) {
      this.productionInputs.delete(key);
    }
    return this.productionBatches.delete(id);
  }

  async getNextBatchNumber(): Promise<string> {
    let max = 0;
    const batches = Array.from(this.productionBatches.values());
    for (const batch of batches) {
      const match = batch.batchNumber.match(/^BATCH-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) max = num;
      }
    }
    return `BATCH-${String(max + 1).padStart(3, '0')}`;
  }

  async getNextOutputLotNumber(): Promise<string> {
    const settings = await this.getSettings();
    const prefix = settings.fgLotNumberPrefix ?? "FG";
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    let max = 0;
    // Check completed batches for existing PREFIX-NNN output lot numbers
    const batches = Array.from(this.productionBatches.values());
    for (const batch of batches) {
      if (batch.outputLotNumber) {
        const match = batch.outputLotNumber.match(pattern);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > max) max = num;
        }
      }
    }
    // Also check lots table for any PREFIX-NNN lot numbers
    const lots = Array.from(this.lots.values());
    for (const lot of lots) {
      const match = lot.lotNumber.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) max = num;
      }
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }

  async completeProductionBatch(
    id: string,
    actualQuantity: number,
    outputLotNumber: string,
    outputExpirationDate: string | null,
    locationId: string,
    qcStatus?: string,
    qcNotes?: string,
    endDate?: string,
    qcDisposition?: string,
    qcReviewedBy?: string,
    yieldPercentage?: string,
  ): Promise<ProductionBatchWithDetails> {
    const batch = this.productionBatches.get(id);
    if (!batch) throw new Error("Production batch not found");

    // ── Stock validation: check each input has sufficient inventory ──
    const inputs = Array.from(this.productionInputs.values()).filter(pi => pi.batchId === id);
    const inputsForValidation = inputs.map(inp => ({
      productId: inp.productId,
      quantity: Math.abs(parseFloat(inp.quantityUsed)),
    }));
    const shortages = await this.validateStockForInputs(inputsForValidation);
    if (shortages.length > 0) {
      const details = shortages.map(s =>
        `${s.productName} (${s.sku}): need ${s.requested} ${s.uom}, only ${s.available} ${s.uom} available`
      ).join("; ");
      throw new Error(`Insufficient stock for the following material(s): ${details}`);
    }

    const effectiveEndDate = endDate ?? new Date().toISOString().slice(0, 10);

    // 1. Update batch
    const updated: ProductionBatch = {
      ...batch,
      status: "COMPLETED",
      actualQuantity: String(actualQuantity),
      outputLotNumber,
      outputExpirationDate: outputExpirationDate ?? null,
      endDate: effectiveEndDate,
      qcStatus: qcStatus ?? "PENDING",
      qcNotes: qcNotes ?? null,
      qcDisposition: qcDisposition ?? null,
      qcReviewedBy: qcReviewedBy ?? null,
      yieldPercentage: yieldPercentage ?? null,
      updatedAt: new Date(),
    };
    this.productionBatches.set(id, updated);

    // 2. For each input line: create PRODUCTION_CONSUMPTION transaction (negative qty)
    for (const input of inputs) {
      await this.createTransaction({
        lotId: input.lotId,
        locationId: input.locationId,
        type: "PRODUCTION_CONSUMPTION",
        quantity: String(-Math.abs(parseFloat(input.quantityUsed))),
        uom: input.uom,
        productionBatchId: id,
        notes: `Production consumption for batch ${batch.batchNumber}`,
        performedBy: batch.operatorName ?? "system",
      });
    }

    // 3. Create a new lot for the finished product
    const outputLot = await this.createLot({
      productId: batch.productId,
      lotNumber: outputLotNumber,
      expirationDate: outputExpirationDate ?? null,
      receivedDate: effectiveEndDate,
      notes: `Produced in batch ${batch.batchNumber}`,
    });

    // 4. Create PRODUCTION_OUTPUT transaction
    await this.createTransaction({
      lotId: outputLot.id,
      locationId,
      type: "PRODUCTION_OUTPUT",
      quantity: String(Math.abs(actualQuantity)),
      uom: batch.outputUom,
      productionBatchId: id,
      notes: `Production output from batch ${batch.batchNumber}`,
      performedBy: batch.operatorName ?? "system",
    });

    return this.enrichBatch(updated);
  }

  // ─── Stock Availability & FIFO ────────────────────────────────

  async getAvailableStock(productId: string): Promise<StockByLotLocation[]> {
    const allTxns = Array.from(this.transactions.values());
    // Sum quantities by lotId + locationId, filtered by product
    const quantityMap = new Map<string, number>();
    const uomMap = new Map<string, string>();
    for (const tx of allTxns) {
      const lot = this.lots.get(tx.lotId);
      if (!lot || lot.productId !== productId) continue;
      const key = `${tx.lotId}|${tx.locationId}`;
      const current = quantityMap.get(key) ?? 0;
      quantityMap.set(key, current + parseFloat(tx.quantity));
      uomMap.set(key, tx.uom);
    }

    const result: StockByLotLocation[] = [];
    for (const [key, qty] of quantityMap.entries()) {
      if (qty <= 0) continue;
      const [lotId, locationId] = key.split("|");
      const lot = this.lots.get(lotId);
      const location = this.locations.get(locationId);
      if (!lot || !location) continue;
      const product = this.products.get(lot.productId);
      result.push({
        lotId,
        lotNumber: lot.lotNumber,
        locationId,
        locationName: location.name,
        availableQty: qty,
        expirationDate: lot.expirationDate ?? null,
        uom: uomMap.get(key) ?? product?.defaultUom ?? "pcs",
      });
    }

    // Sort by expiration date (FIFO) — earliest first; nulls go last
    result.sort((a, b) => {
      if (!a.expirationDate && !b.expirationDate) return 0;
      if (!a.expirationDate) return 1;
      if (!b.expirationDate) return -1;
      return a.expirationDate.localeCompare(b.expirationDate);
    });

    return result;
  }

  async allocateFIFO(productId: string, quantity: number): Promise<FIFOAllocation[]> {
    const stock = await this.getAvailableStock(productId);
    const allocations: FIFOAllocation[] = [];
    let remaining = quantity;

    for (const slot of stock) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, slot.availableQty);
      allocations.push({
        lotId: slot.lotId,
        lotNumber: slot.lotNumber,
        locationId: slot.locationId,
        locationName: slot.locationName,
        quantity: take,
        expirationDate: slot.expirationDate,
        uom: slot.uom,
      });
      remaining -= take;
    }

    return allocations;
  }

  async validateStockForInputs(inputs: { productId: string; quantity: number }[]): Promise<StockShortage[]> {
    const shortages: StockShortage[] = [];

    // Aggregate requested quantities by product
    const requested = new Map<string, number>();
    for (const inp of inputs) {
      const product = this.products.get(inp.productId);
      // Skip secondary packaging — no stock tracking required
      if (product?.category === "SECONDARY_PACKAGING") continue;
      requested.set(inp.productId, (requested.get(inp.productId) ?? 0) + inp.quantity);
    }

    for (const [productId, totalNeeded] of requested.entries()) {
      const stock = await this.getAvailableStock(productId);
      const totalAvailable = stock.reduce((sum, s) => sum + s.availableQty, 0);
      if (totalAvailable < totalNeeded) {
        const product = this.products.get(productId);
        shortages.push({
          productId,
          productName: product?.name ?? "Unknown",
          sku: product?.sku ?? "Unknown",
          requested: totalNeeded,
          available: totalAvailable,
          uom: product?.defaultUom ?? "pcs",
        });
      }
    }

    return shortages;
  }

  async deleteCompletedBatch(id: string): Promise<boolean> {
    const batch = this.productionBatches.get(id);
    if (!batch) return false;
    if (batch.status !== "COMPLETED") return false;

    // 1. Find and delete all transactions linked to this batch
    const batchTxnKeys: string[] = [];
    let outputLotId: string | null = null;
    for (const [key, tx] of this.transactions.entries()) {
      if (tx.productionBatchId === id) {
        batchTxnKeys.push(key);
        // Identify the output lot from PRODUCTION_OUTPUT transaction
        if (tx.type === "PRODUCTION_OUTPUT") {
          outputLotId = tx.lotId;
        }
      }
    }
    for (const key of batchTxnKeys) {
      this.transactions.delete(key);
    }

    // 2. Delete the output lot that was created during completion
    if (outputLotId) {
      this.lots.delete(outputLotId);
    }

    // 3. Delete production inputs
    const inputKeys = Array.from(this.productionInputs.entries())
      .filter(([_, pi]) => pi.batchId === id)
      .map(([key]) => key);
    for (const key of inputKeys) {
      this.productionInputs.delete(key);
    }

    // 4. Delete the batch itself
    this.productionBatches.delete(id);

    return true;
  }

  // ─── Settings ───────────────────────────────────────────

  async getSettings(): Promise<AppSettings> {
    return this.settings;
  }

  async updateSettings(data: Partial<InsertAppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...data, updatedAt: new Date() };
    return this.settings;
  }

  // ─── Dashboard ─────────────────────────────────────────

  async getDashboardStats(): Promise<DashboardStats> {
    const recentTxns = await this.getTransactions();
    const inventory = await this.getInventory();
    const settings = await this.getSettings();

    // Active production batches (IN_PROGRESS, ON_HOLD, DRAFT)
    const activeBatchStatuses = ["DRAFT", "IN_PROGRESS", "ON_HOLD"];
    const activeBatches: ActiveBatchDetail[] = Array.from(this.productionBatches.values())
      .filter(b => activeBatchStatuses.includes(b.status))
      .map(b => {
        const product = this.products.get(b.productId);
        return {
          id: b.id,
          batchNumber: b.batchNumber,
          productName: product?.name ?? "Unknown",
          productSku: product?.sku ?? "",
          status: b.status,
          plannedQuantity: b.plannedQuantity,
          outputUom: b.outputUom,
          startedAt: b.startDate ?? (b.updatedAt ? b.updatedAt.toISOString() : null),
          createdAt: b.createdAt ? b.createdAt.toISOString() : new Date().toISOString(),
        };
      })
      .sort((a, b) => {
        const order: Record<string, number> = { IN_PROGRESS: 0, ON_HOLD: 1, DRAFT: 2 };
        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
      });

    // Open POs (DRAFT, SUBMITTED, PARTIALLY_RECEIVED) with material line details
    const openPOList = Array.from(this.purchaseOrders.values()).filter(
      po => po.status === "DRAFT" || po.status === "SUBMITTED" || po.status === "PARTIALLY_RECEIVED"
    );
    const openPOs: OpenPODetail[] = openPOList.map(po => {
      const lineItems = Array.from(this.poLineItems.values())
        .filter(li => li.purchaseOrderId === po.id);
      const supplier = this.suppliers.get(po.supplierId);
      const materials = lineItems.map(li => {
        const prod = this.products.get(li.productId);
        return {
          name: prod?.name ?? "Unknown",
          sku: prod?.sku ?? "",
          qtyOrdered: parseFloat(li.quantityOrdered),
          qtyReceived: parseFloat(li.quantityReceived),
          uom: li.uom,
        };
      });
      const totalOrdered = materials.reduce((sum, m) => sum + m.qtyOrdered, 0);
      const totalReceived = materials.reduce((sum, m) => sum + m.qtyReceived, 0);
      return {
        id: po.id,
        poNumber: po.poNumber,
        supplierName: supplier?.name ?? "Unknown",
        status: po.status,
        expectedDeliveryDate: po.expectedDeliveryDate,
        materials,
        totalOrdered,
        totalReceived,
      };
    });

    // Low stock: read threshold from settings
    const lowStockThreshold = parseFloat(settings.lowStockThreshold) || 1;
    const lowStockItems: LowStockItem[] = inventory
      .filter(item => item.totalQuantity < lowStockThreshold && item.totalQuantity >= 0)
      .map(item => ({
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        category: item.category,
        defaultUom: item.defaultUom,
        totalQuantity: item.totalQuantity,
        threshold: lowStockThreshold,
      }))
      .sort((a, b) => a.totalQuantity - b.totalQuantity);

    return {
      activeBatches,
      openPOs,
      lowStockItems,
      recentTransactions: recentTxns.slice(0, 10),
    };
  }
  // ─── Recipes ──────────────────────────────────────────

  private enrichRecipe(recipe: Recipe): RecipeWithDetails {
    const product = this.products.get(recipe.productId);
    const lines = Array.from(this.recipeLines.values())
      .filter(l => l.recipeId === recipe.id)
      .map(line => {
        const mat = this.products.get(line.productId);
        return {
          ...line,
          productName: mat?.name ?? "Unknown",
          productSku: mat?.sku ?? "",
          productCategory: mat?.category ?? "",
        } as RecipeLineWithDetails;
      });
    return {
      ...recipe,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "",
      lines,
    };
  }

  async getRecipes(productId?: string): Promise<RecipeWithDetails[]> {
    let recipes = Array.from(this.recipes.values());
    if (productId) {
      recipes = recipes.filter(r => r.productId === productId);
    }
    return recipes.map(r => this.enrichRecipe(r));
  }

  async getRecipe(id: string): Promise<RecipeWithDetails | undefined> {
    const recipe = this.recipes.get(id);
    if (!recipe) return undefined;
    return this.enrichRecipe(recipe);
  }

  async createRecipe(data: InsertRecipe, lines: Omit<InsertRecipeLine, "recipeId">[]): Promise<RecipeWithDetails> {
    const now = new Date();
    const recipe: Recipe = {
      id: randomUUID(),
      productId: data.productId,
      name: data.name,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.recipes.set(recipe.id, recipe);

    for (const line of lines) {
      const rl: RecipeLine = {
        id: randomUUID(),
        recipeId: recipe.id,
        productId: line.productId,
        quantity: String(line.quantity),
        uom: line.uom,
        notes: line.notes ?? null,
      };
      this.recipeLines.set(rl.id, rl);
    }

    return this.enrichRecipe(recipe);
  }

  async updateRecipe(id: string, data: Partial<InsertRecipe>, lines?: Omit<InsertRecipeLine, "recipeId">[]): Promise<RecipeWithDetails | undefined> {
    const existing = this.recipes.get(id);
    if (!existing) return undefined;

    const updated: Recipe = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.recipes.set(id, updated);

    if (lines) {
      // Delete old lines and replace
      for (const [lineId, line] of this.recipeLines) {
        if (line.recipeId === id) {
          this.recipeLines.delete(lineId);
        }
      }
      for (const line of lines) {
        const rl: RecipeLine = {
          id: randomUUID(),
          recipeId: id,
          productId: line.productId,
          quantity: String(line.quantity),
          uom: line.uom,
          notes: line.notes ?? null,
        };
        this.recipeLines.set(rl.id, rl);
      }
    }

    return this.enrichRecipe(updated);
  }

  async deleteRecipe(id: string): Promise<boolean> {
    const exists = this.recipes.has(id);
    if (!exists) return false;
    // Delete lines first
    for (const [lineId, line] of this.recipeLines) {
      if (line.recipeId === id) {
        this.recipeLines.delete(lineId);
      }
    }
    this.recipes.delete(id);
    return true;
  }

  // ─── Product Categories ──────────────────────────────

  async getProductCategories(): Promise<ProductCategory[]> {
    return Array.from(this.productCategoriesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async createProductCategory(data: InsertProductCategory): Promise<ProductCategory> {
    // Check for duplicate name (case-insensitive)
    const existing = Array.from(this.productCategoriesMap.values()).find(
      c => c.name.toLowerCase() === data.name.toLowerCase()
    );
    if (existing) return existing; // Return existing instead of error
    const cat: ProductCategory = {
      id: randomUUID(),
      name: data.name,
      createdAt: new Date(),
    };
    this.productCategoriesMap.set(cat.id, cat);
    return cat;
  }

  async deleteProductCategory(id: string): Promise<boolean> {
    if (!this.productCategoriesMap.has(id)) return false;
    // Remove all assignments for this category
    for (const [aId, a] of this.productCategoryAssignments) {
      if (a.categoryId === id) this.productCategoryAssignments.delete(aId);
    }
    this.productCategoriesMap.delete(id);
    return true;
  }

  async getProductCategoryAssignments(productId?: string): Promise<ProductCategoryAssignment[]> {
    let assignments = Array.from(this.productCategoryAssignments.values());
    if (productId) assignments = assignments.filter(a => a.productId === productId);
    return assignments;
  }

  async assignProductCategory(productId: string, categoryId: string): Promise<ProductCategoryAssignment> {
    // Check for duplicate
    const existing = Array.from(this.productCategoryAssignments.values()).find(
      a => a.productId === productId && a.categoryId === categoryId
    );
    if (existing) return existing;
    const assignment: ProductCategoryAssignment = {
      id: randomUUID(),
      productId,
      categoryId,
    };
    this.productCategoryAssignments.set(assignment.id, assignment);
    return assignment;
  }

  async unassignProductCategory(productId: string, categoryId: string): Promise<boolean> {
    for (const [id, a] of this.productCategoryAssignments) {
      if (a.productId === productId && a.categoryId === categoryId) {
        this.productCategoryAssignments.delete(id);
        return true;
      }
    }
    return false;
  }

  async getProductsWithCategories(): Promise<ProductWithCategories[]> {
    const products = Array.from(this.products.values());
    return products.map(p => {
      const assignmentCategoryIds = Array.from(this.productCategoryAssignments.values())
        .filter(a => a.productId === p.id)
        .map(a => a.categoryId);
      const categories = assignmentCategoryIds
        .map(cid => this.productCategoriesMap.get(cid))
        .filter((c): c is ProductCategory => !!c);
      return { ...p, categories };
    });
  }

  // ─── Supply Chain Capacity ───────────────────────────

  async getSupplyChainCapacity(): Promise<ProductCapacity[]> {
    const inventory = await this.getInventory();
    const finishedGoods = Array.from(this.products.values()).filter(p => p.category === "FINISHED_GOOD");

    // Build stock lookup: productId → total qty
    const stockMap = new Map<string, number>();
    for (const inv of inventory) {
      stockMap.set(inv.productId, inv.totalQuantity);
    }

    // Build inbound PO qty map: productId → pending qty
    const inboundMap = new Map<string, number>();
    const openStatuses = ["DRAFT", "SUBMITTED", "PARTIALLY_RECEIVED"];
    for (const po of this.purchaseOrders.values()) {
      if (!openStatuses.includes(po.status)) continue;
      for (const li of this.poLineItems.values()) {
        if (li.purchaseOrderId !== po.id) continue;
        const pending = parseFloat(li.quantityOrdered) - parseFloat(li.quantityReceived);
        if (pending > 0) {
          inboundMap.set(li.productId, (inboundMap.get(li.productId) ?? 0) + pending);
        }
      }
    }

    // Build committed stock map: for active batches (IN_PROGRESS, ON_HOLD),
    // sum up material quantities that are committed via productionInputs
    const committedMap = new Map<string, number>();
    const allActiveBatches = Array.from(this.productionBatches.values())
      .filter(b => b.status === "IN_PROGRESS" || b.status === "ON_HOLD");
    const activeBatchIds = new Set(allActiveBatches.map(b => b.id));
    for (const input of this.productionInputs.values()) {
      if (!activeBatchIds.has(input.batchId)) continue;
      committedMap.set(input.productId, (committedMap.get(input.productId) ?? 0) + Math.abs(parseFloat(input.quantityUsed)));
    }

    const results: ProductCapacity[] = [];

    for (const fg of finishedGoods) {
      // Get category assignments
      const assignmentCategoryIds = Array.from(this.productCategoryAssignments.values())
        .filter(a => a.productId === fg.id)
        .map(a => a.categoryId);
      const categories = assignmentCategoryIds
        .map(cid => this.productCategoriesMap.get(cid))
        .filter((c): c is ProductCategory => !!c);

      // Current FG stock
      const currentFGStock = stockMap.get(fg.id) ?? 0;

      // Active batches for this product
      const fgActiveBatches = allActiveBatches.filter(b => b.productId === fg.id);
      const inProductionUnits = fgActiveBatches.reduce((sum, b) => sum + parseFloat(b.plannedQuantity), 0);
      const activeBatchCount = fgActiveBatches.length;

      // Find recipe for this product
      const recipe = Array.from(this.recipes.values()).find(r => r.productId === fg.id);
      if (!recipe) {
        results.push({
          productId: fg.id,
          productName: fg.name,
          sku: fg.sku,
          categories,
          currentFGStock,
          producibleUnits: 0,
          inboundProducibleUnits: 0,
          inProductionUnits,
          activeBatchCount,
          totalPotential: currentFGStock + inProductionUnits,
          bottleneckMaterial: null,
          hasRecipe: false,
          materials: [],
        });
        continue;
      }

      // Get recipe lines
      const lines = Array.from(this.recipeLines.values()).filter(l => l.recipeId === recipe.id);
      if (lines.length === 0) {
        results.push({
          productId: fg.id,
          productName: fg.name,
          sku: fg.sku,
          categories,
          currentFGStock,
          producibleUnits: 0,
          inboundProducibleUnits: 0,
          inProductionUnits,
          activeBatchCount,
          totalPotential: currentFGStock + inProductionUnits,
          bottleneckMaterial: null,
          hasRecipe: true,
          materials: [],
        });
        continue;
      }

      const materials: MaterialCapacity[] = [];
      let minFromStock = Infinity;
      let minFromInbound = Infinity;
      let bottleneckName: string | null = null;

      for (const line of lines) {
        const requiredPerUnit = parseFloat(line.quantity);
        if (requiredPerUnit <= 0) continue;

        const mat = this.products.get(line.productId);
        const totalInStock = stockMap.get(line.productId) ?? 0;
        const committed = committedMap.get(line.productId) ?? 0;
        const inStock = Math.max(0, totalInStock - committed);
        const inbound = inboundMap.get(line.productId) ?? 0;
        const supportsUnits = Math.floor(inStock / requiredPerUnit);
        const inboundSupportsUnits = Math.floor(inbound / requiredPerUnit);

        if (supportsUnits < minFromStock) {
          minFromStock = supportsUnits;
          bottleneckName = mat?.name ?? "Unknown";
        }
        if (inboundSupportsUnits < minFromInbound) {
          minFromInbound = inboundSupportsUnits;
        }

        materials.push({
          productId: line.productId,
          productName: mat?.name ?? "Unknown",
          sku: mat?.sku ?? "",
          requiredPerUnit,
          uom: line.uom,
          inStock,
          supportsUnits,
          inboundFromPOs: inbound,
          inboundSupportsUnits,
          isBottleneck: false, // set below
        });
      }

      const producibleUnits = minFromStock === Infinity ? 0 : minFromStock;
      const inboundProducibleUnits = minFromInbound === Infinity ? 0 : minFromInbound;

      // Mark bottleneck(s)
      for (const m of materials) {
        if (m.supportsUnits === producibleUnits) m.isBottleneck = true;
      }

      results.push({
        productId: fg.id,
        productName: fg.name,
        sku: fg.sku,
        categories,
        currentFGStock,
        producibleUnits,
        inboundProducibleUnits,
        inProductionUnits,
        activeBatchCount,
        totalPotential: currentFGStock + producibleUnits + inboundProducibleUnits + inProductionUnits,
        bottleneckMaterial: bottleneckName,
        hasRecipe: true,
        materials,
      });
    }

    return results.sort((a, b) => a.productName.localeCompare(b.productName));
  }

  // ─── Production Notes ───────────────────────────────

  async getProductionNotes(batchId: string): Promise<ProductionNote[]> {
    return Array.from(this.productionNotesMap.values())
      .filter(n => n.batchId === batchId)
      .sort((a, b) => {
        const aTime = a.createdAt ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt ? b.createdAt.getTime() : 0;
        return aTime - bTime;
      });
  }

  async createProductionNote(data: InsertProductionNote): Promise<ProductionNote> {
    const note: ProductionNote = {
      id: randomUUID(),
      batchId: data.batchId,
      content: data.content,
      author: data.author ?? null,
      createdAt: new Date(),
    };
    this.productionNotesMap.set(note.id, note);
    return note;
  }

  // ─── Supplier Documents ────────────────────────────────

  async getSupplierDocuments(supplierId: string): Promise<SupplierDocument[]> {
    return Array.from(this.supplierDocumentsMap.values())
      .filter(d => d.supplierId === supplierId)
      .sort((a, b) => {
        const aTime = a.uploadedAt ? a.uploadedAt.getTime() : 0;
        const bTime = b.uploadedAt ? b.uploadedAt.getTime() : 0;
        return bTime - aTime;
      });
  }

  async createSupplierDocument(data: InsertSupplierDocument): Promise<SupplierDocument> {
    const doc: SupplierDocument = {
      id: randomUUID(),
      supplierId: data.supplierId,
      fileName: data.fileName,
      fileType: data.fileType ?? null,
      fileSize: data.fileSize ?? null,
      fileData: data.fileData ?? null,
      uploadedAt: new Date(),
    };
    this.supplierDocumentsMap.set(doc.id, doc);
    return doc;
  }

  async deleteSupplierDocument(id: string): Promise<boolean> {
    return this.supplierDocumentsMap.delete(id);
  }

  async getSupplierDocument(id: string): Promise<SupplierDocument | undefined> {
    return this.supplierDocumentsMap.get(id);
  }

  // ─── Dashboard Supply Chain ────────────────────────────

  async getDashboardSupplyChain(): Promise<DashboardSupplyChain> {
    const capacity = await this.getSupplyChainCapacity();

    // Top bottleneck materials: count how many products each material limits
    const materialBottleneckCount = new Map<string, { materialId: string; materialName: string; materialSku: string; count: number; inStock: number; uom: string }>();

    for (const product of capacity) {
      if (!product.hasRecipe || product.materials.length === 0) continue;
      for (const mat of product.materials) {
        if (mat.isBottleneck) {
          const existing = materialBottleneckCount.get(mat.productId);
          if (existing) {
            existing.count++;
          } else {
            materialBottleneckCount.set(mat.productId, {
              materialId: mat.productId,
              materialName: mat.productName,
              materialSku: mat.sku,
              count: 1,
              inStock: mat.inStock,
              uom: mat.uom,
            });
          }
        }
      }
    }

    const topBottleneckMaterials: BottleneckMaterial[] = Array.from(materialBottleneckCount.values())
      .map(m => ({ materialId: m.materialId, materialName: m.materialName, materialSku: m.materialSku, productCount: m.count, inStock: m.inStock, uom: m.uom }))
      .sort((a, b) => b.productCount - a.productCount)
      .slice(0, 5);

    // Lowest capacity products (only those with recipes)
    const lowestCapacityProducts: LowestCapacityProduct[] = capacity
      .filter(p => p.hasRecipe)
      .sort((a, b) => a.totalPotential - b.totalPotential)
      .slice(0, 5)
      .map(p => ({
        productId: p.productId,
        productName: p.productName,
        productSku: p.sku,
        totalPotential: p.totalPotential,
        bottleneckMaterial: p.bottleneckMaterial,
      }));

    return { topBottleneckMaterials, lowestCapacityProducts };
  }

  // ─── Receiving & Quarantine ──────────────────────────────

  async getReceivingRecords(filters?: { status?: string }): Promise<ReceivingRecordWithDetails[]> {
    let records = Array.from(this.receivingRecordsMap.values());
    if (filters?.status) records = records.filter(r => r.status === filters.status);
    return records.map(r => this.enrichReceivingRecord(r)).sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt ? b.createdAt.getTime() : 0;
      return bTime - aTime;
    });
  }

  private enrichReceivingRecord(r: ReceivingRecord): ReceivingRecordWithDetails {
    const lot = this.lots.get(r.lotId);
    const product = lot ? this.products.get(lot.productId) : undefined;
    return {
      ...r,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "",
      lotNumber: lot?.lotNumber ?? "",
      supplierName: lot?.supplierName ?? null,
    };
  }

  async getReceivingRecord(id: string): Promise<ReceivingRecordWithDetails | undefined> {
    const r = this.receivingRecordsMap.get(id);
    if (!r) return undefined;
    return this.enrichReceivingRecord(r);
  }

  async createReceivingRecord(data: InsertReceivingRecord): Promise<ReceivingRecord> {
    const now = new Date();
    const record: ReceivingRecord = {
      id: randomUUID(),
      purchaseOrderId: data.purchaseOrderId ?? null,
      lotId: data.lotId,
      supplierId: data.supplierId ?? null,
      uniqueIdentifier: data.uniqueIdentifier,
      dateReceived: data.dateReceived ?? null,
      quantityReceived: data.quantityReceived ?? null,
      uom: data.uom ?? null,
      supplierLotNumber: data.supplierLotNumber ?? null,
      containerConditionOk: data.containerConditionOk ?? null,
      sealsIntact: data.sealsIntact ?? null,
      labelsMatch: data.labelsMatch ?? null,
      invoiceMatchesPo: data.invoiceMatchesPo ?? null,
      visualExamNotes: data.visualExamNotes ?? null,
      visualExamBy: data.visualExamBy ?? null,
      visualExamAt: data.visualExamAt ?? null,
      status: data.status ?? "QUARANTINED",
      qcReviewedBy: data.qcReviewedBy ?? null,
      qcReviewedAt: data.qcReviewedAt ?? null,
      qcDisposition: data.qcDisposition ?? null,
      qcNotes: data.qcNotes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.receivingRecordsMap.set(record.id, record);

    // Also update the lot's quarantine status
    const lot = this.lots.get(data.lotId);
    if (lot) {
      (lot as any).quarantineStatus = record.status;
    }

    return record;
  }

  async updateReceivingRecord(id: string, data: Partial<InsertReceivingRecord>): Promise<ReceivingRecord | undefined> {
    const existing = this.receivingRecordsMap.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date() } as ReceivingRecord;
    this.receivingRecordsMap.set(id, updated);
    return updated;
  }

  async qcReviewReceivingRecord(id: string, disposition: string, reviewedBy: string, notes?: string): Promise<ReceivingRecord | undefined> {
    const existing = this.receivingRecordsMap.get(id);
    if (!existing) return undefined;
    const newStatus = disposition === "APPROVED" || disposition === "APPROVED_WITH_CONDITIONS" ? "APPROVED" : "REJECTED";
    const updated: ReceivingRecord = {
      ...existing,
      status: newStatus,
      qcDisposition: disposition,
      qcReviewedBy: reviewedBy,
      qcReviewedAt: new Date(),
      qcNotes: notes ?? existing.qcNotes,
      updatedAt: new Date(),
    };
    this.receivingRecordsMap.set(id, updated);

    // Update the lot's quarantine status too
    const lot = this.lots.get(existing.lotId);
    if (lot) {
      (lot as any).quarantineStatus = newStatus;
    }

    return updated;
  }

  async getNextReceivingIdentifier(): Promise<string> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const existing = Array.from(this.receivingRecordsMap.values())
      .filter(r => r.uniqueIdentifier.startsWith(`RCV-${today}`));
    const seq = existing.length + 1;
    return `RCV-${today}-${String(seq).padStart(3, "0")}`;
  }

  async getQuarantinedLots(): Promise<ReceivingRecordWithDetails[]> {
    return this.getReceivingRecords({ status: "QUARANTINED" });
  }

  // ─── COA Documents ─────────────────────────────────────

  private enrichCoaDocument(coa: CoaDocument): CoaDocumentWithDetails {
    const lot = this.lots.get(coa.lotId);
    const product = lot ? this.products.get(lot.productId) : undefined;
    return {
      ...coa,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "",
      lotNumber: lot?.lotNumber ?? "",
      supplierName: lot?.supplierName ?? null,
    };
  }

  async getCoaDocuments(filters?: { lotId?: string; productionBatchId?: string; sourceType?: string; overallResult?: string }): Promise<CoaDocumentWithDetails[]> {
    let docs = Array.from(this.coaDocumentsMap.values());
    if (filters?.lotId) docs = docs.filter(d => d.lotId === filters.lotId);
    if (filters?.productionBatchId) docs = docs.filter(d => d.productionBatchId === filters.productionBatchId);
    if (filters?.sourceType) docs = docs.filter(d => d.sourceType === filters.sourceType);
    if (filters?.overallResult) docs = docs.filter(d => d.overallResult === filters.overallResult);
    return docs.map(d => this.enrichCoaDocument(d)).sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt ? b.createdAt.getTime() : 0;
      return bTime - aTime;
    });
  }

  async getCoaDocument(id: string): Promise<CoaDocumentWithDetails | undefined> {
    const doc = this.coaDocumentsMap.get(id);
    if (!doc) return undefined;
    return this.enrichCoaDocument(doc);
  }

  async createCoaDocument(data: InsertCoaDocument): Promise<CoaDocument> {
    const now = new Date();
    const doc: CoaDocument = {
      id: randomUUID(),
      lotId: data.lotId,
      receivingRecordId: data.receivingRecordId ?? null,
      productionBatchId: data.productionBatchId ?? null,
      sourceType: data.sourceType ?? "SUPPLIER",
      labName: data.labName ?? null,
      analystName: data.analystName ?? null,
      analysisDate: data.analysisDate ?? null,
      fileName: data.fileName ?? null,
      fileData: data.fileData ?? null,
      documentNumber: data.documentNumber ?? null,
      testsPerformed: data.testsPerformed ?? null,
      overallResult: data.overallResult ?? null,
      identityTestPerformed: data.identityTestPerformed ?? null,
      identityTestMethod: data.identityTestMethod ?? null,
      identityConfirmed: data.identityConfirmed ?? null,
      qcReviewedBy: data.qcReviewedBy ?? null,
      qcReviewedAt: data.qcReviewedAt ?? null,
      qcAccepted: data.qcAccepted ?? null,
      qcNotes: data.qcNotes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.coaDocumentsMap.set(doc.id, doc);
    return doc;
  }

  async updateCoaDocument(id: string, data: Partial<InsertCoaDocument>): Promise<CoaDocument | undefined> {
    const existing = this.coaDocumentsMap.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date() } as CoaDocument;
    this.coaDocumentsMap.set(id, updated);
    return updated;
  }

  async qcReviewCoa(id: string, accepted: boolean, reviewedBy: string, notes?: string): Promise<CoaDocument | undefined> {
    const existing = this.coaDocumentsMap.get(id);
    if (!existing) return undefined;
    const updated: CoaDocument = {
      ...existing,
      qcReviewedBy: reviewedBy,
      qcReviewedAt: new Date(),
      qcAccepted: accepted ? "true" : "false",
      qcNotes: notes ?? existing.qcNotes,
      updatedAt: new Date(),
    };
    this.coaDocumentsMap.set(id, updated);
    return updated;
  }

  async getCoasByLot(lotId: string): Promise<CoaDocumentWithDetails[]> {
    return this.getCoaDocuments({ lotId });
  }

  // ─── Supplier Qualifications ───────────────────────────

  private enrichSupplierQualification(sq: SupplierQualification): SupplierQualificationWithDetails {
    const supplier = this.suppliers.get(sq.supplierId);
    return { ...sq, supplierName: supplier?.name ?? "Unknown" };
  }

  async getSupplierQualifications(supplierId?: string): Promise<SupplierQualificationWithDetails[]> {
    let records = Array.from(this.supplierQualificationsMap.values());
    if (supplierId) records = records.filter(r => r.supplierId === supplierId);
    return records.map(r => this.enrichSupplierQualification(r)).sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt ? b.createdAt.getTime() : 0;
      return bTime - aTime;
    });
  }

  async getSupplierQualification(id: string): Promise<SupplierQualificationWithDetails | undefined> {
    const sq = this.supplierQualificationsMap.get(id);
    if (!sq) return undefined;
    return this.enrichSupplierQualification(sq);
  }

  async createSupplierQualification(data: InsertSupplierQualification): Promise<SupplierQualification> {
    const now = new Date();
    const sq: SupplierQualification = {
      id: randomUUID(),
      supplierId: data.supplierId,
      qualificationDate: data.qualificationDate ?? null,
      qualificationMethod: data.qualificationMethod ?? null,
      qualifiedBy: data.qualifiedBy ?? null,
      approvedBy: data.approvedBy ?? null,
      lastRequalificationDate: data.lastRequalificationDate ?? null,
      nextRequalificationDue: data.nextRequalificationDue ?? null,
      requalificationFrequency: data.requalificationFrequency ?? null,
      status: data.status ?? "PENDING",
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.supplierQualificationsMap.set(sq.id, sq);
    return sq;
  }

  async updateSupplierQualification(id: string, data: Partial<InsertSupplierQualification>): Promise<SupplierQualification | undefined> {
    const existing = this.supplierQualificationsMap.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date() } as SupplierQualification;
    this.supplierQualificationsMap.set(id, updated);
    return updated;
  }

  // ─── Batch Production Records ──────────────────────────

  private enrichBpr(bpr: BatchProductionRecord): BprWithDetails {
    const product = this.products.get(bpr.productId);
    const steps = Array.from(this.bprStepsMap.values())
      .filter(s => s.bprId === bpr.id)
      .sort((a, b) => parseFloat(a.stepNumber) - parseFloat(b.stepNumber));
    const deviations = Array.from(this.bprDeviationsMap.values())
      .filter(d => d.bprId === bpr.id)
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    return {
      ...bpr,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "",
      steps,
      deviations,
    };
  }

  async getBprs(filters?: { status?: string; productionBatchId?: string }): Promise<BprWithDetails[]> {
    let bprs = Array.from(this.bprMap.values());
    if (filters?.status) {
      bprs = bprs.filter(b => b.status === filters.status);
    }
    if (filters?.productionBatchId) {
      bprs = bprs.filter(b => b.productionBatchId === filters.productionBatchId);
    }
    bprs.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    return bprs.map(b => this.enrichBpr(b));
  }

  async getBpr(id: string): Promise<BprWithDetails | undefined> {
    const bpr = this.bprMap.get(id);
    if (!bpr) return undefined;
    return this.enrichBpr(bpr);
  }

  async getBprByBatchId(productionBatchId: string): Promise<BprWithDetails | undefined> {
    const bpr = Array.from(this.bprMap.values()).find(b => b.productionBatchId === productionBatchId);
    if (!bpr) return undefined;
    return this.enrichBpr(bpr);
  }

  async createBpr(data: InsertBpr): Promise<BatchProductionRecord> {
    const id = randomUUID();
    const now = new Date();
    const bpr: BatchProductionRecord = {
      id,
      productionBatchId: data.productionBatchId,
      batchNumber: data.batchNumber,
      lotNumber: data.lotNumber ?? null,
      productId: data.productId,
      recipeId: data.recipeId ?? null,
      status: data.status ?? "IN_PROGRESS",
      theoreticalYield: data.theoreticalYield ?? null,
      actualYield: data.actualYield ?? null,
      yieldPercentage: data.yieldPercentage ?? null,
      yieldMinThreshold: data.yieldMinThreshold ?? null,
      yieldMaxThreshold: data.yieldMaxThreshold ?? null,
      yieldDeviation: data.yieldDeviation ?? null,
      processingLines: data.processingLines ?? null,
      cleaningVerified: data.cleaningVerified ?? null,
      cleaningVerifiedBy: data.cleaningVerifiedBy ?? null,
      cleaningVerifiedAt: data.cleaningVerifiedAt ?? null,
      cleaningRecordReference: data.cleaningRecordReference ?? null,
      qcReviewedBy: data.qcReviewedBy ?? null,
      qcReviewedAt: data.qcReviewedAt ?? null,
      qcDisposition: data.qcDisposition ?? null,
      qcNotes: data.qcNotes ?? null,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.bprMap.set(id, bpr);
    return bpr;
  }

  async updateBpr(id: string, data: Partial<InsertBpr>): Promise<BatchProductionRecord | undefined> {
    const existing = this.bprMap.get(id);
    if (!existing) return undefined;
    if (existing.status !== "IN_PROGRESS") {
      throw new Error("BPR can only be updated while IN_PROGRESS");
    }
    const updated: BatchProductionRecord = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.bprMap.set(id, updated);
    return updated;
  }

  async submitBprForReview(id: string): Promise<BatchProductionRecord | undefined> {
    const existing = this.bprMap.get(id);
    if (!existing) return undefined;
    if (existing.status !== "IN_PROGRESS") {
      throw new Error("BPR can only be submitted for review while IN_PROGRESS");
    }
    const updated: BatchProductionRecord = {
      ...existing,
      status: "PENDING_QC_REVIEW",
      updatedAt: new Date(),
    };
    this.bprMap.set(id, updated);
    return updated;
  }

  async qcReviewBpr(id: string, disposition: string, reviewedBy: string, notes?: string): Promise<BatchProductionRecord | undefined> {
    const existing = this.bprMap.get(id);
    if (!existing) return undefined;
    if (existing.status !== "PENDING_QC_REVIEW") {
      throw new Error("BPR must be in PENDING_QC_REVIEW status for QC review");
    }
    const isApproved = disposition === "APPROVED_FOR_DISTRIBUTION" || disposition === "APPROVED";
    const updated: BatchProductionRecord = {
      ...existing,
      qcReviewedBy: reviewedBy,
      qcReviewedAt: new Date(),
      qcDisposition: disposition,
      qcNotes: notes ?? existing.qcNotes,
      status: isApproved ? "APPROVED" : "REJECTED",
      completedAt: isApproved ? new Date() : existing.completedAt,
      updatedAt: new Date(),
    };
    this.bprMap.set(id, updated);
    return updated;
  }

  async addBprStep(bprId: string, data: InsertBprStep): Promise<BprStep> {
    const bpr = this.bprMap.get(bprId);
    if (!bpr) throw new Error("BPR not found");
    if (bpr.status !== "IN_PROGRESS") {
      throw new Error("Steps can only be added while BPR is IN_PROGRESS");
    }
    const id = randomUUID();
    const step: BprStep = {
      id,
      bprId,
      stepNumber: data.stepNumber,
      stepDescription: data.stepDescription,
      performedBy: data.performedBy ?? null,
      performedAt: data.performedAt ?? null,
      verifiedBy: data.verifiedBy ?? null,
      verifiedAt: data.verifiedAt ?? null,
      componentId: data.componentId ?? null,
      componentLotId: data.componentLotId ?? null,
      targetWeightMeasure: data.targetWeightMeasure ?? null,
      actualWeightMeasure: data.actualWeightMeasure ?? null,
      uom: data.uom ?? null,
      weighedBy: data.weighedBy ?? null,
      weightVerifiedBy: data.weightVerifiedBy ?? null,
      addedBy: data.addedBy ?? null,
      additionVerifiedBy: data.additionVerifiedBy ?? null,
      monitoringResults: data.monitoringResults ?? null,
      testResults: data.testResults ?? null,
      testReference: data.testReference ?? null,
      notes: data.notes ?? null,
      status: data.status ?? "PENDING",
      createdAt: new Date(),
    };
    this.bprStepsMap.set(id, step);
    return step;
  }

  async updateBprStep(bprId: string, stepId: string, data: Partial<InsertBprStep>): Promise<BprStep | undefined> {
    const bpr = this.bprMap.get(bprId);
    if (!bpr) throw new Error("BPR not found");
    if (bpr.status !== "IN_PROGRESS") {
      throw new Error("Steps can only be updated while BPR is IN_PROGRESS");
    }
    const existing = this.bprStepsMap.get(stepId);
    if (!existing || existing.bprId !== bprId) return undefined;

    // Dual verification checks
    const mergedPerformedBy = data.performedBy ?? existing.performedBy;
    const mergedVerifiedBy = data.verifiedBy ?? existing.verifiedBy;
    if (mergedVerifiedBy && mergedPerformedBy && mergedVerifiedBy === mergedPerformedBy) {
      throw new Error("Verification failed: verifiedBy must differ from performedBy");
    }

    const mergedWeighedBy = data.weighedBy ?? existing.weighedBy;
    const mergedWeightVerifiedBy = data.weightVerifiedBy ?? existing.weightVerifiedBy;
    if (mergedWeightVerifiedBy && mergedWeighedBy && mergedWeightVerifiedBy === mergedWeighedBy) {
      throw new Error("Verification failed: weightVerifiedBy must differ from weighedBy");
    }

    const mergedAddedBy = data.addedBy ?? existing.addedBy;
    const mergedAdditionVerifiedBy = data.additionVerifiedBy ?? existing.additionVerifiedBy;
    if (mergedAdditionVerifiedBy && mergedAddedBy && mergedAdditionVerifiedBy === mergedAddedBy) {
      throw new Error("Verification failed: additionVerifiedBy must differ from addedBy");
    }

    const updated: BprStep = {
      ...existing,
      ...data,
      id: existing.id,
      bprId: existing.bprId,
      createdAt: existing.createdAt,
    };
    this.bprStepsMap.set(stepId, updated);
    return updated;
  }

  async addBprDeviation(bprId: string, data: InsertBprDeviation): Promise<BprDeviation> {
    const bpr = this.bprMap.get(bprId);
    if (!bpr) throw new Error("BPR not found");
    const id = randomUUID();
    const deviation: BprDeviation = {
      id,
      bprId,
      bprStepId: data.bprStepId ?? null,
      deviationDescription: data.deviationDescription,
      investigation: data.investigation ?? null,
      impactEvaluation: data.impactEvaluation ?? null,
      correctiveActions: data.correctiveActions ?? null,
      preventiveActions: data.preventiveActions ?? null,
      disposition: data.disposition ?? null,
      scientificRationale: data.scientificRationale ?? null,
      reportedBy: data.reportedBy ?? null,
      reportedAt: data.reportedAt ?? null,
      reviewedBy: data.reviewedBy ?? null,
      reviewedAt: data.reviewedAt ?? null,
      signatureOfReviewer: data.signatureOfReviewer ?? null,
      createdAt: new Date(),
    };
    this.bprDeviationsMap.set(id, deviation);
    return deviation;
  }

  // ─── Auto-seed product categories from product names ──

  async seedProductCategories(): Promise<void> {
    // Only run if no categories exist yet
    if (this.productCategoriesMap.size > 0) return;

    const finishedGoods = Array.from(this.products.values()).filter(p => p.category === "FINISHED_GOOD");
    // Also look at active ingredient names for known keywords
    const activeIngredients = Array.from(this.products.values()).filter(p => p.category === "ACTIVE_INGREDIENT");
    const knownIngredients = activeIngredients.map(p => p.name);

    const categorySet = new Set<string>();

    for (const fg of finishedGoods) {
      const name = fg.name;
      // Check each known ingredient name against the finished good name
      for (const ing of knownIngredients) {
        // Normalize for matching: case-insensitive, check if ingredient name appears in product name
        if (name.toLowerCase().includes(ing.toLowerCase()) && ing.length >= 3) {
          categorySet.add(ing);
        }
      }
    }

    // Create categories and assign to matching products
    for (const catName of categorySet) {
      const cat = await this.createProductCategory({ name: catName });
      for (const fg of finishedGoods) {
        if (fg.name.toLowerCase().includes(catName.toLowerCase())) {
          await this.assignProductCategory(fg.id, cat.id);
        }
      }
    }
  }
}

import { DatabaseStorage } from "./db-storage";

export const storage: IStorage = process.env.DATABASE_URL
  ? new DatabaseStorage()
  : new MemStorage();

// Auto-seed product categories after construction (MemStorage only)
if (!process.env.DATABASE_URL && 'seedProductCategories' in storage) {
  (storage as any).seedProductCategories();
}
