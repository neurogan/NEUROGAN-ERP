import { eq, desc, asc, and, sql, gte, lte, inArray, ilike, ne } from "drizzle-orm";
import { db } from "./db";
import * as schema from "@shared/schema";
import { createHash } from "crypto";
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
  // QMS
  type QmsUser, type InsertQmsUser,
  type QmsAuditLog, type InsertQmsAuditLog,
  type QmsSignature, type InsertQmsSignature,
  type QmsLotRelease, type InsertQmsLotRelease, type QmsLotReleaseWithDetails,
  type QmsCapa, type InsertQmsCapa, type QmsCapaWithActions,
  type QmsCapaAction, type InsertQmsCapaAction,
  type QmsComplaint, type InsertQmsComplaint,
  type QmsDashboardStats,
} from "@shared/schema";
import type {
  IStorage,
  TransactionFilters,
  TransactionWithDetails,
  StockByLotLocation,
  FIFOAllocation,
  StockShortage,
  DashboardStats,
  ActiveBatchDetail,
  OpenPODetail,
  LowStockItem,
  InboundPO,
} from "./storage";

export class DatabaseStorage implements IStorage {

  // ─── Products ─────────────────────────────────────────

  async getProducts(): Promise<Product[]> {
    return db.select().from(schema.products).orderBy(asc(schema.products.name));
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const [row] = await db.select().from(schema.products).where(eq(schema.products.id, id));
    return row;
  }

  async createProduct(data: InsertProduct): Promise<Product> {
    const [row] = await db.insert(schema.products).values(data).returning();
    return row;
  }

  async updateProduct(id: string, data: Partial<InsertProduct>): Promise<Product | undefined> {
    const [row] = await db.update(schema.products).set({ ...data, updatedAt: new Date() }).where(eq(schema.products.id, id)).returning();
    return row;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const result = await db.delete(schema.products).where(eq(schema.products.id, id)).returning();
    return result.length > 0;
  }

  // ─── Lots ────────────────────────────────────────────

  async getLots(productId?: string): Promise<Lot[]> {
    if (productId) {
      return db.select().from(schema.lots).where(eq(schema.lots.productId, productId));
    }
    return db.select().from(schema.lots);
  }

  async getLot(id: string): Promise<Lot | undefined> {
    const [row] = await db.select().from(schema.lots).where(eq(schema.lots.id, id));
    return row;
  }

  async getLotsByProduct(productId: string): Promise<Lot[]> {
    return db.select().from(schema.lots).where(eq(schema.lots.productId, productId));
  }

  async createLot(data: InsertLot): Promise<Lot> {
    const [row] = await db.insert(schema.lots).values(data).returning();
    return row;
  }

  async updateLot(id: string, data: Partial<InsertLot>): Promise<Lot | undefined> {
    const [row] = await db.update(schema.lots).set(data).where(eq(schema.lots.id, id)).returning();
    return row;
  }

  // ─── Locations ───────────────────────────────────────

  async getLocations(): Promise<Location[]> {
    return db.select().from(schema.locations).orderBy(asc(schema.locations.name));
  }

  async getLocation(id: string): Promise<Location | undefined> {
    const [row] = await db.select().from(schema.locations).where(eq(schema.locations.id, id));
    return row;
  }

  async createLocation(data: InsertLocation): Promise<Location> {
    const [row] = await db.insert(schema.locations).values(data).returning();
    return row;
  }

  async updateLocation(id: string, data: Partial<InsertLocation>): Promise<Location | undefined> {
    const [row] = await db.update(schema.locations).set(data).where(eq(schema.locations.id, id)).returning();
    return row;
  }

  async deleteLocation(id: string): Promise<boolean> {
    const result = await db.delete(schema.locations).where(eq(schema.locations.id, id)).returning();
    return result.length > 0;
  }

  // ─── Transactions ────────────────────────────────────

  async getTransactions(filters?: TransactionFilters): Promise<TransactionWithDetails[]> {
    const conditions: any[] = [];

    if (filters?.lotId) {
      conditions.push(eq(schema.transactions.lotId, filters.lotId));
    }
    if (filters?.type) {
      conditions.push(eq(schema.transactions.type, filters.type));
    }
    if (filters?.productionBatchId) {
      conditions.push(eq(schema.transactions.productionBatchId, filters.productionBatchId));
    }
    if (filters?.productId) {
      const productLots = await db.select({ id: schema.lots.id }).from(schema.lots).where(eq(schema.lots.productId, filters.productId));
      const lotIds = productLots.map(l => l.id);
      if (lotIds.length === 0) return [];
      conditions.push(inArray(schema.transactions.lotId, lotIds));
    }
    if (filters?.dateFrom) {
      conditions.push(gte(schema.transactions.createdAt, new Date(filters.dateFrom)));
    }
    if (filters?.dateTo) {
      conditions.push(lte(schema.transactions.createdAt, new Date(filters.dateTo)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const txns = await db
      .select()
      .from(schema.transactions)
      .where(whereClause)
      .orderBy(desc(schema.transactions.createdAt));

    // Enrich with product name, lot number, location name
    const result: TransactionWithDetails[] = [];
    for (const t of txns) {
      const lot = await this.getLot(t.lotId);
      const product = lot ? await this.getProduct(lot.productId) : undefined;
      const location = await this.getLocation(t.locationId);
      result.push({
        ...t,
        productId: lot?.productId ?? "",
        productName: product?.name ?? "Unknown",
        lotNumber: lot?.lotNumber ?? "Unknown",
        locationName: location?.name ?? "Unknown",
      });
    }
    return result;
  }

  async createTransaction(data: InsertTransaction): Promise<Transaction> {
    const [row] = await db.insert(schema.transactions).values(data).returning();
    return row;
  }

  // ─── Inventory ───────────────────────────────────────

  async getInventory(): Promise<InventoryGrouped[]> {
    // Sum quantities by lotId + locationId from transactions
    const rows = await db
      .select({
        lotId: schema.transactions.lotId,
        locationId: schema.transactions.locationId,
        uom: schema.transactions.uom,
        totalQty: sql<string>`sum(${schema.transactions.quantity}::numeric)`,
      })
      .from(schema.transactions)
      .groupBy(schema.transactions.lotId, schema.transactions.locationId, schema.transactions.uom);

    const productMap = new Map<string, InventoryGrouped>();

    for (const row of rows) {
      const qty = parseFloat(row.totalQty);
      if (qty <= 0) continue;

      const lot = await this.getLot(row.lotId);
      if (!lot) continue;
      const product = await this.getProduct(lot.productId);
      if (!product) continue;
      const location = await this.getLocation(row.locationId);
      if (!location) continue;

      const uom = row.uom ?? product.defaultUom;

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

      let lotEntry = productEntry.lots.find(l => l.lotId === row.lotId);
      if (!lotEntry) {
        lotEntry = {
          lotId: row.lotId,
          lotNumber: lot.lotNumber,
          supplierName: lot.supplierName,
          expirationDate: lot.expirationDate,
          locations: [],
          totalQuantity: 0,
        };
        productEntry.lots.push(lotEntry);
      }

      lotEntry.locations.push({
        locationId: row.locationId,
        locationName: location.name,
        quantity: qty,
        uom,
      });

      lotEntry.totalQuantity += qty;
      productEntry.totalQuantity += qty;
    }

    return Array.from(productMap.values());
  }

  // ─── Suppliers ───────────────────────────────────────

  async getSuppliers(): Promise<Supplier[]> {
    return db.select().from(schema.suppliers).orderBy(asc(schema.suppliers.name));
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    const [row] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
    return row;
  }

  async createSupplier(data: InsertSupplier): Promise<Supplier> {
    const [row] = await db.insert(schema.suppliers).values(data).returning();
    return row;
  }

  async updateSupplier(id: string, data: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const [row] = await db.update(schema.suppliers).set(data).where(eq(schema.suppliers.id, id)).returning();
    return row;
  }

  async deleteSupplier(id: string): Promise<boolean> {
    const result = await db.delete(schema.suppliers).where(eq(schema.suppliers.id, id)).returning();
    return result.length > 0;
  }

  // ─── Purchase Orders ─────────────────────────────────

  private async enrichPO(po: PurchaseOrder): Promise<PurchaseOrderWithDetails> {
    const supplier = await this.getSupplier(po.supplierId);
    const lineItemRows = await db.select().from(schema.poLineItems).where(eq(schema.poLineItems.purchaseOrderId, po.id));
    const lineItems: POLineItemWithProduct[] = [];
    for (const li of lineItemRows) {
      const product = await this.getProduct(li.productId);
      lineItems.push({
        ...li,
        productName: product?.name ?? "Unknown",
        productSku: product?.sku ?? "Unknown",
      });
    }
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
    const conditions: any[] = [];
    if (filters?.status) conditions.push(eq(schema.purchaseOrders.status, filters.status));
    if (filters?.supplierId) conditions.push(eq(schema.purchaseOrders.supplierId, filters.supplierId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const pos = await db.select().from(schema.purchaseOrders).where(whereClause).orderBy(desc(schema.purchaseOrders.createdAt));
    return Promise.all(pos.map(po => this.enrichPO(po)));
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrderWithDetails | undefined> {
    const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
    if (!po) return undefined;
    return this.enrichPO(po);
  }

  async createPurchaseOrder(data: InsertPurchaseOrder, lineItems: Omit<InsertPOLineItem, "purchaseOrderId">[]): Promise<PurchaseOrderWithDetails> {
    const [po] = await db.insert(schema.purchaseOrders).values(data).returning();
    for (const li of lineItems) {
      await db.insert(schema.poLineItems).values({ ...li, purchaseOrderId: po.id });
    }
    return this.enrichPO(po);
  }

  async updatePurchaseOrder(id: string, data: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const [row] = await db.update(schema.purchaseOrders).set({ ...data, updatedAt: new Date() }).where(eq(schema.purchaseOrders.id, id)).returning();
    return row;
  }

  async updatePurchaseOrderStatus(id: string, status: string): Promise<PurchaseOrder | undefined> {
    const [row] = await db.update(schema.purchaseOrders).set({ status, updatedAt: new Date() }).where(eq(schema.purchaseOrders.id, id)).returning();
    return row;
  }

  // ─── PO Receiving ────────────────────────────────────

  async receivePOLineItem(
    lineItemId: string,
    quantity: number,
    lotNumber: string,
    locationId: string,
    supplierName?: string,
    expirationDate?: string,
    receivedDate?: string,
  ): Promise<{ lot: Lot; transaction: Transaction }> {
    const [lineItem] = await db.select().from(schema.poLineItems).where(eq(schema.poLineItems.id, lineItemId));
    if (!lineItem) throw new Error("Line item not found");

    const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, lineItem.purchaseOrderId));
    if (!po) throw new Error("Purchase order not found");

    const product = await this.getProduct(lineItem.productId);
    if (!product) throw new Error("Product not found");

    const supplier = await this.getSupplier(po.supplierId);

    // Create lot
    const lot = await this.createLot({
      productId: lineItem.productId,
      lotNumber,
      supplierName: supplierName ?? supplier?.name ?? null,
      receivedDate: receivedDate ?? new Date().toISOString().slice(0, 10),
      expirationDate: expirationDate ?? null,
      poReference: po.poNumber,
      quarantineStatus: "QUARANTINED",
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

    // Auto-create receiving record
    const rcvId = await this.getNextReceivingIdentifier();
    await this.createReceivingRecord({
      purchaseOrderId: po.id,
      lotId: lot.id,
      uniqueIdentifier: rcvId,
      dateReceived: receivedDate ?? new Date().toISOString().slice(0, 10),
      quantityReceived: String(quantity),
      uom: lineItem.uom,
      supplierLotNumber: lotNumber,
      status: "QUARANTINED",
    });

    // Update line item received quantity
    const newReceived = parseFloat(lineItem.quantityReceived) + Math.abs(quantity);
    await db.update(schema.poLineItems).set({ quantityReceived: String(newReceived) }).where(eq(schema.poLineItems.id, lineItemId));

    // Auto-update PO status
    const allLineItems = await db.select().from(schema.poLineItems).where(eq(schema.poLineItems.purchaseOrderId, po.id));
    const allFullyReceived = allLineItems.every(
      li => parseFloat(li.quantityReceived) >= parseFloat(li.quantityOrdered)
    );
    // Re-check after update
    const updatedLineItems = await db.select().from(schema.poLineItems).where(eq(schema.poLineItems.purchaseOrderId, po.id));
    const allFull = updatedLineItems.every(
      li => parseFloat(li.quantityReceived) >= parseFloat(li.quantityOrdered)
    );
    const someReceived = updatedLineItems.some(
      li => parseFloat(li.quantityReceived) > 0
    );

    if (allFull) {
      await this.updatePurchaseOrderStatus(po.id, "CLOSED");
    } else if (someReceived) {
      await this.updatePurchaseOrderStatus(po.id, "PARTIALLY_RECEIVED");
    }

    return { lot, transaction };
  }

  // ─── Production Batches ──────────────────────────────

  private async enrichBatch(batch: ProductionBatch): Promise<ProductionBatchWithDetails> {
    const product = await this.getProduct(batch.productId);
    const inputRows = await db.select().from(schema.productionInputs).where(eq(schema.productionInputs.batchId, batch.id));
    const inputs: ProductionInputWithDetails[] = [];
    for (const pi of inputRows) {
      const inputProduct = await this.getProduct(pi.productId);
      const lot = await this.getLot(pi.lotId);
      const location = await this.getLocation(pi.locationId);
      inputs.push({
        ...pi,
        productName: inputProduct?.name ?? "Unknown",
        productSku: inputProduct?.sku ?? "Unknown",
        lotNumber: lot?.lotNumber ?? "Unknown",
        locationName: location?.name ?? "Unknown",
      });
    }
    return {
      ...batch,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "Unknown",
      inputs,
    };
  }

  async getProductionBatches(filters?: { status?: string }): Promise<ProductionBatchWithDetails[]> {
    const conditions: any[] = [];
    if (filters?.status) conditions.push(eq(schema.productionBatches.status, filters.status));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const batches = await db.select().from(schema.productionBatches).where(whereClause).orderBy(desc(schema.productionBatches.createdAt));
    return Promise.all(batches.map(b => this.enrichBatch(b)));
  }

  async getProductionBatch(id: string): Promise<ProductionBatchWithDetails | undefined> {
    const [batch] = await db.select().from(schema.productionBatches).where(eq(schema.productionBatches.id, id));
    if (!batch) return undefined;
    return this.enrichBatch(batch);
  }

  async createProductionBatch(data: InsertProductionBatch, inputs: Omit<InsertProductionInput, "batchId">[]): Promise<ProductionBatchWithDetails> {
    // Validate batch number uniqueness
    const [existingBatch] = await db.select().from(schema.productionBatches).where(eq(schema.productionBatches.batchNumber, data.batchNumber));
    if (existingBatch) {
      throw new Error(`Batch number ${data.batchNumber} already exists. Please use a unique batch number.`);
    }

    // Validate all input lots are approved (not quarantined)
    for (const input of inputs) {
      const lot = await this.getLot(input.lotId);
      if (lot && lot.quarantineStatus && lot.quarantineStatus !== "APPROVED") {
        throw new Error(`Lot ${lot.lotNumber} is ${lot.quarantineStatus} and cannot be used in production. Only APPROVED lots can be used.`);
      }
    }

    const [batch] = await db.insert(schema.productionBatches).values(data).returning();

    for (const input of inputs) {
      let lotId = input.lotId;
      let locationId = input.locationId;

      const inputProduct = await this.getProduct(input.productId);
      if (inputProduct?.category === "SECONDARY_PACKAGING") {
        if (!lotId) {
          const existingNoLots = await db.select().from(schema.lots).where(and(eq(schema.lots.productId, input.productId), eq(schema.lots.lotNumber, "NO-LOT")));
          if (existingNoLots.length > 0) {
            lotId = existingNoLots[0].id;
          } else {
            const noLot = await this.createLot({ productId: input.productId, lotNumber: "NO-LOT" });
            lotId = noLot.id;
          }
        }
        if (!locationId) {
          const locs = await db.select().from(schema.locations).limit(1);
          locationId = locs[0]?.id ?? "";
        }
      }

      await db.insert(schema.productionInputs).values({
        batchId: batch.id,
        productId: input.productId,
        lotId,
        locationId,
        quantityUsed: input.quantityUsed,
        uom: input.uom,
      });
    }

    return this.enrichBatch(batch);
  }

  async updateProductionBatch(id: string, data: Partial<InsertProductionBatch>, inputs?: Omit<InsertProductionInput, "batchId">[]): Promise<ProductionBatch | undefined> {
    const [existing] = await db.select().from(schema.productionBatches).where(eq(schema.productionBatches.id, id));
    if (!existing) return undefined;

    // If transitioning to IN_PROGRESS, validate all input lots are approved
    if (data.status === "IN_PROGRESS" && existing.status !== "IN_PROGRESS") {
      const batchInputs = await db.select().from(schema.productionInputs).where(eq(schema.productionInputs.batchId, id));
      for (const input of batchInputs) {
        const lot = await this.getLot(input.lotId);
        if (lot && lot.quarantineStatus && lot.quarantineStatus !== "APPROVED") {
          throw new Error(`Lot ${lot.lotNumber} is ${lot.quarantineStatus} and cannot be used in production. Only APPROVED lots can be used.`);
        }
      }
    }

    // If new inputs are provided, validate they are all approved
    if (inputs) {
      for (const input of inputs) {
        const lot = await this.getLot(input.lotId);
        if (lot && lot.quarantineStatus && lot.quarantineStatus !== "APPROVED") {
          throw new Error(`Lot ${lot.lotNumber} is ${lot.quarantineStatus} and cannot be used in production. Only APPROVED lots can be used.`);
        }
      }
    }

    const [updated] = await db.update(schema.productionBatches).set({ ...data, updatedAt: new Date() }).where(eq(schema.productionBatches.id, id)).returning();

    if (inputs) {
      // Delete old inputs
      await db.delete(schema.productionInputs).where(eq(schema.productionInputs.batchId, id));
      // Create new inputs
      for (const input of inputs) {
        let lotId = input.lotId;
        let locationId = input.locationId;

        const inputProduct = await this.getProduct(input.productId);
        if (inputProduct?.category === "SECONDARY_PACKAGING") {
          if (!lotId) {
            const existingNoLots = await db.select().from(schema.lots).where(and(eq(schema.lots.productId, input.productId), eq(schema.lots.lotNumber, "NO-LOT")));
            if (existingNoLots.length > 0) {
              lotId = existingNoLots[0].id;
            } else {
              const noLot = await this.createLot({ productId: input.productId, lotNumber: "NO-LOT" });
              lotId = noLot.id;
            }
          }
          if (!locationId) {
            const locs = await db.select().from(schema.locations).limit(1);
            locationId = locs[0]?.id ?? "";
          }
        }

        await db.insert(schema.productionInputs).values({
          batchId: id,
          productId: input.productId,
          lotId,
          locationId,
          quantityUsed: input.quantityUsed,
          uom: input.uom,
        });
      }
    }

    // Auto-create BPR when batch starts production
    if (data.status === "IN_PROGRESS") {
      const existingBpr = await this.getBprByBatchId(id);
      if (!existingBpr) {
        const batch = updated;
        const recipeRows = await db.select().from(schema.recipes).where(eq(schema.recipes.productId, batch.productId));
        const recipe = recipeRows[0];
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
    const [batch] = await db.select().from(schema.productionBatches).where(eq(schema.productionBatches.id, id));
    if (!batch) return false;
    if (batch.status !== "DRAFT") return false;
    await db.delete(schema.productionInputs).where(eq(schema.productionInputs.batchId, id));
    const result = await db.delete(schema.productionBatches).where(eq(schema.productionBatches.id, id)).returning();
    return result.length > 0;
  }

  async getNextBatchNumber(): Promise<string> {
    const batches = await db.select({ batchNumber: schema.productionBatches.batchNumber }).from(schema.productionBatches);
    let max = 0;
    for (const b of batches) {
      const match = b.batchNumber.match(/^BATCH-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) max = num;
      }
    }
    return `BATCH-${String(max + 1).padStart(3, "0")}`;
  }

  async getNextOutputLotNumber(): Promise<string> {
    const settings = await this.getSettings();
    const prefix = settings.fgLotNumberPrefix ?? "FG";
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    let max = 0;

    const batches = await db.select({ outputLotNumber: schema.productionBatches.outputLotNumber }).from(schema.productionBatches);
    for (const b of batches) {
      if (b.outputLotNumber) {
        const match = b.outputLotNumber.match(pattern);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > max) max = num;
        }
      }
    }

    const allLots = await db.select({ lotNumber: schema.lots.lotNumber }).from(schema.lots);
    for (const lot of allLots) {
      const match = lot.lotNumber.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) max = num;
      }
    }

    return `${prefix}-${String(max + 1).padStart(3, "0")}`;
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
    const [batch] = await db.select().from(schema.productionBatches).where(eq(schema.productionBatches.id, id));
    if (!batch) throw new Error("Production batch not found");

    // Stock validation
    const inputs = await db.select().from(schema.productionInputs).where(eq(schema.productionInputs.batchId, id));
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
    const [updated] = await db.update(schema.productionBatches).set({
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
    }).where(eq(schema.productionBatches.id, id)).returning();

    // 2. Create PRODUCTION_CONSUMPTION transactions
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

    // 3. Create output lot with PENDING_QC quarantine status (lot release gate)
    const outputLot = await this.createLot({
      productId: batch.productId,
      lotNumber: outputLotNumber,
      expirationDate: outputExpirationDate ?? null,
      receivedDate: effectiveEndDate,
      quarantineStatus: "PENDING_QC",
      notes: `Produced in batch ${batch.batchNumber}`,
    });

    // 4. Auto-create QMS lot release record for QC review queue
    try {
      const product = await this.getProduct(batch.productId);
      const bpr = await this.getBprByBatchId(id).catch(() => null);
      await db.insert(schema.qmsLotReleases).values({
        lotId: outputLot.id,
        lotNumber: outputLotNumber,
        productName: product?.name ?? "Unknown",
        productSku: product?.sku ?? "UNKNOWN",
        bprId: bpr?.id ?? null,
        status: "PENDING_QC_REVIEW",
      });
    } catch (_e) {
      // Non-fatal — lot release record can be created manually if this fails
    }

    // 5. Create PRODUCTION_OUTPUT transaction only if actualQuantity > 0
    if (actualQuantity > 0) {
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
    }

    return this.enrichBatch(updated);
  }

  // ─── Stock Availability & FIFO ───────────────────────

  async getAvailableStock(productId: string): Promise<StockByLotLocation[]> {
    // Get lot IDs for this product
    // FINISHED_GOOD lots with quarantine_status != 'APPROVED' are excluded (lot release gate)
    const product = await this.getProduct(productId);
    const lotsQuery = db.select().from(schema.lots).where(eq(schema.lots.productId, productId));
    const productLots = (await lotsQuery).filter(l =>
      product?.category !== "FINISHED_GOOD" ||
      (l.quarantineStatus === "APPROVED" || l.quarantineStatus === null || l.quarantineStatus === undefined)
    );
    if (productLots.length === 0) return [];
    const lotIds = productLots.map(l => l.id);

    const rows = await db
      .select({
        lotId: schema.transactions.lotId,
        locationId: schema.transactions.locationId,
        uom: schema.transactions.uom,
        totalQty: sql<string>`sum(${schema.transactions.quantity}::numeric)`,
      })
      .from(schema.transactions)
      .where(inArray(schema.transactions.lotId, lotIds))
      .groupBy(schema.transactions.lotId, schema.transactions.locationId, schema.transactions.uom);

    const lotMap = new Map(productLots.map(l => [l.id, l]));
    const product = await this.getProduct(productId);
    const result: StockByLotLocation[] = [];

    for (const row of rows) {
      const qty = parseFloat(row.totalQty);
      if (qty <= 0) continue;
      const lot = lotMap.get(row.lotId);
      if (!lot) continue;
      const location = await this.getLocation(row.locationId);
      if (!location) continue;
      result.push({
        lotId: row.lotId,
        lotNumber: lot.lotNumber,
        locationId: row.locationId,
        locationName: location.name,
        availableQty: qty,
        expirationDate: lot.expirationDate ?? null,
        uom: row.uom ?? product?.defaultUom ?? "pcs",
      });
    }

    // Sort FIFO: earliest expiration first, nulls last
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
    const requested = new Map<string, number>();

    for (const inp of inputs) {
      const product = await this.getProduct(inp.productId);
      if (product?.category === "SECONDARY_PACKAGING") continue;
      requested.set(inp.productId, (requested.get(inp.productId) ?? 0) + inp.quantity);
    }

    for (const [productId, totalNeeded] of requested.entries()) {
      const stock = await this.getAvailableStock(productId);
      const totalAvailable = stock.reduce((sum, s) => sum + s.availableQty, 0);
      if (totalAvailable < totalNeeded) {
        const product = await this.getProduct(productId);
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
    const [batch] = await db.select().from(schema.productionBatches).where(eq(schema.productionBatches.id, id));
    if (!batch) return false;
    if (batch.status !== "COMPLETED") return false;

    // Find output lot from PRODUCTION_OUTPUT transaction
    const batchTxns = await db.select().from(schema.transactions).where(eq(schema.transactions.productionBatchId, id));
    let outputLotId: string | null = null;
    for (const tx of batchTxns) {
      if (tx.type === "PRODUCTION_OUTPUT") {
        outputLotId = tx.lotId;
      }
    }

    // Delete all transactions linked to this batch
    await db.delete(schema.transactions).where(eq(schema.transactions.productionBatchId, id));

    // Delete the output lot
    if (outputLotId) {
      await db.delete(schema.lots).where(eq(schema.lots.id, outputLotId));
    }

    // Delete production inputs
    await db.delete(schema.productionInputs).where(eq(schema.productionInputs.batchId, id));

    // Delete the batch
    await db.delete(schema.productionBatches).where(eq(schema.productionBatches.id, id));

    return true;
  }

  // ─── Settings ────────────────────────────────────────

  async getSettings(): Promise<AppSettings> {
    const rows = await db.select().from(schema.appSettings).limit(1);
    if (rows.length > 0) return rows[0];
    // Auto-create default settings row
    const [row] = await db.insert(schema.appSettings).values({}).returning();
    return row;
  }

  async updateSettings(data: Partial<InsertAppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const [row] = await db.update(schema.appSettings).set({ ...data, updatedAt: new Date() }).where(eq(schema.appSettings.id, current.id)).returning();
    return row;
  }

  // ─── Dashboard ───────────────────────────────────────

  async getDashboardStats(): Promise<DashboardStats> {
    const recentTxns = await this.getTransactions();
    const inventory = await this.getInventory();
    const settings = await this.getSettings();

    // Active production batches
    const activeBatchStatuses = ["DRAFT", "IN_PROGRESS", "ON_HOLD"];
    const activeBatchRows = await db.select().from(schema.productionBatches).where(
      inArray(schema.productionBatches.status, activeBatchStatuses)
    );
    const activeBatches: ActiveBatchDetail[] = [];
    for (const b of activeBatchRows) {
      const product = await this.getProduct(b.productId);
      activeBatches.push({
        id: b.id,
        batchNumber: b.batchNumber,
        productName: product?.name ?? "Unknown",
        productSku: product?.sku ?? "",
        status: b.status,
        plannedQuantity: b.plannedQuantity,
        outputUom: b.outputUom,
        startedAt: b.startDate ?? (b.updatedAt ? b.updatedAt.toISOString() : null),
        createdAt: b.createdAt ? b.createdAt.toISOString() : new Date().toISOString(),
      });
    }
    activeBatches.sort((a, b) => {
      const order: Record<string, number> = { IN_PROGRESS: 0, ON_HOLD: 1, DRAFT: 2 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    });

    // Open POs
    const openPOStatuses = ["DRAFT", "SUBMITTED", "PARTIALLY_RECEIVED"];
    const openPOList = await db.select().from(schema.purchaseOrders).where(
      inArray(schema.purchaseOrders.status, openPOStatuses)
    );
    const openPOs: OpenPODetail[] = [];
    for (const po of openPOList) {
      const lineItems = await db.select().from(schema.poLineItems).where(eq(schema.poLineItems.purchaseOrderId, po.id));
      const supplier = await this.getSupplier(po.supplierId);
      const materials = [];
      for (const li of lineItems) {
        const prod = await this.getProduct(li.productId);
        materials.push({
          name: prod?.name ?? "Unknown",
          sku: prod?.sku ?? "",
          qtyOrdered: parseFloat(li.quantityOrdered),
          qtyReceived: parseFloat(li.quantityReceived),
          uom: li.uom,
        });
      }
      const totalOrdered = materials.reduce((sum, m) => sum + m.qtyOrdered, 0);
      const totalReceived = materials.reduce((sum, m) => sum + m.qtyReceived, 0);
      openPOs.push({
        id: po.id,
        poNumber: po.poNumber,
        supplierName: supplier?.name ?? "Unknown",
        status: po.status,
        expectedDeliveryDate: po.expectedDeliveryDate,
        materials,
        totalOrdered,
        totalReceived,
      });
    }

    // Low stock
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

  // ─── Recipes ─────────────────────────────────────────

  private async enrichRecipe(recipe: Recipe): Promise<RecipeWithDetails> {
    const product = await this.getProduct(recipe.productId);
    const lineRows = await db.select().from(schema.recipeLines).where(eq(schema.recipeLines.recipeId, recipe.id));
    const lines: RecipeLineWithDetails[] = [];
    for (const line of lineRows) {
      const mat = await this.getProduct(line.productId);
      lines.push({
        ...line,
        productName: mat?.name ?? "Unknown",
        productSku: mat?.sku ?? "",
        productCategory: mat?.category ?? "",
      });
    }
    return {
      ...recipe,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "",
      lines,
    };
  }

  async getRecipes(productId?: string): Promise<RecipeWithDetails[]> {
    const conditions: any[] = [];
    if (productId) conditions.push(eq(schema.recipes.productId, productId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db.select().from(schema.recipes).where(whereClause);
    return Promise.all(rows.map(r => this.enrichRecipe(r)));
  }

  async getRecipe(id: string): Promise<RecipeWithDetails | undefined> {
    const [recipe] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, id));
    if (!recipe) return undefined;
    return this.enrichRecipe(recipe);
  }

  async createRecipe(data: InsertRecipe, lines: Omit<InsertRecipeLine, "recipeId">[]): Promise<RecipeWithDetails> {
    const [recipe] = await db.insert(schema.recipes).values(data).returning();
    for (const line of lines) {
      await db.insert(schema.recipeLines).values({ ...line, recipeId: recipe.id });
    }
    return this.enrichRecipe(recipe);
  }

  async updateRecipe(id: string, data: Partial<InsertRecipe>, lines?: Omit<InsertRecipeLine, "recipeId">[]): Promise<RecipeWithDetails | undefined> {
    const [existing] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, id));
    if (!existing) return undefined;
    const [updated] = await db.update(schema.recipes).set({ ...data, updatedAt: new Date() }).where(eq(schema.recipes.id, id)).returning();
    if (lines) {
      await db.delete(schema.recipeLines).where(eq(schema.recipeLines.recipeId, id));
      for (const line of lines) {
        await db.insert(schema.recipeLines).values({ ...line, recipeId: id });
      }
    }
    return this.enrichRecipe(updated);
  }

  async deleteRecipe(id: string): Promise<boolean> {
    const [existing] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, id));
    if (!existing) return false;
    await db.delete(schema.recipeLines).where(eq(schema.recipeLines.recipeId, id));
    await db.delete(schema.recipes).where(eq(schema.recipes.id, id));
    return true;
  }

  // ─── Product Categories ──────────────────────────────

  async getProductCategories(): Promise<ProductCategory[]> {
    return db.select().from(schema.productCategories).orderBy(asc(schema.productCategories.name));
  }

  async createProductCategory(data: InsertProductCategory): Promise<ProductCategory> {
    // Check for duplicate name (case-insensitive)
    const existing = await db.select().from(schema.productCategories).where(
      sql`lower(${schema.productCategories.name}) = lower(${data.name})`
    );
    if (existing.length > 0) return existing[0];
    const [row] = await db.insert(schema.productCategories).values(data).returning();
    return row;
  }

  async deleteProductCategory(id: string): Promise<boolean> {
    // Remove all assignments for this category
    await db.delete(schema.productCategoryAssignments).where(eq(schema.productCategoryAssignments.categoryId, id));
    const result = await db.delete(schema.productCategories).where(eq(schema.productCategories.id, id)).returning();
    return result.length > 0;
  }

  async getProductCategoryAssignments(productId?: string): Promise<ProductCategoryAssignment[]> {
    if (productId) {
      return db.select().from(schema.productCategoryAssignments).where(eq(schema.productCategoryAssignments.productId, productId));
    }
    return db.select().from(schema.productCategoryAssignments);
  }

  async assignProductCategory(productId: string, categoryId: string): Promise<ProductCategoryAssignment> {
    const existing = await db.select().from(schema.productCategoryAssignments).where(
      and(
        eq(schema.productCategoryAssignments.productId, productId),
        eq(schema.productCategoryAssignments.categoryId, categoryId),
      )
    );
    if (existing.length > 0) return existing[0];
    const [row] = await db.insert(schema.productCategoryAssignments).values({ productId, categoryId }).returning();
    return row;
  }

  async unassignProductCategory(productId: string, categoryId: string): Promise<boolean> {
    const result = await db.delete(schema.productCategoryAssignments).where(
      and(
        eq(schema.productCategoryAssignments.productId, productId),
        eq(schema.productCategoryAssignments.categoryId, categoryId),
      )
    ).returning();
    return result.length > 0;
  }

  async getProductsWithCategories(): Promise<ProductWithCategories[]> {
    const allProducts = await db.select().from(schema.products);
    const allAssignments = await db.select().from(schema.productCategoryAssignments);
    const allCategories = await db.select().from(schema.productCategories);
    const catMap = new Map(allCategories.map(c => [c.id, c]));

    return allProducts.map(p => {
      const assignedCategoryIds = allAssignments
        .filter(a => a.productId === p.id)
        .map(a => a.categoryId);
      const categories = assignedCategoryIds
        .map(cid => catMap.get(cid))
        .filter((c): c is ProductCategory => !!c);
      return { ...p, categories };
    });
  }

  // ─── Production Notes ────────────────────────────────

  async getProductionNotes(batchId: string): Promise<ProductionNote[]> {
    return db.select().from(schema.productionNotes).where(eq(schema.productionNotes.batchId, batchId)).orderBy(asc(schema.productionNotes.createdAt));
  }

  async createProductionNote(data: InsertProductionNote): Promise<ProductionNote> {
    const [row] = await db.insert(schema.productionNotes).values(data).returning();
    return row;
  }

  // ─── Supplier Documents ──────────────────────────────

  async getSupplierDocuments(supplierId: string): Promise<SupplierDocument[]> {
    return db.select().from(schema.supplierDocuments).where(eq(schema.supplierDocuments.supplierId, supplierId)).orderBy(desc(schema.supplierDocuments.uploadedAt));
  }

  async createSupplierDocument(data: InsertSupplierDocument): Promise<SupplierDocument> {
    const [row] = await db.insert(schema.supplierDocuments).values(data).returning();
    return row;
  }

  async deleteSupplierDocument(id: string): Promise<boolean> {
    const result = await db.delete(schema.supplierDocuments).where(eq(schema.supplierDocuments.id, id)).returning();
    return result.length > 0;
  }

  async getSupplierDocument(id: string): Promise<SupplierDocument | undefined> {
    const [row] = await db.select().from(schema.supplierDocuments).where(eq(schema.supplierDocuments.id, id));
    return row;
  }

  // ─── Supply Chain Capacity ───────────────────────────

  async getSupplyChainCapacity(): Promise<ProductCapacity[]> {
    const inventory = await this.getInventory();
    const allProducts = await db.select().from(schema.products);
    const finishedGoods = allProducts.filter(p => p.category === "FINISHED_GOOD");

    // Stock lookup
    const stockMap = new Map<string, number>();
    for (const inv of inventory) {
      stockMap.set(inv.productId, inv.totalQuantity);
    }

    // Inbound PO qty
    const openStatuses = ["DRAFT", "SUBMITTED", "PARTIALLY_RECEIVED"];
    const openPOs = await db.select().from(schema.purchaseOrders).where(inArray(schema.purchaseOrders.status, openStatuses));
    const openPOIds = openPOs.map(po => po.id);
    const inboundMap = new Map<string, number>();
    if (openPOIds.length > 0) {
      const lineItems = await db.select().from(schema.poLineItems).where(inArray(schema.poLineItems.purchaseOrderId, openPOIds));
      for (const li of lineItems) {
        const pending = parseFloat(li.quantityOrdered) - parseFloat(li.quantityReceived);
        if (pending > 0) {
          inboundMap.set(li.productId, (inboundMap.get(li.productId) ?? 0) + pending);
        }
      }
    }

    // Committed stock from active batches
    const activeBatches = await db.select().from(schema.productionBatches).where(
      inArray(schema.productionBatches.status, ["IN_PROGRESS", "ON_HOLD"])
    );
    const activeBatchIds = activeBatches.map(b => b.id);
    const committedMap = new Map<string, number>();
    if (activeBatchIds.length > 0) {
      const activeInputs = await db.select().from(schema.productionInputs).where(inArray(schema.productionInputs.batchId, activeBatchIds));
      for (const input of activeInputs) {
        committedMap.set(input.productId, (committedMap.get(input.productId) ?? 0) + Math.abs(parseFloat(input.quantityUsed)));
      }
    }

    // Category assignments
    const allAssignments = await db.select().from(schema.productCategoryAssignments);
    const allCategories = await db.select().from(schema.productCategories);
    const catMap = new Map(allCategories.map(c => [c.id, c]));

    // All recipes and recipe lines
    const allRecipes = await db.select().from(schema.recipes);
    const allRecipeLines = await db.select().from(schema.recipeLines);

    const results: ProductCapacity[] = [];

    for (const fg of finishedGoods) {
      const assignedCategoryIds = allAssignments
        .filter(a => a.productId === fg.id)
        .map(a => a.categoryId);
      const categories = assignedCategoryIds
        .map(cid => catMap.get(cid))
        .filter((c): c is ProductCategory => !!c);

      const currentFGStock = stockMap.get(fg.id) ?? 0;

      const fgActiveBatches = activeBatches.filter(b => b.productId === fg.id);
      const inProductionUnits = fgActiveBatches.reduce((sum, b) => sum + parseFloat(b.plannedQuantity), 0);
      const activeBatchCount = fgActiveBatches.length;

      const recipe = allRecipes.find(r => r.productId === fg.id);
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

      const lines = allRecipeLines.filter(l => l.recipeId === recipe.id);
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

      const productMap = new Map(allProducts.map(p => [p.id, p]));
      const materials: MaterialCapacity[] = [];
      let minFromStock = Infinity;
      let minFromInbound = Infinity;
      let bottleneckName: string | null = null;

      for (const line of lines) {
        const requiredPerUnit = parseFloat(line.quantity);
        if (requiredPerUnit <= 0) continue;

        const mat = productMap.get(line.productId);
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
          isBottleneck: false,
        });
      }

      const producibleUnits = minFromStock === Infinity ? 0 : minFromStock;
      const inboundProducibleUnits = minFromInbound === Infinity ? 0 : minFromInbound;

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

  // ─── Dashboard Supply Chain ──────────────────────────

  async getDashboardSupplyChain(): Promise<DashboardSupplyChain> {
    const capacity = await this.getSupplyChainCapacity();

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

  // ─── Receiving & Quarantine ──────────────────────────

  private async enrichReceivingRecord(r: ReceivingRecord): Promise<ReceivingRecordWithDetails> {
    const lot = await this.getLot(r.lotId);
    const product = lot ? await this.getProduct(lot.productId) : undefined;
    return {
      ...r,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "",
      lotNumber: lot?.lotNumber ?? "",
      supplierName: lot?.supplierName ?? null,
    };
  }

  async getReceivingRecords(filters?: { status?: string }): Promise<ReceivingRecordWithDetails[]> {
    const conditions: any[] = [];
    if (filters?.status) conditions.push(eq(schema.receivingRecords.status, filters.status));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const records = await db.select().from(schema.receivingRecords).where(whereClause).orderBy(desc(schema.receivingRecords.createdAt));
    return Promise.all(records.map(r => this.enrichReceivingRecord(r)));
  }

  async getReceivingRecord(id: string): Promise<ReceivingRecordWithDetails | undefined> {
    const [r] = await db.select().from(schema.receivingRecords).where(eq(schema.receivingRecords.id, id));
    if (!r) return undefined;
    return this.enrichReceivingRecord(r);
  }

  async createReceivingRecord(data: InsertReceivingRecord): Promise<ReceivingRecord> {
    const [record] = await db.insert(schema.receivingRecords).values(data).returning();

    // Update the lot's quarantine status
    if (data.status) {
      await db.update(schema.lots).set({ quarantineStatus: data.status }).where(eq(schema.lots.id, data.lotId));
    }

    return record;
  }

  async updateReceivingRecord(id: string, data: Partial<InsertReceivingRecord>): Promise<ReceivingRecord | undefined> {
    const [row] = await db.update(schema.receivingRecords).set({ ...data, updatedAt: new Date() }).where(eq(schema.receivingRecords.id, id)).returning();
    return row;
  }

  async qcReviewReceivingRecord(id: string, disposition: string, reviewedBy: string, notes?: string): Promise<ReceivingRecord | undefined> {
    const [existing] = await db.select().from(schema.receivingRecords).where(eq(schema.receivingRecords.id, id));
    if (!existing) return undefined;

    const newStatus = disposition === "APPROVED" || disposition === "APPROVED_WITH_CONDITIONS" ? "APPROVED" : "REJECTED";
    const [updated] = await db.update(schema.receivingRecords).set({
      status: newStatus,
      qcDisposition: disposition,
      qcReviewedBy: reviewedBy,
      qcReviewedAt: new Date(),
      qcNotes: notes ?? existing.qcNotes,
      updatedAt: new Date(),
    }).where(eq(schema.receivingRecords.id, id)).returning();

    // Update the lot's quarantine status
    await db.update(schema.lots).set({ quarantineStatus: newStatus }).where(eq(schema.lots.id, existing.lotId));

    return updated;
  }

  async getNextReceivingIdentifier(): Promise<string> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `RCV-${today}`;
    const existing = await db.select().from(schema.receivingRecords).where(
      sql`${schema.receivingRecords.uniqueIdentifier} LIKE ${prefix + '%'}`
    );
    const seq = existing.length + 1;
    return `RCV-${today}-${String(seq).padStart(3, "0")}`;
  }

  async getQuarantinedLots(): Promise<ReceivingRecordWithDetails[]> {
    return this.getReceivingRecords({ status: "QUARANTINED" });
  }

  // ─── COA Documents ───────────────────────────────────

  private async enrichCoaDocument(coa: CoaDocument): Promise<CoaDocumentWithDetails> {
    const lot = await this.getLot(coa.lotId);
    const product = lot ? await this.getProduct(lot.productId) : undefined;
    return {
      ...coa,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "",
      lotNumber: lot?.lotNumber ?? "",
      supplierName: lot?.supplierName ?? null,
    };
  }

  async getCoaDocuments(filters?: { lotId?: string; productionBatchId?: string; sourceType?: string; overallResult?: string }): Promise<CoaDocumentWithDetails[]> {
    const conditions: any[] = [];
    if (filters?.lotId) conditions.push(eq(schema.coaDocuments.lotId, filters.lotId));
    if (filters?.productionBatchId) conditions.push(eq(schema.coaDocuments.productionBatchId, filters.productionBatchId));
    if (filters?.sourceType) conditions.push(eq(schema.coaDocuments.sourceType, filters.sourceType));
    if (filters?.overallResult) conditions.push(eq(schema.coaDocuments.overallResult, filters.overallResult));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const docs = await db.select().from(schema.coaDocuments).where(whereClause).orderBy(desc(schema.coaDocuments.createdAt));
    return Promise.all(docs.map(d => this.enrichCoaDocument(d)));
  }

  async getCoaDocument(id: string): Promise<CoaDocumentWithDetails | undefined> {
    const [doc] = await db.select().from(schema.coaDocuments).where(eq(schema.coaDocuments.id, id));
    if (!doc) return undefined;
    return this.enrichCoaDocument(doc);
  }

  async createCoaDocument(data: InsertCoaDocument): Promise<CoaDocument> {
    const [row] = await db.insert(schema.coaDocuments).values(data).returning();
    return row;
  }

  async updateCoaDocument(id: string, data: Partial<InsertCoaDocument>): Promise<CoaDocument | undefined> {
    const [row] = await db.update(schema.coaDocuments).set({ ...data, updatedAt: new Date() }).where(eq(schema.coaDocuments.id, id)).returning();
    return row;
  }

  async qcReviewCoa(id: string, accepted: boolean, reviewedBy: string, notes?: string): Promise<CoaDocument | undefined> {
    const [existing] = await db.select().from(schema.coaDocuments).where(eq(schema.coaDocuments.id, id));
    if (!existing) return undefined;
    const [updated] = await db.update(schema.coaDocuments).set({
      qcReviewedBy: reviewedBy,
      qcReviewedAt: new Date(),
      qcAccepted: accepted ? "true" : "false",
      qcNotes: notes ?? existing.qcNotes,
      updatedAt: new Date(),
    }).where(eq(schema.coaDocuments.id, id)).returning();
    return updated;
  }

  async getCoasByLot(lotId: string): Promise<CoaDocumentWithDetails[]> {
    return this.getCoaDocuments({ lotId });
  }

  // ─── Supplier Qualifications ─────────────────────────

  private async enrichSupplierQualification(sq: SupplierQualification): Promise<SupplierQualificationWithDetails> {
    const supplier = await this.getSupplier(sq.supplierId);
    return { ...sq, supplierName: supplier?.name ?? "Unknown" };
  }

  async getSupplierQualifications(supplierId?: string): Promise<SupplierQualificationWithDetails[]> {
    const conditions: any[] = [];
    if (supplierId) conditions.push(eq(schema.supplierQualifications.supplierId, supplierId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db.select().from(schema.supplierQualifications).where(whereClause).orderBy(desc(schema.supplierQualifications.createdAt));
    return Promise.all(rows.map(r => this.enrichSupplierQualification(r)));
  }

  async getSupplierQualification(id: string): Promise<SupplierQualificationWithDetails | undefined> {
    const [sq] = await db.select().from(schema.supplierQualifications).where(eq(schema.supplierQualifications.id, id));
    if (!sq) return undefined;
    return this.enrichSupplierQualification(sq);
  }

  async createSupplierQualification(data: InsertSupplierQualification): Promise<SupplierQualification> {
    const [row] = await db.insert(schema.supplierQualifications).values(data).returning();
    return row;
  }

  async updateSupplierQualification(id: string, data: Partial<InsertSupplierQualification>): Promise<SupplierQualification | undefined> {
    const [row] = await db.update(schema.supplierQualifications).set({ ...data, updatedAt: new Date() }).where(eq(schema.supplierQualifications.id, id)).returning();
    return row;
  }

  // ─── Batch Production Records ────────────────────────

  private async enrichBpr(bpr: BatchProductionRecord): Promise<BprWithDetails> {
    const product = await this.getProduct(bpr.productId);
    const steps = await db.select().from(schema.bprSteps).where(eq(schema.bprSteps.bprId, bpr.id)).orderBy(asc(schema.bprSteps.stepNumber));
    const deviations = await db.select().from(schema.bprDeviations).where(eq(schema.bprDeviations.bprId, bpr.id)).orderBy(asc(schema.bprDeviations.createdAt));
    return {
      ...bpr,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "",
      steps,
      deviations,
    };
  }

  async getBprs(filters?: { status?: string; productionBatchId?: string }): Promise<BprWithDetails[]> {
    const conditions: any[] = [];
    if (filters?.status) conditions.push(eq(schema.batchProductionRecords.status, filters.status));
    if (filters?.productionBatchId) conditions.push(eq(schema.batchProductionRecords.productionBatchId, filters.productionBatchId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db.select().from(schema.batchProductionRecords).where(whereClause).orderBy(desc(schema.batchProductionRecords.createdAt));
    return Promise.all(rows.map(b => this.enrichBpr(b)));
  }

  async getBpr(id: string): Promise<BprWithDetails | undefined> {
    const [bpr] = await db.select().from(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, id));
    if (!bpr) return undefined;
    return this.enrichBpr(bpr);
  }

  async getBprByBatchId(productionBatchId: string): Promise<BprWithDetails | undefined> {
    const [bpr] = await db.select().from(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.productionBatchId, productionBatchId));
    if (!bpr) return undefined;
    return this.enrichBpr(bpr);
  }

  async createBpr(data: InsertBpr): Promise<BatchProductionRecord> {
    const [row] = await db.insert(schema.batchProductionRecords).values(data).returning();
    return row;
  }

  async updateBpr(id: string, data: Partial<InsertBpr>): Promise<BatchProductionRecord | undefined> {
    const [existing] = await db.select().from(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, id));
    if (!existing) return undefined;
    if (existing.status !== "IN_PROGRESS") {
      throw new Error("BPR can only be updated while IN_PROGRESS");
    }
    const [row] = await db.update(schema.batchProductionRecords).set({ ...data, updatedAt: new Date() }).where(eq(schema.batchProductionRecords.id, id)).returning();
    return row;
  }

  async submitBprForReview(id: string): Promise<BatchProductionRecord | undefined> {
    const [existing] = await db.select().from(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, id));
    if (!existing) return undefined;
    if (existing.status !== "IN_PROGRESS") {
      throw new Error("BPR can only be submitted for review while IN_PROGRESS");
    }
    const [row] = await db.update(schema.batchProductionRecords).set({ status: "PENDING_QC_REVIEW", updatedAt: new Date() }).where(eq(schema.batchProductionRecords.id, id)).returning();
    return row;
  }

  async qcReviewBpr(id: string, disposition: string, reviewedBy: string, notes?: string): Promise<BatchProductionRecord | undefined> {
    const [existing] = await db.select().from(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, id));
    if (!existing) return undefined;
    if (existing.status !== "PENDING_QC_REVIEW") {
      throw new Error("BPR must be in PENDING_QC_REVIEW status for QC review");
    }
    const isApproved = disposition === "APPROVED_FOR_DISTRIBUTION" || disposition === "APPROVED";
    const [row] = await db.update(schema.batchProductionRecords).set({
      qcReviewedBy: reviewedBy,
      qcReviewedAt: new Date(),
      qcDisposition: disposition,
      qcNotes: notes ?? existing.qcNotes,
      status: isApproved ? "APPROVED" : "REJECTED",
      completedAt: isApproved ? new Date() : existing.completedAt,
      updatedAt: new Date(),
    }).where(eq(schema.batchProductionRecords.id, id)).returning();
    return row;
  }

  // ─── BPR Steps ───────────────────────────────────────

  async addBprStep(bprId: string, data: InsertBprStep): Promise<BprStep> {
    const [bpr] = await db.select().from(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, bprId));
    if (!bpr) throw new Error("BPR not found");
    if (bpr.status !== "IN_PROGRESS") {
      throw new Error("Steps can only be added while BPR is IN_PROGRESS");
    }
    const [row] = await db.insert(schema.bprSteps).values({ ...data, bprId }).returning();
    return row;
  }

  async updateBprStep(bprId: string, stepId: string, data: Partial<InsertBprStep>): Promise<BprStep | undefined> {
    const [bpr] = await db.select().from(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, bprId));
    if (!bpr) throw new Error("BPR not found");
    if (bpr.status !== "IN_PROGRESS") {
      throw new Error("Steps can only be updated while BPR is IN_PROGRESS");
    }
    const [existing] = await db.select().from(schema.bprSteps).where(and(eq(schema.bprSteps.id, stepId), eq(schema.bprSteps.bprId, bprId)));
    if (!existing) return undefined;

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

    const [row] = await db.update(schema.bprSteps).set(data).where(and(eq(schema.bprSteps.id, stepId), eq(schema.bprSteps.bprId, bprId))).returning();
    return row;
  }

  // ─── BPR Deviations ─────────────────────────────────

  async addBprDeviation(bprId: string, data: InsertBprDeviation): Promise<BprDeviation> {
    const [bpr] = await db.select().from(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, bprId));
    if (!bpr) throw new Error("BPR not found");
    const [row] = await db.insert(schema.bprDeviations).values({ ...data, bprId }).returning();
    return row;
  }

  // ─── QMS: Audit Log ──────────────────────────────────

  async writeAuditLog(entry: InsertQmsAuditLog): Promise<QmsAuditLog> {
    const [row] = await db.insert(schema.qmsAuditLog).values(entry).returning();
    return row;
  }

  async getAuditLog(filters?: { tableName?: string; recordId?: string; actorId?: string; limit?: number }): Promise<QmsAuditLog[]> {
    let q = db.select().from(schema.qmsAuditLog).$dynamic();
    if (filters?.tableName) q = q.where(eq(schema.qmsAuditLog.tableName, filters.tableName));
    if (filters?.recordId) q = q.where(eq(schema.qmsAuditLog.recordId, filters.recordId));
    if (filters?.actorId) q = q.where(eq(schema.qmsAuditLog.actorId, filters.actorId));
    const rows = await q.orderBy(desc(schema.qmsAuditLog.occurredAt)).limit(filters?.limit ?? 500);
    return rows;
  }

  // ─── QMS: Signatures ─────────────────────────────────

  async createSignature(data: InsertQmsSignature): Promise<QmsSignature> {
    const [row] = await db.insert(schema.qmsSignatures).values(data).returning();
    return row;
  }

  // ─── QMS: Users ──────────────────────────────────────

  async getQmsUsers(): Promise<QmsUser[]> {
    return db.select().from(schema.qmsUsers).where(eq(schema.qmsUsers.isActive, true)).orderBy(asc(schema.qmsUsers.name));
  }

  async getQmsUser(id: string): Promise<QmsUser | undefined> {
    const [row] = await db.select().from(schema.qmsUsers).where(eq(schema.qmsUsers.id, id));
    return row;
  }

  async getQmsUserByEmail(email: string): Promise<QmsUser | undefined> {
    const [row] = await db.select().from(schema.qmsUsers).where(eq(schema.qmsUsers.email, email));
    return row;
  }

  async verifyQmsPin(userId: string, pin: string): Promise<boolean> {
    const [user] = await db.select().from(schema.qmsUsers).where(eq(schema.qmsUsers.id, userId));
    if (!user) return false;
    return user.pin === pin;
  }

  // ─── QMS: Lot Releases ───────────────────────────────

  async getLotReleases(filters?: { status?: string }): Promise<QmsLotReleaseWithDetails[]> {
    let q = db.select().from(schema.qmsLotReleases).$dynamic();
    if (filters?.status) q = q.where(eq(schema.qmsLotReleases.status, filters.status));
    const rows = await q.orderBy(desc(schema.qmsLotReleases.createdAt));
    return rows.map(r => ({ ...r, signerName: null, signerEmail: null }));
  }

  async getLotRelease(id: string): Promise<QmsLotReleaseWithDetails | undefined> {
    const [row] = await db.select().from(schema.qmsLotReleases).where(eq(schema.qmsLotReleases.id, id));
    if (!row) return undefined;
    return { ...row, signerName: null, signerEmail: null };
  }

  async getLotReleaseByLotId(lotId: string): Promise<QmsLotRelease | undefined> {
    const [row] = await db.select().from(schema.qmsLotReleases).where(eq(schema.qmsLotReleases.lotId, lotId));
    return row;
  }

  async createLotRelease(data: InsertQmsLotRelease): Promise<QmsLotRelease> {
    const [row] = await db.insert(schema.qmsLotReleases).values(data).returning();
    await this.writeAuditLog({
      tableName: "qms_lot_releases",
      recordId: row.id,
      operation: "CREATE",
      actorId: "system",
      actorEmail: "system",
      beforeJson: null,
      afterJson: JSON.stringify(row),
    });
    return row;
  }

  async signLotRelease(
    id: string,
    decision: "APPROVED" | "REJECTED" | "ON_HOLD",
    signerId: string,
    signerEmail: string,
    pin: string,
    notes?: string,
  ): Promise<QmsLotRelease> {
    const pinOk = await this.verifyQmsPin(signerId, pin);
    if (!pinOk) throw new Error("Incorrect PIN");

    const [existing] = await db.select().from(schema.qmsLotReleases).where(eq(schema.qmsLotReleases.id, id));
    if (!existing) throw new Error("Lot release not found");
    if (existing.status !== "PENDING_QC_REVIEW" && existing.status !== "ON_HOLD") {
      throw new Error("Lot release has already been decided");
    }

    const now = new Date();
    const payloadHash = createHash("sha256")
      .update(`${id}|${signerId}|${decision}|${now.toISOString()}`)
      .digest("hex");

    const sig = await this.createSignature({
      tableName: "qms_lot_releases",
      recordId: id,
      signerId,
      signerEmail,
      meaning: decision === "APPROVED" ? "RELEASED" : decision === "REJECTED" ? "REJECTED" : "REVIEWED",
      reauthMethod: "PIN_DEMO",
      payloadHash,
    });

    const [updated] = await db.update(schema.qmsLotReleases).set({
      status: decision,
      decision,
      signedBy: signerId,
      signedAt: now,
      signatureId: sig.id,
      notes: notes ?? null,
      updatedAt: now,
    }).where(eq(schema.qmsLotReleases.id, id)).returning();

    // Update lot quarantine status
    const newQuarantine = decision === "APPROVED" ? "APPROVED" : decision === "REJECTED" ? "REJECTED" : "ON_HOLD";
    await db.update(schema.lots).set({ quarantineStatus: newQuarantine }).where(eq(schema.lots.id, existing.lotId));

    await this.writeAuditLog({
      tableName: "qms_lot_releases",
      recordId: id,
      operation: "SIGN",
      actorId: signerId,
      actorEmail: signerEmail,
      beforeJson: JSON.stringify(existing),
      afterJson: JSON.stringify(updated),
    });

    return updated;
  }

  // ─── QMS: CAPAs ──────────────────────────────────────

  async getCapas(filters?: { status?: string; phase?: string }): Promise<QmsCapaWithActions[]> {
    let q = db.select().from(schema.qmsCapas).$dynamic();
    if (filters?.status) q = q.where(eq(schema.qmsCapas.status, filters.status));
    if (filters?.phase) q = q.where(eq(schema.qmsCapas.phase, filters.phase));
    const rows = await q.orderBy(asc(schema.qmsCapas.targetDate));
    const actions = await db.select().from(schema.qmsCapaActions);
    return rows.map(r => ({
      ...r,
      actions: actions.filter(a => a.capaId === r.id),
    }));
  }

  async getCapa(id: string): Promise<QmsCapaWithActions | undefined> {
    const [row] = await db.select().from(schema.qmsCapas).where(eq(schema.qmsCapas.id, id));
    if (!row) return undefined;
    const actions = await db.select().from(schema.qmsCapaActions).where(eq(schema.qmsCapaActions.capaId, id));
    return { ...row, actions };
  }

  async createCapa(data: InsertQmsCapa): Promise<QmsCapa> {
    const [row] = await db.insert(schema.qmsCapas).values(data).returning();
    await this.writeAuditLog({
      tableName: "qms_capas",
      recordId: row.id,
      operation: "CREATE",
      actorId: "system",
      actorEmail: "system",
      beforeJson: null,
      afterJson: JSON.stringify(row),
    });
    return row;
  }

  async updateCapa(id: string, data: Partial<InsertQmsCapa>): Promise<QmsCapa | undefined> {
    const [existing] = await db.select().from(schema.qmsCapas).where(eq(schema.qmsCapas.id, id));
    if (!existing) return undefined;
    const [row] = await db.update(schema.qmsCapas).set({ ...data, updatedAt: new Date() }).where(eq(schema.qmsCapas.id, id)).returning();
    await this.writeAuditLog({
      tableName: "qms_capas",
      recordId: id,
      operation: "UPDATE",
      actorId: "system",
      actorEmail: "system",
      beforeJson: JSON.stringify(existing),
      afterJson: JSON.stringify(row),
    });
    return row;
  }

  async transitionCapa(id: string, newStatus: string, actorId: string, actorEmail: string): Promise<QmsCapa | undefined> {
    const [existing] = await db.select().from(schema.qmsCapas).where(eq(schema.qmsCapas.id, id));
    if (!existing) return undefined;
    const extra: Partial<InsertQmsCapa> = {};
    if (newStatus === "closed") { extra.closedBy = actorId; extra.closedAt = new Date() as any; }
    if (newStatus === "verified") { extra.verifiedBy = actorId; extra.verifiedAt = new Date() as any; }
    const [row] = await db.update(schema.qmsCapas).set({ status: newStatus, ...extra, updatedAt: new Date() }).where(eq(schema.qmsCapas.id, id)).returning();
    await this.writeAuditLog({
      tableName: "qms_capas",
      recordId: id,
      operation: "TRANSITION",
      actorId,
      actorEmail,
      beforeJson: JSON.stringify(existing),
      afterJson: JSON.stringify(row),
    });
    return row;
  }

  async createCapaAction(data: InsertQmsCapaAction): Promise<QmsCapaAction> {
    const [row] = await db.insert(schema.qmsCapaActions).values(data).returning();
    return row;
  }

  async updateCapaAction(id: string, data: Partial<InsertQmsCapaAction>): Promise<QmsCapaAction | undefined> {
    const [row] = await db.update(schema.qmsCapaActions).set(data).where(eq(schema.qmsCapaActions.id, id)).returning();
    return row;
  }

  // ─── QMS: Complaints ─────────────────────────────────

  async getComplaints(filters?: { status?: string; category?: string }): Promise<QmsComplaint[]> {
    let q = db.select().from(schema.qmsComplaints).$dynamic();
    if (filters?.status) q = q.where(eq(schema.qmsComplaints.status, filters.status));
    if (filters?.category) q = q.where(eq(schema.qmsComplaints.category, filters.category));
    return q.orderBy(desc(schema.qmsComplaints.receivedAt));
  }

  async getComplaint(id: string): Promise<QmsComplaint | undefined> {
    const [row] = await db.select().from(schema.qmsComplaints).where(eq(schema.qmsComplaints.id, id));
    return row;
  }

  async createComplaint(data: InsertQmsComplaint): Promise<QmsComplaint> {
    const [row] = await db.insert(schema.qmsComplaints).values({
      ...data,
      lotLinkageRequired: !data.lotId,
    }).returning();
    await this.writeAuditLog({
      tableName: "qms_complaints",
      recordId: row.id,
      operation: "CREATE",
      actorId: "system",
      actorEmail: "system",
      beforeJson: null,
      afterJson: JSON.stringify(row),
    });
    return row;
  }

  async updateComplaint(id: string, data: Partial<InsertQmsComplaint>): Promise<QmsComplaint | undefined> {
    const [existing] = await db.select().from(schema.qmsComplaints).where(eq(schema.qmsComplaints.id, id));
    if (!existing) return undefined;
    const [row] = await db.update(schema.qmsComplaints).set({ ...data, updatedAt: new Date() }).where(eq(schema.qmsComplaints.id, id)).returning();
    await this.writeAuditLog({
      tableName: "qms_complaints",
      recordId: id,
      operation: "UPDATE",
      actorId: "system",
      actorEmail: "system",
      beforeJson: JSON.stringify(existing),
      afterJson: JSON.stringify(row),
    });
    return row;
  }

  async transitionComplaint(id: string, newStatus: string, actorId: string, actorEmail: string): Promise<QmsComplaint | undefined> {
    const [existing] = await db.select().from(schema.qmsComplaints).where(eq(schema.qmsComplaints.id, id));
    if (!existing) return undefined;
    const extra: any = {};
    if (newStatus === "closed") { extra.closedBy = actorId; extra.closedAt = new Date(); }
    const [row] = await db.update(schema.qmsComplaints).set({ status: newStatus, ...extra, updatedAt: new Date() }).where(eq(schema.qmsComplaints.id, id)).returning();
    await this.writeAuditLog({
      tableName: "qms_complaints",
      recordId: id,
      operation: "TRANSITION",
      actorId,
      actorEmail,
      beforeJson: JSON.stringify(existing),
      afterJson: JSON.stringify(row),
    });
    return row;
  }

  // ─── QMS: Dashboard ──────────────────────────────────

  async getQmsDashboardStats(): Promise<QmsDashboardStats> {
    const [releases, capas, complaints] = await Promise.all([
      db.select().from(schema.qmsLotReleases).where(eq(schema.qmsLotReleases.status, "PENDING_QC_REVIEW")),
      db.select().from(schema.qmsCapas).where(
        sql`${schema.qmsCapas.status} IN ('open', 'in_progress', 'pending_effectiveness', 'on_hold')`
      ),
      db.select().from(schema.qmsComplaints).where(
        sql`${schema.qmsComplaints.status} IN ('open', 'under_investigation', 'pending_qc_review')`
      ),
    ]);
    return {
      pendingReleases: releases.length,
      openCapas: capas.length,
      openComplaints: complaints.length,
      trainingGaps: 0, // Phase 2
    };
  }
}
