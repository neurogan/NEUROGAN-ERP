import {
  type Product, type InsertProduct,
  type Lot, type InsertLot,
  type Location, type InsertLocation,
  type Transaction, type InsertTransaction,
  type InventoryGrouped,
  type Supplier, type InsertSupplier,
  type PurchaseOrder, type InsertPurchaseOrder,
  type InsertPOLineItem,
  type PurchaseOrderWithDetails,
  type ProductionBatch, type InsertProductionBatch,
  type InsertProductionInput,
  type ProductionBatchWithDetails,
  type InsertRecipe,
  type InsertRecipeLine,
  type RecipeWithDetails,
  type AppSettings, type InsertAppSettings,
  type ProductCategory, type InsertProductCategory,
  type ProductCategoryAssignment,
  type ProductWithCategories,
  type ProductCapacity,
  type ProductionNote, type InsertProductionNote,
  type SupplierDocument, type InsertSupplierDocument,
  type DashboardSupplyChain,
  type ReceivingRecord, type InsertReceivingRecord, type ReceivingRecordWithDetails,
  type CoaDocument, type InsertCoaDocument, type CoaDocumentWithDetails,
  type SupplierQualification, type InsertSupplierQualification, type SupplierQualificationWithDetails,
  type BatchProductionRecord, type InsertBpr, type BprStep, type InsertBprStep,
  type BprDeviation, type InsertBprDeviation, type BprWithDetails,
  type User, type UserResponse, type UserRole, type UserStatus,
  type AuditRow,
  type SignatureRow,
  type Lab, type InsertLab,
  type ApprovedMaterial,
} from "@shared/schema";
import type { Tx } from "./db";

export interface ApprovedMaterialWithDetails {
  id: string;
  productId: string;
  productName: string | null;
  productSku: string | null;
  supplierId: string;
  supplierName: string | null;
  approvedByUserId: string;
  approvedByName: string | null;
  approvedAt: Date;
  notes: string | null;
  isActive: boolean;
}

// F-01: createUser takes the server-generated passwordHash (see
// server/auth/password.ts) and the initial role list atomically. The caller
// is responsible for setting createdByUserId and grantedByUserId from
// req.user.id per AGENTS.md §4.4's "no identity from the body" rule.
export interface CreateUserInput {
  email: string;
  fullName: string;
  title?: string | null;
  passwordHash: string;
  roles: readonly UserRole[];
  createdByUserId: string | null;
  grantedByUserId: string | null;
}

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
  createLot(data: InsertLot, tx?: Tx): Promise<Lot>;
  updateLot(id: string, data: Partial<InsertLot>, tx?: Tx): Promise<Lot | undefined>;

  // Locations
  getLocations(): Promise<Location[]>;
  getLocation(id: string): Promise<Location | undefined>;
  createLocation(data: InsertLocation): Promise<Location>;
  updateLocation(id: string, data: Partial<InsertLocation>): Promise<Location | undefined>;
  deleteLocation(id: string): Promise<boolean>;

  // Transactions
  getTransactions(filters?: TransactionFilters): Promise<TransactionWithDetails[]>;
  createTransaction(data: InsertTransaction, tx?: Tx): Promise<Transaction>;

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
  createReceivingRecord(data: InsertReceivingRecord, tx?: Tx): Promise<ReceivingRecord>;
  updateReceivingRecord(id: string, data: Partial<InsertReceivingRecord>, tx?: Tx): Promise<ReceivingRecord | undefined>;
  qcReviewReceivingRecord(id: string, disposition: string, reviewedByUserId: string, notes?: string, tx?: Tx): Promise<ReceivingRecord | undefined>;
  getNextReceivingIdentifier(): Promise<string>;
  getQuarantinedLots(): Promise<ReceivingRecordWithDetails[]>;

  // COA Documents
  getCoaDocuments(filters?: { lotId?: string; productionBatchId?: string; sourceType?: string; overallResult?: string }): Promise<CoaDocumentWithDetails[]>;
  getCoaDocument(id: string): Promise<CoaDocumentWithDetails | undefined>;
  createCoaDocument(data: InsertCoaDocument, tx?: Tx): Promise<CoaDocument>;
  updateCoaDocument(id: string, data: Partial<InsertCoaDocument>, tx?: Tx): Promise<CoaDocument | undefined>;
  qcReviewCoa(id: string, accepted: boolean, reviewedByUserId: string, notes?: string, tx?: Tx): Promise<CoaDocument | undefined>;
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
  createBpr(data: InsertBpr, tx?: Tx): Promise<BatchProductionRecord>;
  updateBpr(id: string, data: Partial<InsertBpr>, tx?: Tx): Promise<BatchProductionRecord | undefined>;
  submitBprForReview(id: string, tx?: Tx): Promise<BatchProductionRecord | undefined>;
  qcReviewBpr(id: string, disposition: string, reviewedByUserId: string, notes?: string, tx?: Tx): Promise<BatchProductionRecord | undefined>;

  // BPR Steps
  addBprStep(bprId: string, data: InsertBprStep): Promise<BprStep>;
  updateBprStep(bprId: string, stepId: string, data: Partial<InsertBprStep>): Promise<BprStep | undefined>;

  // BPR Deviations
  addBprDeviation(bprId: string, data: InsertBprDeviation): Promise<BprDeviation>;

  // ─── Users & Roles (F-01) ──────────────────────────────────
  //
  // listUsers / getUserById return UserResponse (no passwordHash). Only
  // getUserByEmail returns the full User, for login flow use only; routes
  // must never expose passwordHash.
  listUsers(): Promise<UserResponse[]>;
  getUserById(id: string): Promise<UserResponse | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(data: CreateUserInput, tx?: Tx): Promise<UserResponse>;
  updateUserStatus(id: string, status: UserStatus, tx?: Tx): Promise<UserResponse | undefined>;
  setUserRoles(
    userId: string,
    nextRoles: readonly UserRole[],
    grantedByUserId: string,
    tx?: Tx,
  ): Promise<UserResponse | undefined>;
  // True iff `userId` holds the ADMIN role, their status is ACTIVE, and no
  // OTHER user currently has an active ADMIN role. Route layer checks this
  // before any operation that could remove the final administrator.
  isLastActiveAdmin(userId: string): Promise<boolean>;

  // ─── Auth helpers (F-02) ──────────────────────────────────
  //
  // recordFailedLogin increments failedLoginCount; at threshold 5 it also sets
  // lockedUntil = now + 30 min. Returns the updated lockout state so the login
  // route can return 423 with a lockedUntil timestamp.
  recordFailedLogin(userId: string): Promise<{ lockedUntil: Date | null }>;

  // recordSuccessfulLogin resets failedLoginCount to 0 and clears lockedUntil.
  recordSuccessfulLogin(userId: string): Promise<void>;

  // rotatePassword replaces passwordHash + resets passwordChangedAt to now +
  // failedLoginCount to 0 + clears lockedUntil. The old hash is appended to
  // password history before the update.
  rotatePassword(userId: string, newHash: string, tx?: Tx): Promise<UserResponse | undefined>;

  // Returns up to `limit` previous password hashes for the user, newest first,
  // for reuse checking. Includes the current passwordHash from erp_users.
  getPasswordHistory(userId: string, limit: number): Promise<string[]>;

  // ─── Audit trail (F-03) ───────────────────────────────────
  listAuditRows(filters: AuditFilters, cursor?: string, limit?: number): Promise<{ rows: (AuditRow & { actorName: string | null; actorEmail: string | null })[]; nextCursor: string | null }>;

  // ─── Electronic signatures (F-04) ─────────────────────────
  listSignatures(entityType: string, entityId: string): Promise<SignatureRow[]>;

  // ─── Labs registry (R-01) ──────────────────────────────
  listLabs(): Promise<Lab[]>;
  createLab(data: InsertLab): Promise<Lab>;
  updateLab(id: string, data: Partial<InsertLab>): Promise<Lab | undefined>;

  // ─── Approved materials registry (R-01) ────────────────
  listApprovedMaterials(): Promise<ApprovedMaterialWithDetails[]>;
  revokeApprovedMaterial(id: string): Promise<ApprovedMaterial | undefined>;
  isApprovedMaterial(productId: string, supplierId: string): Promise<boolean>;
  createApprovedMaterial(productId: string, supplierId: string, approvedByUserId: string, notes?: string, tx?: Tx): Promise<ApprovedMaterial>;
}

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

// DATABASE_URL is required. The legacy MemStorage fallback was removed —
// it had no persistence, no audit trail, and no attribution, which makes it
// fundamentally incompatible with 21 CFR §111.180 records retention and every
// Part 11 control (see FDA/AGENTS.md §4.4 and FDA/erp-gap-analysis-and-roadmap.md §4.1).
//
// The check is deferred to first storage-method access via a Proxy so that
// vitest can import this module (and anything that depends on it) without
// booting against a real DB. The spec D-09 "no-migrations-on-boot" rule
// implies booting the server should be side-effect-light; this matches.

import { DatabaseStorage } from "./db-storage";

let _instance: IStorage | null = null;
function getStorage(): IStorage {
  if (_instance) return _instance;
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. For local dev, see AGENTS.md §2 " +
        "(cp .env.example .env.local, then fill in DATABASE_URL). For Railway " +
        "deploys, ensure the Postgres service is linked to this environment " +
        "(both staging and production have it — check railway.json).",
    );
  }
  _instance = new DatabaseStorage();
  return _instance;
}

export const storage: IStorage = new Proxy({} as IStorage, {
  get(_target, prop) {
    return Reflect.get(getStorage(), prop);
  },
});
