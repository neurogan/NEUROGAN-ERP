import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import {
  insertProductSchema,
  insertLotSchema,
  insertLocationSchema,
  insertTransactionSchema,
  insertSupplierSchema,
  insertPurchaseOrderSchema,
  insertProductionBatchSchema,
  insertRecipeSchema,
  insertProductCategorySchema,
  insertProductionNoteSchema,
  insertSupplierDocumentSchema,
  insertReceivingRecordSchema,
  insertCoaDocumentSchema,
  insertSupplierQualificationSchema,
  insertBprSchema,
  insertBprStepSchema,
  insertBprDeviationSchema,
} from "@shared/schema";
import { ZodError } from "zod";

function formatZodError(error: ZodError): string {
  return error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Products ───────────────────────────────────────────

  app.get("/api/products", async (_req, res) => {
    try {
      const products = await storage.getProducts();
      res.json(products);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.post("/api/products", async (req, res) => {
    try {
      const data = insertProductSchema.parse(req.body);
      const product = await storage.createProduct(data);
      res.status(201).json(product);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      // PostgreSQL unique constraint violation (duplicate SKU)
      if ((err as any)?.code === "23505") {
        const detail = (err as any)?.detail ?? "";
        if (detail.includes("sku")) {
          return res.status(409).json({ message: `A product with SKU "${req.body.sku}" already exists.` });
        }
        return res.status(409).json({ message: "A product with that value already exists." });
      }
      res.status(500).json({ message: "Failed to create product" });
    }
  });

  app.patch("/api/products/:id", async (req, res) => {
    try {
      const data = insertProductSchema.partial().parse(req.body);
      const product = await storage.updateProduct(req.params.id, data);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteProduct(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  // ─── Lots ──────────────────────────────────────────────

  app.get("/api/lots", async (req, res) => {
    try {
      const productId = req.query.productId as string | undefined;
      const lots = await storage.getLots(productId);
      res.json(lots);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch lots" });
    }
  });

  app.get("/api/lots/:id", async (req, res) => {
    try {
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ message: "Lot not found" });
      }
      res.json(lot);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch lot" });
    }
  });

  app.post("/api/lots", async (req, res) => {
    try {
      const data = insertLotSchema.parse(req.body);
      const lot = await storage.createLot(data);
      res.status(201).json(lot);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to create lot" });
    }
  });

  app.patch("/api/lots/:id", async (req, res) => {
    try {
      const data = insertLotSchema.partial().parse(req.body);
      const lot = await storage.updateLot(req.params.id, data);
      if (!lot) {
        return res.status(404).json({ message: "Lot not found" });
      }
      res.json(lot);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to update lot" });
    }
  });

  // ─── Locations ─────────────────────────────────────────

  app.get("/api/locations", async (_req, res) => {
    try {
      const locations = await storage.getLocations();
      res.json(locations);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.post("/api/locations", async (req, res) => {
    try {
      const data = insertLocationSchema.parse(req.body);
      const location = await storage.createLocation(data);
      res.status(201).json(location);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to create location" });
    }
  });

  app.patch("/api/locations/:id", async (req, res) => {
    try {
      const data = insertLocationSchema.partial().parse(req.body);
      const location = await storage.updateLocation(req.params.id, data);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.json(location);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  app.delete("/api/locations/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteLocation(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ message: "Failed to delete location" });
    }
  });

  // ─── Transactions ──────────────────────────────────────

  app.get("/api/transactions", async (req, res) => {
    try {
      const filters = {
        productId: req.query.productId as string | undefined,
        lotId: req.query.lotId as string | undefined,
        type: req.query.type as string | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
        productionBatchId: req.query.productionBatchId as string | undefined,
      };
      // Remove undefined values
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== undefined)
      );
      const transactions = await storage.getTransactions(
        Object.keys(cleanFilters).length > 0 ? cleanFilters : undefined
      );
      res.json(transactions);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.post("/api/transactions", async (req, res) => {
    try {
      const data = insertTransactionSchema.parse(req.body);
      const transaction = await storage.createTransaction(data);
      res.status(201).json(transaction);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to create transaction" });
    }
  });

  // Combo endpoint: create lot + transaction in one call (for PO Receipt)
  app.post("/api/transactions/po-receipt", async (req, res) => {
    try {
      const { lotNumber, supplierName, productId, locationId, quantity, uom, notes, performedBy } = req.body;
      if (!lotNumber || !productId || !locationId || !quantity || !uom) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      // Create the lot first
      const lot = await storage.createLot({
        productId,
        lotNumber,
        supplierName: supplierName || null,
      });
      // Then create the transaction
      const transaction = await storage.createTransaction({
        lotId: lot.id,
        locationId,
        type: "PO_RECEIPT",
        quantity: String(Math.abs(parseFloat(quantity))),
        uom,
        notes: notes || null,
        performedBy: performedBy || "admin",
      });
      res.status(201).json({ lot, transaction });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to create PO receipt" });
    }
  });

  // ─── Suppliers ───────────────────────────────────────

  app.get("/api/suppliers", async (_req, res) => {
    try {
      const suppliers = await storage.getSuppliers();
      res.json(suppliers);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch suppliers" });
    }
  });

  app.get("/api/suppliers/:id", async (req, res) => {
    try {
      const supplier = await storage.getSupplier(req.params.id);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      res.json(supplier);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch supplier" });
    }
  });

  app.post("/api/suppliers", async (req, res) => {
    try {
      const data = insertSupplierSchema.parse(req.body);
      const supplier = await storage.createSupplier(data);
      res.status(201).json(supplier);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      res.status(500).json({ message: "Failed to create supplier" });
    }
  });

  app.patch("/api/suppliers/:id", async (req, res) => {
    try {
      const data = insertSupplierSchema.partial().parse(req.body);
      const supplier = await storage.updateSupplier(req.params.id, data);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      res.json(supplier);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      res.status(500).json({ message: "Failed to update supplier" });
    }
  });

  app.delete("/api/suppliers/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteSupplier(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Supplier not found" });
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ message: "Failed to delete supplier" });
    }
  });

  // ─── Purchase Orders ────────────────────────────────────

  app.get("/api/purchase-orders", async (req, res) => {
    try {
      const filters = {
        status: req.query.status as string | undefined,
        supplierId: req.query.supplierId as string | undefined,
      };
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== undefined)
      );
      const pos = await storage.getPurchaseOrders(
        Object.keys(cleanFilters).length > 0 ? cleanFilters : undefined
      );
      res.json(pos);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch purchase orders" });
    }
  });

  app.get("/api/purchase-orders/:id", async (req, res) => {
    try {
      const po = await storage.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ message: "Purchase order not found" });
      res.json(po);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch purchase order" });
    }
  });

  app.post("/api/purchase-orders", async (req, res) => {
    try {
      const { lineItems, ...poData } = req.body;
      const data = insertPurchaseOrderSchema.parse(poData);
      if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ message: "At least one line item is required" });
      }
      const po = await storage.createPurchaseOrder(data, lineItems);
      res.status(201).json(po);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      res.status(500).json({ message: "Failed to create purchase order" });
    }
  });

  app.patch("/api/purchase-orders/:id", async (req, res) => {
    try {
      const po = await storage.updatePurchaseOrder(req.params.id, req.body);
      if (!po) return res.status(404).json({ message: "Purchase order not found" });
      res.json(po);
    } catch (err) {
      res.status(500).json({ message: "Failed to update purchase order" });
    }
  });

  app.post("/api/purchase-orders/:id/submit", async (req, res) => {
    try {
      const po = await storage.updatePurchaseOrderStatus(req.params.id, "SUBMITTED");
      if (!po) return res.status(404).json({ message: "Purchase order not found" });
      res.json(po);
    } catch (err) {
      res.status(500).json({ message: "Failed to submit purchase order" });
    }
  });

  app.post("/api/purchase-orders/:id/cancel", async (req, res) => {
    try {
      const po = await storage.updatePurchaseOrderStatus(req.params.id, "CANCELLED");
      if (!po) return res.status(404).json({ message: "Purchase order not found" });
      res.json(po);
    } catch (err) {
      res.status(500).json({ message: "Failed to cancel purchase order" });
    }
  });

  // ─── PO Receiving ──────────────────────────────────────

  app.post("/api/purchase-orders/receive", async (req, res) => {
    try {
      const { lineItemId, quantity, lotNumber, locationId, supplierName, expirationDate, receivedDate } = req.body;
      if (!lineItemId || !quantity || !locationId) {
        return res.status(400).json({ message: "Missing required fields: lineItemId, quantity, locationId" });
      }
      // If lotNumber is empty, auto-generate for secondary packaging
      const effectiveLotNumber = lotNumber || `NOLOT-${new Date().toISOString().slice(0, 10)}`;
      const result = await storage.receivePOLineItem(
        lineItemId,
        parseFloat(quantity),
        effectiveLotNumber,
        locationId,
        supplierName,
        expirationDate,
        receivedDate,
      );
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to receive";
      res.status(500).json({ message: msg });
    }
  });

  // ─── Production Batches ────────────────────────────────

  app.get("/api/production-batches", async (req, res) => {
    try {
      const filters = {
        status: req.query.status as string | undefined,
      };
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== undefined)
      );
      const batches = await storage.getProductionBatches(
        Object.keys(cleanFilters).length > 0 ? cleanFilters : undefined
      );
      res.json(batches);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch production batches" });
    }
  });

  // Get next auto-generated batch number — MUST be before :id route
  app.get("/api/production-batches/next-number", async (_req, res) => {
    try {
      const batchNumber = await storage.getNextBatchNumber();
      res.json({ batchNumber });
    } catch (err) {
      res.status(500).json({ message: "Failed to get next batch number" });
    }
  });

  // Get next auto-generated output lot number — MUST be before :id route
  app.get("/api/production-batches/next-lot-number", async (_req, res) => {
    try {
      const lotNumber = await storage.getNextOutputLotNumber();
      res.json({ lotNumber });
    } catch (err) {
      res.status(500).json({ message: "Failed to get next lot number" });
    }
  });

  app.get("/api/production-batches/:id", async (req, res) => {
    try {
      const batch = await storage.getProductionBatch(req.params.id);
      if (!batch) return res.status(404).json({ message: "Production batch not found" });
      res.json(batch);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch production batch" });
    }
  });

  app.post("/api/production-batches", async (req, res) => {
    try {
      const { inputs, ...batchData } = req.body;
      const data = insertProductionBatchSchema.parse(batchData);
      if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
        return res.status(400).json({ message: "At least one input material is required" });
      }
      const batch = await storage.createProductionBatch(data, inputs);
      res.status(201).json(batch);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      res.status(500).json({ message: "Failed to create production batch" });
    }
  });

  app.patch("/api/production-batches/:id", async (req, res) => {
    try {
      const { inputs, ...batchData } = req.body;
      const batch = await storage.updateProductionBatch(req.params.id, batchData, inputs);
      if (!batch) return res.status(404).json({ message: "Production batch not found" });
      // Return the enriched batch
      const enriched = await storage.getProductionBatch(req.params.id);
      res.json(enriched ?? batch);
    } catch (err) {
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      res.status(500).json({ message: "Failed to update production batch" });
    }
  });

  app.delete("/api/production-batches/:id", async (req, res) => {
    try {
      const batch = await storage.getProductionBatch(req.params.id);
      if (!batch) return res.status(404).json({ message: "Production batch not found" });

      if (batch.status === "COMPLETED") {
        // Delete completed batch with full transaction reversal
        const deleted = await storage.deleteCompletedBatch(req.params.id);
        if (!deleted) return res.status(500).json({ message: "Failed to delete completed batch" });
        res.status(204).send();
      } else if (batch.status === "DRAFT") {
        const deleted = await storage.deleteProductionBatch(req.params.id);
        if (!deleted) return res.status(500).json({ message: "Failed to delete batch" });
        res.status(204).send();
      } else {
        return res.status(400).json({ message: "Only DRAFT and COMPLETED batches can be deleted" });
      }
    } catch (err) {
      res.status(500).json({ message: "Failed to delete production batch" });
    }
  });

  app.post("/api/production-batches/:id/complete", async (req, res) => {
    try {
      const { actualQuantity, outputLotNumber, outputExpirationDate, locationId, qcStatus, qcNotes, endDate, qcDisposition, qcReviewedBy, yieldPercentage } = req.body;
      if (!actualQuantity || !outputLotNumber || !locationId) {
        return res.status(400).json({ message: "Missing required fields: actualQuantity, outputLotNumber, locationId" });
      }
      const batch = await storage.completeProductionBatch(
        req.params.id,
        parseFloat(actualQuantity),
        outputLotNumber,
        outputExpirationDate || null,
        locationId,
        qcStatus,
        qcNotes,
        endDate,
        qcDisposition,
        qcReviewedBy,
        yieldPercentage,
      );
      res.json(batch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to complete production batch";
      // Return 409 for stock validation errors so the frontend can show a clear message
      const status = msg.includes("Insufficient stock") ? 409 : 500;
      res.status(status).json({ message: msg });
    }
  });

  // ─── Stock Availability & FIFO ──────────────────────────────

  app.get("/api/stock/:productId", async (req, res) => {
    try {
      const stock = await storage.getAvailableStock(req.params.productId);
      res.json(stock);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch stock" });
    }
  });

  app.post("/api/stock/allocate-fifo", async (req, res) => {
    try {
      const { productId, quantity } = req.body;
      if (!productId || !quantity) {
        return res.status(400).json({ message: "Missing required fields: productId, quantity" });
      }
      const allocations = await storage.allocateFIFO(productId, parseFloat(quantity));
      const totalAllocated = allocations.reduce((sum, a) => sum + a.quantity, 0);
      res.json({ allocations, totalAllocated, requested: parseFloat(quantity), sufficient: totalAllocated >= parseFloat(quantity) });
    } catch (err) {
      res.status(500).json({ message: "Failed to allocate stock" });
    }
  });

  app.post("/api/stock/validate", async (req, res) => {
    try {
      const { inputs } = req.body;
      if (!inputs || !Array.isArray(inputs)) {
        return res.status(400).json({ message: "Missing required field: inputs" });
      }
      const shortages = await storage.validateStockForInputs(
        inputs.map((inp: { productId: string; quantity: string | number }) => ({
          productId: inp.productId,
          quantity: typeof inp.quantity === 'string' ? parseFloat(inp.quantity) : inp.quantity,
        }))
      );
      res.json({ valid: shortages.length === 0, shortages });
    } catch (err) {
      res.status(500).json({ message: "Failed to validate stock" });
    }
  });

  // ─── Recipes ──────────────────────────────────────────

  app.get("/api/recipes", async (req, res) => {
    try {
      const productId = req.query.productId as string | undefined;
      const recipes = await storage.getRecipes(productId);
      res.json(recipes);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch recipes" });
    }
  });

  app.get("/api/recipes/:id", async (req, res) => {
    try {
      const recipe = await storage.getRecipe(req.params.id);
      if (!recipe) return res.status(404).json({ message: "Recipe not found" });
      res.json(recipe);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch recipe" });
    }
  });

  app.post("/api/recipes", async (req, res) => {
    try {
      const { lines, ...recipeData } = req.body;
      const data = insertRecipeSchema.parse(recipeData);
      if (!lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: "At least one recipe line is required" });
      }
      const recipe = await storage.createRecipe(data, lines);
      res.status(201).json(recipe);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      res.status(500).json({ message: "Failed to create recipe" });
    }
  });

  app.patch("/api/recipes/:id", async (req, res) => {
    try {
      const { lines, ...recipeData } = req.body;
      const recipe = await storage.updateRecipe(req.params.id, recipeData, lines);
      if (!recipe) return res.status(404).json({ message: "Recipe not found" });
      res.json(recipe);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      res.status(500).json({ message: "Failed to update recipe" });
    }
  });

  app.delete("/api/recipes/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteRecipe(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Recipe not found" });
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ message: "Failed to delete recipe" });
    }
  });

  // ─── Inventory ─────────────────────────────────────────

  app.get("/api/inventory", async (_req, res) => {
    try {
      const inventory = await storage.getInventory();
      res.json(inventory);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch inventory" });
    }
  });

  // ─── Settings ───────────────────────────────────────────

  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const settings = await storage.updateSettings(req.body);
      res.json(settings);
    } catch (err) {
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // ─── Product Categories ────────────────────────────────

  app.get("/api/product-categories", async (_req, res) => {
    try {
      const categories = await storage.getProductCategories();
      res.json(categories);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch product categories" });
    }
  });

  app.post("/api/product-categories", async (req, res) => {
    try {
      const data = insertProductCategorySchema.parse(req.body);
      const category = await storage.createProductCategory(data);
      res.status(201).json(category);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      res.status(500).json({ message: "Failed to create product category" });
    }
  });

  app.delete("/api/product-categories/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteProductCategory(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Category not found" });
      res.json({ message: "Deleted" });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete product category" });
    }
  });

  // Category assignments
  app.get("/api/product-category-assignments", async (req, res) => {
    try {
      const productId = req.query.productId as string | undefined;
      const assignments = await storage.getProductCategoryAssignments(productId);
      res.json(assignments);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch assignments" });
    }
  });

  app.post("/api/product-category-assignments", async (req, res) => {
    try {
      const { productId, categoryId } = req.body;
      if (!productId || !categoryId) return res.status(400).json({ message: "productId and categoryId required" });
      const assignment = await storage.assignProductCategory(productId, categoryId);
      res.status(201).json(assignment);
    } catch (err) {
      res.status(500).json({ message: "Failed to assign category" });
    }
  });

  app.delete("/api/product-category-assignments", async (req, res) => {
    try {
      const { productId, categoryId } = req.body;
      if (!productId || !categoryId) return res.status(400).json({ message: "productId and categoryId required" });
      const deleted = await storage.unassignProductCategory(productId, categoryId);
      if (!deleted) return res.status(404).json({ message: "Assignment not found" });
      res.json({ message: "Unassigned" });
    } catch (err) {
      res.status(500).json({ message: "Failed to unassign category" });
    }
  });

  // Products with categories enriched
  app.get("/api/products-with-categories", async (_req, res) => {
    try {
      const products = await storage.getProductsWithCategories();
      res.json(products);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch products with categories" });
    }
  });

  // ─── Supply Chain Capacity ─────────────────────────────

  app.get("/api/supply-chain/capacity", async (_req, res) => {
    try {
      const capacity = await storage.getSupplyChainCapacity();
      res.json(capacity);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch supply chain capacity" });
    }
  });

  // ─── Production Notes ────────────────────────────────

  app.get("/api/production-batches/:id/notes", async (req, res) => {
    try {
      const notes = await storage.getProductionNotes(req.params.id);
      res.json(notes);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  app.post("/api/production-batches/:id/notes", async (req, res) => {
    try {
      const data = insertProductionNoteSchema.parse({ ...req.body, batchId: req.params.id });
      const note = await storage.createProductionNote(data);
      res.status(201).json(note);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      res.status(500).json({ message: "Failed to create note" });
    }
  });

  // ─── Supplier Documents ─────────────────────────────

  app.get("/api/suppliers/:id/documents", async (req, res) => {
    try {
      const docs = await storage.getSupplierDocuments(req.params.id);
      res.json(docs);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post("/api/suppliers/:id/documents", async (req, res) => {
    try {
      const data = { ...req.body, supplierId: req.params.id };
      const doc = await storage.createSupplierDocument(data);
      res.status(201).json(doc);
    } catch (err) {
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.get("/api/suppliers/:supplierId/documents/:docId", async (req, res) => {
    try {
      const doc = await storage.getSupplierDocument(req.params.docId);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      res.json(doc);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch document" });
    }
  });

  app.delete("/api/suppliers/:supplierId/documents/:docId", async (req, res) => {
    try {
      const deleted = await storage.deleteSupplierDocument(req.params.docId);
      if (!deleted) return res.status(404).json({ message: "Document not found" });
      res.json({ message: "Deleted" });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // ─── Receiving & Quarantine ────────────────────────────

  app.get("/api/receiving", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const records = await storage.getReceivingRecords(status ? { status } : undefined);
      res.json(records);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch receiving records" });
    }
  });

  app.get("/api/receiving/quarantined", async (_req, res) => {
    try {
      const records = await storage.getQuarantinedLots();
      res.json(records);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch quarantined lots" });
    }
  });

  app.get("/api/receiving/next-identifier", async (_req, res) => {
    try {
      const id = await storage.getNextReceivingIdentifier();
      res.json({ identifier: id });
    } catch (err) {
      res.status(500).json({ message: "Failed to generate identifier" });
    }
  });

  app.get("/api/receiving/:id", async (req, res) => {
    try {
      const record = await storage.getReceivingRecord(req.params.id);
      if (!record) return res.status(404).json({ message: "Not found" });
      res.json(record);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch receiving record" });
    }
  });

  app.post("/api/receiving", async (req, res) => {
    try {
      const record = await storage.createReceivingRecord(req.body);
      res.status(201).json(record);
    } catch (err) {
      res.status(500).json({ message: "Failed to create receiving record" });
    }
  });

  app.put("/api/receiving/:id", async (req, res) => {
    try {
      const record = await storage.updateReceivingRecord(req.params.id, req.body);
      if (!record) return res.status(404).json({ message: "Not found" });
      res.json(record);
    } catch (err) {
      res.status(500).json({ message: "Failed to update receiving record" });
    }
  });

  app.post("/api/receiving/:id/qc-review", async (req, res) => {
    try {
      const { disposition, reviewedBy, notes } = req.body;
      if (!disposition || !reviewedBy) return res.status(400).json({ message: "disposition and reviewedBy required" });
      const record = await storage.qcReviewReceivingRecord(req.params.id, disposition, reviewedBy, notes);
      if (!record) return res.status(404).json({ message: "Not found" });
      res.json(record);
    } catch (err) {
      res.status(500).json({ message: "Failed to review receiving record" });
    }
  });

  // ─── COA Documents ────────────────────────────────────

  app.post("/api/coa", async (req, res) => {
    try {
      const data = insertCoaDocumentSchema.parse(req.body);
      const doc = await storage.createCoaDocument(data);
      res.status(201).json(doc);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to create COA document" });
    }
  });

  app.get("/api/coa/by-lot/:lotId", async (req, res) => {
    try {
      const docs = await storage.getCoasByLot(req.params.lotId);
      res.json(docs);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch COAs for lot" });
    }
  });

  app.get("/api/coa", async (req, res) => {
    try {
      const filters = {
        lotId: req.query.lotId as string | undefined,
        productionBatchId: req.query.productionBatchId as string | undefined,
        sourceType: req.query.sourceType as string | undefined,
        overallResult: req.query.overallResult as string | undefined,
      };
      const docs = await storage.getCoaDocuments(filters);
      res.json(docs);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch COA documents" });
    }
  });

  app.get("/api/coa/:id", async (req, res) => {
    try {
      const doc = await storage.getCoaDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "COA document not found" });
      res.json(doc);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch COA document" });
    }
  });

  app.put("/api/coa/:id", async (req, res) => {
    try {
      const data = insertCoaDocumentSchema.partial().parse(req.body);
      const doc = await storage.updateCoaDocument(req.params.id, data);
      if (!doc) return res.status(404).json({ message: "COA document not found" });
      res.json(doc);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to update COA document" });
    }
  });

  app.post("/api/coa/:id/qc-review", async (req, res) => {
    try {
      const { accepted, reviewedBy, notes } = req.body;
      if (typeof accepted !== "boolean" || !reviewedBy) {
        return res.status(400).json({ message: "accepted (boolean) and reviewedBy (string) are required" });
      }
      const doc = await storage.qcReviewCoa(req.params.id, accepted, reviewedBy, notes);
      if (!doc) return res.status(404).json({ message: "COA document not found" });
      res.json(doc);
    } catch (err) {
      res.status(500).json({ message: "Failed to review COA document" });
    }
  });

  // ─── Supplier Qualifications ──────────────────────────

  app.post("/api/supplier-qualifications", async (req, res) => {
    try {
      const data = insertSupplierQualificationSchema.parse(req.body);
      const sq = await storage.createSupplierQualification(data);
      res.status(201).json(sq);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to create supplier qualification" });
    }
  });

  app.get("/api/supplier-qualifications", async (req, res) => {
    try {
      const supplierId = req.query.supplierId as string | undefined;
      const records = await storage.getSupplierQualifications(supplierId);
      res.json(records);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch supplier qualifications" });
    }
  });

  app.get("/api/supplier-qualifications/:id", async (req, res) => {
    try {
      const sq = await storage.getSupplierQualification(req.params.id);
      if (!sq) return res.status(404).json({ message: "Supplier qualification not found" });
      res.json(sq);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch supplier qualification" });
    }
  });

  app.put("/api/supplier-qualifications/:id", async (req, res) => {
    try {
      const data = insertSupplierQualificationSchema.partial().parse(req.body);
      const sq = await storage.updateSupplierQualification(req.params.id, data);
      if (!sq) return res.status(404).json({ message: "Supplier qualification not found" });
      res.json(sq);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: formatZodError(err) });
      }
      res.status(500).json({ message: "Failed to update supplier qualification" });
    }
  });

  // ─── Batch Production Records ────────────────────────────

  app.post("/api/batch-production-records", async (req, res) => {
    try {
      const data = insertBprSchema.parse(req.body);
      const bpr = await storage.createBpr(data);
      res.status(201).json(bpr);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      const msg = err instanceof Error ? err.message : "Failed to create BPR";
      res.status(400).json({ message: msg });
    }
  });

  app.get("/api/batch-production-records", async (req, res) => {
    try {
      const filters = {
        status: req.query.status as string | undefined,
        productionBatchId: req.query.productionBatchId as string | undefined,
      };
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== undefined)
      );
      const bprs = await storage.getBprs(
        Object.keys(cleanFilters).length > 0 ? cleanFilters : undefined
      );
      res.json(bprs);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch BPRs" });
    }
  });

  // Must be before :id route
  app.get("/api/batch-production-records/by-batch/:batchId", async (req, res) => {
    try {
      const bpr = await storage.getBprByBatchId(req.params.batchId);
      if (!bpr) return res.status(404).json({ message: "BPR not found for this batch" });
      res.json(bpr);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch BPR by batch ID" });
    }
  });

  app.get("/api/batch-production-records/:id", async (req, res) => {
    try {
      const bpr = await storage.getBpr(req.params.id);
      if (!bpr) return res.status(404).json({ message: "BPR not found" });
      res.json(bpr);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch BPR" });
    }
  });

  app.put("/api/batch-production-records/:id", async (req, res) => {
    try {
      const data = insertBprSchema.partial().parse(req.body);
      const bpr = await storage.updateBpr(req.params.id, data);
      if (!bpr) return res.status(404).json({ message: "BPR not found" });
      res.json(bpr);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      const msg = err instanceof Error ? err.message : "Failed to update BPR";
      res.status(400).json({ message: msg });
    }
  });

  app.post("/api/batch-production-records/:id/submit-for-review", async (req, res) => {
    try {
      const bpr = await storage.submitBprForReview(req.params.id);
      if (!bpr) return res.status(404).json({ message: "BPR not found" });
      res.json(bpr);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit BPR for review";
      res.status(400).json({ message: msg });
    }
  });

  app.post("/api/batch-production-records/:id/qc-review", async (req, res) => {
    try {
      const { disposition, reviewedBy, notes } = req.body;
      if (!disposition || !reviewedBy) {
        return res.status(400).json({ message: "disposition and reviewedBy are required" });
      }
      const bpr = await storage.qcReviewBpr(req.params.id, disposition, reviewedBy, notes);
      if (!bpr) return res.status(404).json({ message: "BPR not found" });
      res.json(bpr);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to QC review BPR";
      res.status(400).json({ message: msg });
    }
  });

  app.post("/api/batch-production-records/:id/steps", async (req, res) => {
    try {
      const data = insertBprStepSchema.parse(req.body);
      const step = await storage.addBprStep(req.params.id, data);
      res.status(201).json(step);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      const msg = err instanceof Error ? err.message : "Failed to add BPR step";
      res.status(400).json({ message: msg });
    }
  });

  app.put("/api/batch-production-records/:id/steps/:stepId", async (req, res) => {
    try {
      const data = insertBprStepSchema.partial().parse(req.body);
      const step = await storage.updateBprStep(req.params.id, req.params.stepId, data);
      if (!step) return res.status(404).json({ message: "BPR step not found" });
      res.json(step);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      const msg = err instanceof Error ? err.message : "Failed to update BPR step";
      res.status(400).json({ message: msg });
    }
  });

  app.post("/api/batch-production-records/:id/deviations", async (req, res) => {
    try {
      const data = insertBprDeviationSchema.parse(req.body);
      const deviation = await storage.addBprDeviation(req.params.id, data);
      res.status(201).json(deviation);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: formatZodError(err) });
      const msg = err instanceof Error ? err.message : "Failed to add BPR deviation";
      res.status(400).json({ message: msg });
    }
  });

  // ─── Dashboard ─────────────────────────────────────────

  app.get("/api/dashboard", async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/dashboard/supply-chain", async (_req, res) => {
    try {
      const data = await storage.getDashboardSupplyChain();
      res.json(data);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch supply chain data" });
    }
  });

  // ─── QMS Auth ────────────────────────────────────────────

  app.get("/api/auth/users", async (_req, res) => {
    try {
      const users = await storage.getQmsUsers();
      // Never expose PINs
      res.json(users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch QMS users" });
    }
  });

  app.post("/api/auth/verify-pin", async (req, res) => {
    const { userId, pin } = req.body;
    if (!userId || !pin) return res.status(400).json({ message: "userId and pin required" });
    try {
      const ok = await storage.verifyQmsPin(String(userId), String(pin));
      if (!ok) return res.status(401).json({ message: "Incorrect PIN" });
      res.json({ verified: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to verify PIN" });
    }
  });

  // ─── QMS Dashboard ───────────────────────────────────────

  app.get("/api/qms/dashboard", async (_req, res) => {
    try {
      const stats = await storage.getQmsDashboardStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch QMS dashboard stats" });
    }
  });

  // ─── QMS Lot Releases ────────────────────────────────────

  app.get("/api/qms/lot-releases", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const releases = await storage.getLotReleases(status ? { status } : undefined);
      res.json(releases);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch lot releases" });
    }
  });

  app.get("/api/qms/lot-releases/:id", async (req, res) => {
    try {
      const release = await storage.getLotRelease(req.params.id);
      if (!release) return res.status(404).json({ message: "Lot release not found" });
      res.json(release);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch lot release" });
    }
  });

  app.post("/api/qms/lot-releases", async (req, res) => {
    try {
      const release = await storage.createLotRelease(req.body);
      res.status(201).json(release);
    } catch (err) {
      res.status(500).json({ message: "Failed to create lot release" });
    }
  });

  app.post("/api/qms/lot-releases/:id/sign", async (req, res) => {
    const { decision, signerId, signerEmail, pin, notes } = req.body;
    if (!decision || !signerId || !signerEmail || !pin) {
      return res.status(400).json({ message: "decision, signerId, signerEmail, and pin are required" });
    }
    if (!["APPROVED", "REJECTED", "ON_HOLD"].includes(decision)) {
      return res.status(400).json({ message: "decision must be APPROVED, REJECTED, or ON_HOLD" });
    }
    try {
      const release = await storage.signLotRelease(req.params.id, decision, String(signerId), String(signerEmail), String(pin), notes);
      res.json(release);
    } catch (err: any) {
      if (err.message === "Incorrect PIN") return res.status(401).json({ message: "Incorrect PIN" });
      if (err.message === "Lot release has already been decided") return res.status(409).json({ message: err.message });
      res.status(500).json({ message: err.message ?? "Failed to sign lot release" });
    }
  });

  // ─── QMS CAPAs ───────────────────────────────────────────

  app.get("/api/qms/capas", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const phase = req.query.phase as string | undefined;
      const capas = await storage.getCapas({ status, phase });
      res.json(capas);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch CAPAs" });
    }
  });

  app.get("/api/qms/capas/:id", async (req, res) => {
    try {
      const capa = await storage.getCapa(req.params.id);
      if (!capa) return res.status(404).json({ message: "CAPA not found" });
      res.json(capa);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch CAPA" });
    }
  });

  app.post("/api/qms/capas", async (req, res) => {
    try {
      const capa = await storage.createCapa(req.body);
      res.status(201).json(capa);
    } catch (err) {
      res.status(500).json({ message: "Failed to create CAPA" });
    }
  });

  app.patch("/api/qms/capas/:id", async (req, res) => {
    try {
      const capa = await storage.updateCapa(req.params.id, req.body);
      if (!capa) return res.status(404).json({ message: "CAPA not found" });
      res.json(capa);
    } catch (err) {
      res.status(500).json({ message: "Failed to update CAPA" });
    }
  });

  app.post("/api/qms/capas/:id/transition", async (req, res) => {
    const { status, actorId, actorEmail } = req.body;
    if (!status || !actorId || !actorEmail) {
      return res.status(400).json({ message: "status, actorId, and actorEmail are required" });
    }
    try {
      const capa = await storage.transitionCapa(req.params.id, status, String(actorId), String(actorEmail));
      if (!capa) return res.status(404).json({ message: "CAPA not found" });
      res.json(capa);
    } catch (err) {
      res.status(500).json({ message: "Failed to transition CAPA" });
    }
  });

  app.post("/api/qms/capa-actions", async (req, res) => {
    try {
      const action = await storage.createCapaAction(req.body);
      res.status(201).json(action);
    } catch (err) {
      res.status(500).json({ message: "Failed to create CAPA action" });
    }
  });

  app.patch("/api/qms/capa-actions/:id", async (req, res) => {
    try {
      const action = await storage.updateCapaAction(req.params.id, req.body);
      if (!action) return res.status(404).json({ message: "CAPA action not found" });
      res.json(action);
    } catch (err) {
      res.status(500).json({ message: "Failed to update CAPA action" });
    }
  });

  // ─── QMS Complaints ──────────────────────────────────────

  app.get("/api/qms/complaints", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const category = req.query.category as string | undefined;
      const complaints = await storage.getComplaints({ status, category });
      res.json(complaints);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch complaints" });
    }
  });

  app.get("/api/qms/complaints/:id", async (req, res) => {
    try {
      const complaint = await storage.getComplaint(req.params.id);
      if (!complaint) return res.status(404).json({ message: "Complaint not found" });
      res.json(complaint);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch complaint" });
    }
  });

  app.post("/api/qms/complaints", async (req, res) => {
    try {
      const complaint = await storage.createComplaint(req.body);
      res.status(201).json(complaint);
    } catch (err) {
      res.status(500).json({ message: "Failed to create complaint" });
    }
  });

  app.patch("/api/qms/complaints/:id", async (req, res) => {
    try {
      const complaint = await storage.updateComplaint(req.params.id, req.body);
      if (!complaint) return res.status(404).json({ message: "Complaint not found" });
      res.json(complaint);
    } catch (err) {
      res.status(500).json({ message: "Failed to update complaint" });
    }
  });

  app.post("/api/qms/complaints/:id/transition", async (req, res) => {
    const { status, actorId, actorEmail } = req.body;
    if (!status || !actorId || !actorEmail) {
      return res.status(400).json({ message: "status, actorId, and actorEmail are required" });
    }
    try {
      const complaint = await storage.transitionComplaint(req.params.id, status, String(actorId), String(actorEmail));
      if (!complaint) return res.status(404).json({ message: "Complaint not found" });
      res.json(complaint);
    } catch (err) {
      res.status(500).json({ message: "Failed to transition complaint" });
    }
  });

  // ─── QMS Audit Log ───────────────────────────────────────

  app.get("/api/qms/audit-log", async (req, res) => {
    try {
      const tableName = req.query.table as string | undefined;
      const recordId = req.query.recordId as string | undefined;
      const actorId = req.query.actorId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const logs = await storage.getAuditLog({ tableName, recordId, actorId, limit });
      res.json(logs);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch audit log" });
    }
  });

  return httpServer;
}
