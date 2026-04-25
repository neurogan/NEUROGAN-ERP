import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { versionInfo } from "./version";
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
  insertReceivingRecordSchema,
  insertCoaDocumentSchema,
  insertSupplierQualificationSchema,
  insertBprSchema,
  insertBprStepSchema,
  insertBprDeviationSchema,
  insertLabSchema,
  insertLabTestResultSchema,
  userRoleEnum,
  userStatusEnum,
  type UserResponse,
  type UserRole,
} from "@shared/schema";
import { z, ZodError } from "zod";
import { requireAuth, requireRole, requireRoleOrSelf, rejectIdentityInBody } from "./auth/middleware";
import { performSignature } from "./signatures/signatures";
import { hashPassword, generateTemporaryPassword } from "./auth/password";
import { errors } from "./errors";
import { withAudit } from "./audit/audit";
import { auditRouter } from "./audit/audit-routes";
import { signatureRouter } from "./signatures/signature-routes";
import { validationRouter } from "./validation/validation-routes";

function formatZodError(error: ZodError): string {
  return error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Audit trail (F-03) ────────────────────────────────
  app.use("/api/audit", requireAuth, auditRouter);

  // ─── Electronic signatures (F-04) ──────────────────────
  app.use("/api/signatures", requireAuth, signatureRouter);

  // ─── Validation documents (F-10) ───────────────────────
  app.use("/api/validation-documents", requireAuth, validationRouter);

  // ─── Health / IQ traceability ──────────────────────────
  //
  // Exposes the running code's identity (version, commit SHA, environment,
  // Node runtime, boot time) for GAMP 5 IQ records. Required per
  // first-session.md §3 bullet 6 and the platform validation package.
  // Public (no auth) so monitoring tools and the FDA audit workflow can
  // poll it without credentials — it returns no user data and no record
  // data, only the server's own metadata.
  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      ...versionInfo,
    });
  });

  // ─── Users & Roles (F-01) ──────────────────────────────
  //
  // Admin-only user management. Identity comes from req.user.id (set by F-02's
  // session deserialisation), NEVER from the request body. The middleware
  // stack below blocks unauthenticated requests (401) and wrong roles (403)
  // before the handler runs. Audit-trail rows on every regulated write are
  // added in F-03 when the audit_trail table lands.

  // Redact admin-only fields (password rotation reference, lockout state,
  // failed-login counter) for non-ADMIN viewers.
  type PublicUserView = Omit<
    UserResponse,
    "passwordChangedAt" | "lockedUntil" | "failedLoginCount"
  >;

  function projectUserForViewer(
    user: UserResponse,
    viewerRoles: readonly UserRole[],
  ): UserResponse | PublicUserView {
    if (viewerRoles.includes("ADMIN")) return user;
    const {
      passwordChangedAt: _passwordChangedAt,
      lockedUntil: _lockedUntil,
      failedLoginCount: _failedLoginCount,
      ...rest
    } = user;
    void _passwordChangedAt;
    void _lockedUntil;
    void _failedLoginCount;
    return rest;
  }

  // POST /api/users — ADMIN only. Creates a user + role rows atomically and
  // returns the UserResponse along with a one-time temporaryPassword the
  // admin shows to the new user. F-02 forces rotation of this temp password
  // on first login.
  const createUserBody = z.object({
    email: z.string().email().trim().toLowerCase(),
    fullName: z.string().min(1).trim(),
    title: z.string().trim().nullish(),
    roles: z.array(userRoleEnum).min(1, "At least one role is required"),
  });

  app.post("/api/users", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const body = createUserBody.parse(req.body);
      const tempPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(tempPassword);
      const user = await withAudit(
        {
          userId: req.user!.id,
          action: "CREATE",
          entityType: "user",
          entityId: (result) => (result as { id: string }).id,
          before: null,
          route: `${req.method} ${req.path}`,
          requestId: req.requestId,
        },
        (tx) => storage.createUser({
          email: body.email,
          fullName: body.fullName,
          title: body.title ?? null,
          passwordHash,
          roles: body.roles,
          createdByUserId: req.user!.id,
          grantedByUserId: req.user!.id,
        }, tx),
      );
      return res.status(201).json({ user, temporaryPassword: tempPassword });
    } catch (err) {
      const pgErr = err as { code?: string } | undefined;
      if (pgErr?.code === "23505") {
        const email = (req.body as { email?: string } | undefined)?.email ?? "";
        return next(errors.duplicateEmail(email));
      }
      return next(err);
    }
  });

  // GET /api/users — ADMIN, QA. Lists all users. Admin-only fields are
  // stripped for QA viewers.
  app.get("/api/users", requireAuth, requireRole("ADMIN", "QA"), async (req, res, next) => {
    try {
      const users = await storage.listUsers();
      const viewerRoles = req.user!.roles;
      return res.json(users.map((u) => projectUserForViewer(u, viewerRoles)));
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/users/:id — ADMIN, QA, or the subject user themselves.
  app.get<{ id: string }>(
    "/api/users/:id",
    requireAuth,
    requireRoleOrSelf((req) => (req.params as { id?: string }).id, "ADMIN", "QA"),
    async (req, res, next) => {
      try {
        const user = await storage.getUserById(req.params.id);
        if (!user) return next(errors.notFound("User"));
        const viewerRoles = req.user!.roles;
        return res.json(projectUserForViewer(user, viewerRoles));
      } catch (err) {
        return next(err);
      }
    },
  );

  // PATCH /api/users/:id/roles — ADMIN only. Takes { add?, remove? } and
  // computes next = (current ∖ remove) ∪ add. Blocked if the change would
  // remove the ADMIN role from the last active administrator.
  const patchRolesBody = z
    .object({
      add: z.array(userRoleEnum).optional(),
      remove: z.array(userRoleEnum).optional(),
    })
    .refine((b) => (b.add?.length ?? 0) + (b.remove?.length ?? 0) > 0, {
      message: "At least one of 'add' or 'remove' must be non-empty",
    });

  app.patch<{ id: string }>(
    "/api/users/:id/roles",
    requireAuth,
    requireRole("ADMIN"),
    async (req, res, next) => {
      try {
        const body = patchRolesBody.parse(req.body);
        const current = await storage.getUserById(req.params.id);
        if (!current) return next(errors.notFound("User"));

        const removeSet = new Set<UserRole>(body.remove ?? []);
        const addSet = new Set<UserRole>(body.add ?? []);
        const nextRoles = [
          ...new Set([...current.roles.filter((r) => !removeSet.has(r)), ...addSet]),
        ].sort() as UserRole[];

        // Last-admin guard: if the change removes ADMIN from this user and no
        // other ACTIVE admin exists, refuse with 409 LAST_ADMIN.
        const willRemoveAdmin = current.roles.includes("ADMIN") && !nextRoles.includes("ADMIN");
        if (willRemoveAdmin && (await storage.isLastActiveAdmin(req.params.id))) {
          return next(errors.lastAdmin());
        }

        const updated = await withAudit(
          {
            userId: req.user!.id,
            action: "UPDATE",
            entityType: "user",
            entityId: req.params.id,
            before: current,
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
            meta: { rolesAdded: [...(body.add ?? [])], rolesRemoved: [...(body.remove ?? [])] },
          },
          (tx) => storage.setUserRoles(req.params.id, nextRoles, req.user!.id, tx),
        );
        if (!updated) return next(errors.notFound("User"));
        return res.json(projectUserForViewer(updated, req.user!.roles));
      } catch (err) {
        return next(err);
      }
    },
  );

  // PATCH /api/users/:id/status — ADMIN only. Transitions between ACTIVE and
  // DISABLED. You cannot disable yourself, and you cannot disable the last
  // active administrator (both surface as 409).
  const patchStatusBody = z.object({
    status: userStatusEnum,
  });

  app.patch<{ id: string }>(
    "/api/users/:id/status",
    requireAuth,
    requireRole("ADMIN"),
    async (req, res, next) => {
      try {
        const body = patchStatusBody.parse(req.body);
        if (req.params.id === req.user!.id) {
          return next(errors.selfDisable());
        }
        // If disabling, guard against removing the last active admin.
        if (body.status === "DISABLED") {
          const current = await storage.getUserById(req.params.id);
          if (!current) return next(errors.notFound("User"));
          if (current.roles.includes("ADMIN") && (await storage.isLastActiveAdmin(req.params.id))) {
            return next(errors.lastAdmin());
          }
        }
        const beforeStatus = await storage.getUserById(req.params.id);
        const updated = await withAudit(
          {
            userId: req.user!.id,
            action: "UPDATE",
            entityType: "user",
            entityId: req.params.id,
            before: beforeStatus ?? null,
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
            meta: { statusChange: body.status },
          },
          (tx) => storage.updateUserStatus(req.params.id, body.status, tx),
        );
        if (!updated) return next(errors.notFound("User"));
        return res.json(projectUserForViewer(updated, req.user!.roles));
      } catch (err) {
        return next(err);
      }
    },
  );

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

  app.post("/api/products", requireAuth, requireRole("ADMIN", "QA"), async (req, res, next) => {
    try {
      const data = insertProductSchema.parse(req.body);
      const product = await storage.createProduct(data);
      res.status(201).json(product);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string }>("/api/products/:id", requireAuth, requireRole("ADMIN", "QA"), async (req, res, next) => {
    try {
      const data = insertProductSchema.partial().parse(req.body);
      const product = await storage.updateProduct(req.params.id, data);
      if (!product) return res.status(404).json({ message: "Product not found" });
      res.json(product);
    } catch (err) { next(err); }
  });

  app.delete<{ id: string }>("/api/products/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const deleted = await storage.deleteProduct(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Product not found" });
      res.status(204).send();
    } catch (err) { next(err); }
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

  app.post("/api/lots", requireAuth, requireRole("WAREHOUSE", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const data = insertLotSchema.parse(req.body);
      const lot = await withAudit(
        { userId: req.user!.id, action: "CREATE", entityType: "lot",
          entityId: (r) => (r as { id: string }).id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.createLot(data, tx),
      );
      res.status(201).json(lot);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string }>("/api/lots/:id", requireAuth, requireRole("WAREHOUSE", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const data = insertLotSchema.partial().parse(req.body);
      const before = await storage.getLot(req.params.id);
      if (!before) return res.status(404).json({ message: "Lot not found" });
      const lot = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "lot",
          entityId: req.params.id, before,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.updateLot(req.params.id, data, tx),
      );
      res.json(lot);
    } catch (err) { next(err); }
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

  app.post("/api/locations", requireAuth, requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
    try {
      const data = insertLocationSchema.parse(req.body);
      const location = await storage.createLocation(data);
      res.status(201).json(location);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string }>("/api/locations/:id", requireAuth, requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
    try {
      const data = insertLocationSchema.partial().parse(req.body);
      const location = await storage.updateLocation(req.params.id, data);
      if (!location) return res.status(404).json({ message: "Location not found" });
      res.json(location);
    } catch (err) { next(err); }
  });

  app.delete<{ id: string }>("/api/locations/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const deleted = await storage.deleteLocation(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Location not found" });
      res.status(204).send();
    } catch (err) { next(err); }
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

  app.post("/api/transactions", requireAuth, requireRole("ADMIN", "QA", "PRODUCTION", "WAREHOUSE"), async (req, res, next) => {
    try {
      const data = insertTransactionSchema.parse(req.body);
      const transaction = await withAudit(
        { userId: req.user!.id, action: "CREATE", entityType: "transaction",
          entityId: (r) => (r as { id: string }).id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.createTransaction(data, tx),
      );
      res.status(201).json(transaction);
    } catch (err) { next(err); }
  });

  // Combo endpoint: create lot + transaction atomically (for PO Receipt)
  app.post("/api/transactions/po-receipt", requireAuth, requireRole("WAREHOUSE", "QA", "ADMIN"), rejectIdentityInBody(["performedBy"]), async (req, res, next) => {
    try {
      const { lotNumber, supplierName, productId, locationId, quantity, uom, notes } = req.body;
      if (!lotNumber || !productId || !locationId || !quantity || !uom) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const result = await withAudit(
        { userId: req.user!.id, action: "CREATE", entityType: "transaction",
          entityId: (r) => (r as { transaction: { id: string } }).transaction.id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId,
          meta: { subtype: "PO_RECEIPT" } },
        async (tx) => {
          const lot = await storage.createLot({ productId, lotNumber, supplierName: supplierName || null }, tx);
          const transaction = await storage.createTransaction({
            lotId: lot.id, locationId, type: "PO_RECEIPT",
            quantity: String(Math.abs(parseFloat(quantity))),
            uom, notes: notes || null, performedBy: req.user!.id,
          }, tx);
          return { lot, transaction };
        },
      );
      res.status(201).json(result);
    } catch (err) { next(err); }
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

  app.post("/api/suppliers", requireAuth, requireRole("ADMIN", "QA", "WAREHOUSE"), async (req, res, next) => {
    try {
      const data = insertSupplierSchema.parse(req.body);
      const supplier = await storage.createSupplier(data);
      res.status(201).json(supplier);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string }>("/api/suppliers/:id", requireAuth, requireRole("ADMIN", "QA", "WAREHOUSE"), async (req, res, next) => {
    try {
      const data = insertSupplierSchema.partial().parse(req.body);
      const supplier = await storage.updateSupplier(req.params.id, data);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      res.json(supplier);
    } catch (err) { next(err); }
  });

  app.delete<{ id: string }>("/api/suppliers/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const deleted = await storage.deleteSupplier(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Supplier not found" });
      res.status(204).send();
    } catch (err) { next(err); }
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

  app.post("/api/purchase-orders", requireAuth, requireRole("ADMIN", "QA", "WAREHOUSE"), async (req, res, next) => {
    try {
      const { lineItems, ...poData } = req.body;
      const data = insertPurchaseOrderSchema.parse(poData);
      if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ message: "At least one line item is required" });
      }
      const po = await storage.createPurchaseOrder(data, lineItems);
      res.status(201).json(po);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string }>("/api/purchase-orders/:id", requireAuth, requireRole("ADMIN", "QA", "WAREHOUSE"), async (req, res, next) => {
    try {
      const po = await storage.updatePurchaseOrder(req.params.id, req.body);
      if (!po) return res.status(404).json({ message: "Purchase order not found" });
      res.json(po);
    } catch (err) { next(err); }
  });

  app.post<{ id: string }>("/api/purchase-orders/:id/submit", requireAuth, requireRole("ADMIN", "QA", "WAREHOUSE"), async (req, res, next) => {
    try {
      const po = await storage.updatePurchaseOrderStatus(req.params.id, "SUBMITTED");
      if (!po) return res.status(404).json({ message: "Purchase order not found" });
      res.json(po);
    } catch (err) { next(err); }
  });

  app.post<{ id: string }>("/api/purchase-orders/:id/cancel", requireAuth, requireRole("ADMIN", "QA", "WAREHOUSE"), async (req, res, next) => {
    try {
      const po = await storage.updatePurchaseOrderStatus(req.params.id, "CANCELLED");
      if (!po) return res.status(404).json({ message: "Purchase order not found" });
      res.json(po);
    } catch (err) { next(err); }
  });

  // ─── PO Receiving ──────────────────────────────────────

  app.post("/api/purchase-orders/receive", requireAuth, requireRole("WAREHOUSE", "QA", "ADMIN"), async (req, res) => {
    try {
      const { lineItemId, quantity, lotNumber, locationId, supplierName, expirationDate, receivedDate } = req.body;
      if (!lineItemId || !quantity || !locationId) {
        return res.status(400).json({ message: "Missing required fields: lineItemId, quantity, locationId" });
      }
      const result = await storage.receivePOLineItem(
        lineItemId,
        parseFloat(quantity),
        lotNumber || undefined,
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

  app.post("/api/production-batches", requireAuth, requireRole("PRODUCTION", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const { inputs, ...batchData } = req.body;
      const data = insertProductionBatchSchema.parse(batchData);
      if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
        return res.status(400).json({ message: "At least one input material is required" });
      }
      const batch = await withAudit(
        { userId: req.user!.id, action: "CREATE", entityType: "production_batch",
          entityId: (r) => (r as { id: string }).id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (_tx) => storage.createProductionBatch(data, inputs),
      );
      res.status(201).json(batch);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string }>("/api/production-batches/:id", requireAuth, requireRole("PRODUCTION", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const { inputs, ...batchData } = req.body;
      const before = await storage.getProductionBatch(req.params.id);
      if (!before) return res.status(404).json({ message: "Production batch not found" });
      const batch = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "production_batch",
          entityId: req.params.id, before,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (_tx) => storage.updateProductionBatch(req.params.id, batchData, inputs),
      );
      if (!batch) return res.status(404).json({ message: "Production batch not found" });
      const enriched = await storage.getProductionBatch(req.params.id);
      res.json(enriched ?? batch);
    } catch (err) { next(err); }
  });

  app.delete<{ id: string }>("/api/production-batches/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const batch = await storage.getProductionBatch(req.params.id);
      if (!batch) return res.status(404).json({ message: "Production batch not found" });
      if (batch.status === "COMPLETED") {
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
    } catch (err) { next(err); }
  });

  app.post<{ id: string }>("/api/production-batches/:id/complete", requireAuth, requireRole("PRODUCTION", "QA", "ADMIN"), rejectIdentityInBody(["qcReviewedBy"]), async (req, res, next) => {
    try {
      const { actualQuantity, outputLotNumber, outputExpirationDate, locationId, qcStatus, qcNotes, endDate, qcDisposition, yieldPercentage } = req.body;
      if (!actualQuantity || !outputLotNumber || !locationId) {
        return res.status(400).json({ message: "Missing required fields: actualQuantity, outputLotNumber, locationId" });
      }
      const before = await storage.getProductionBatch(req.params.id);
      if (!before) return res.status(404).json({ message: "Production batch not found" });
      const batch = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "production_batch",
          entityId: req.params.id, before,
          route: `${req.method} ${req.path}`, requestId: req.requestId,
          meta: { subtype: "COMPLETE" } },
        (_tx) => storage.completeProductionBatch(
          req.params.id, parseFloat(actualQuantity), outputLotNumber,
          outputExpirationDate || null, locationId, qcStatus, qcNotes,
          endDate, qcDisposition, req.user!.id, yieldPercentage,
        ),
      );
      res.json(batch);
    } catch (err) { next(err); }
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

  app.post("/api/recipes", requireAuth, requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
    try {
      const { lines, ...recipeData } = req.body;
      const data = insertRecipeSchema.parse(recipeData);
      if (!lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: "At least one recipe line is required" });
      }
      const recipe = await storage.createRecipe(data, lines);
      res.status(201).json(recipe);
    } catch (err) { next(err); }
  });

  app.patch<{ id: string }>("/api/recipes/:id", requireAuth, requireRole("ADMIN", "QA", "PRODUCTION"), async (req, res, next) => {
    try {
      const { lines, ...recipeData } = req.body;
      const recipe = await storage.updateRecipe(req.params.id, recipeData, lines);
      if (!recipe) return res.status(404).json({ message: "Recipe not found" });
      res.json(recipe);
    } catch (err) { next(err); }
  });

  app.delete<{ id: string }>("/api/recipes/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const deleted = await storage.deleteRecipe(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Recipe not found" });
      res.status(204).send();
    } catch (err) { next(err); }
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

  app.patch("/api/settings", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const settings = await storage.updateSettings(req.body);
      res.json(settings);
    } catch (err) { next(err); }
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

  app.post("/api/product-categories", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const data = insertProductCategorySchema.parse(req.body);
      const category = await storage.createProductCategory(data);
      res.status(201).json(category);
    } catch (err) { next(err); }
  });

  app.delete<{ id: string }>("/api/product-categories/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const deleted = await storage.deleteProductCategory(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Category not found" });
      res.json({ message: "Deleted" });
    } catch (err) { next(err); }
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

  app.post("/api/product-category-assignments", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { productId, categoryId } = req.body;
      if (!productId || !categoryId) return res.status(400).json({ message: "productId and categoryId required" });
      const assignment = await storage.assignProductCategory(productId, categoryId);
      res.status(201).json(assignment);
    } catch (err) { next(err); }
  });

  app.delete("/api/product-category-assignments", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { productId, categoryId } = req.body;
      if (!productId || !categoryId) return res.status(400).json({ message: "productId and categoryId required" });
      const deleted = await storage.unassignProductCategory(productId, categoryId);
      if (!deleted) return res.status(404).json({ message: "Assignment not found" });
      res.json({ message: "Unassigned" });
    } catch (err) { next(err);
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

  app.post("/api/production-batches/:id/notes", requireAuth, async (req, res, next) => {
    try {
      const data = insertProductionNoteSchema.parse({ ...req.body, batchId: req.params.id });
      const note = await storage.createProductionNote(data);
      res.status(201).json(note);
    } catch (err) { next(err); }
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

  app.post("/api/suppliers/:id/documents", requireAuth, requireRole("ADMIN", "QA", "WAREHOUSE"), async (req, res, next) => {
    try {
      const data = { ...req.body, supplierId: req.params.id };
      const doc = await storage.createSupplierDocument(data);
      res.status(201).json(doc);
    } catch (err) { next(err); }
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

  app.delete<{ supplierId: string; docId: string }>("/api/suppliers/:supplierId/documents/:docId", requireAuth, requireRole("ADMIN", "QA"), async (req, res, next) => {
    try {
      const deleted = await storage.deleteSupplierDocument(req.params.docId);
      if (!deleted) return res.status(404).json({ message: "Document not found" });
      res.json({ message: "Deleted" });
    } catch (err) { next(err); }
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

  app.post("/api/receiving", requireAuth, requireRole("WAREHOUSE", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const data = insertReceivingRecordSchema.parse(req.body);
      const record = await withAudit(
        { userId: req.user!.id, action: "CREATE", entityType: "receiving_record",
          entityId: (r) => (r as { id: string }).id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.createReceivingRecord(data, tx),
      );
      res.status(201).json(record);
    } catch (err) { next(err); }
  });

  app.put<{ id: string }>("/api/receiving/:id", requireAuth, requireRole("WAREHOUSE", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const baseSchema = insertReceivingRecordSchema.partial().extend({ visualExamAt: z.coerce.date().optional().nullable() });
      const data = baseSchema.parse(req.body);
      const before = await storage.getReceivingRecord(req.params.id);
      if (!before) return res.status(404).json({ message: "Not found" });
      const record = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "receiving_record",
          entityId: req.params.id, before,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.updateReceivingRecord(req.params.id, data, req.user!.id, tx),
      );
      res.json(record);
    } catch (err) { next(err); }
  });

  app.post<{ id: string }>(
    "/api/receiving/:id/qc-review",
    requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["reviewedBy"]),
    async (req, res, next) => {
      try {
        const { disposition, notes, password, commentary } = req.body as {
          disposition?: string; notes?: string; password?: string; commentary?: string;
        };
        if (!disposition) return res.status(400).json({ message: "disposition required" });
        if (!password) return res.status(400).json({ message: "password required for electronic signature" });
        const record = await performSignature(
          {
            userId: req.user!.id,
            password,
            meaning: "QC_DISPOSITION",
            entityType: "receiving_record",
            entityId: req.params.id,
            commentary: commentary ?? null,
            recordSnapshot: { disposition, notes },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          (tx) => storage.qcReviewReceivingRecord(req.params.id, disposition, req.user!.id, notes, tx),
        );
        if (!record) return res.status(404).json({ message: "Not found" });
        res.json(record);
      } catch (err) {
        next(err);
      }
    },
  );

  // ─── COA Documents ────────────────────────────────────

  app.post("/api/coa", requireAuth, requireRole("WAREHOUSE", "QA", "ADMIN", "LAB_TECH"), async (req, res, next) => {
    try {
      const data = insertCoaDocumentSchema.parse(req.body);
      const doc = await withAudit(
        { userId: req.user!.id, action: "CREATE", entityType: "coa_document",
          entityId: (r) => (r as { id: string }).id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.createCoaDocument(data, tx),
      );
      res.status(201).json(doc);
    } catch (err) { next(err); }
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

  app.put<{ id: string }>("/api/coa/:id", requireAuth, requireRole("WAREHOUSE", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const data = insertCoaDocumentSchema.partial().parse(req.body);
      const before = await storage.getCoaDocument(req.params.id);
      if (!before) return res.status(404).json({ message: "COA document not found" });
      const doc = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "coa_document",
          entityId: req.params.id, before,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.updateCoaDocument(req.params.id, data, tx),
      );
      res.json(doc);
    } catch (err) { next(err); }
  });

  app.post<{ id: string }>(
    "/api/coa/:id/qc-review",
    requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["reviewedBy"]),
    async (req, res, next) => {
      try {
        const { accepted, notes, password, commentary } = req.body as {
          accepted?: unknown; notes?: string; password?: string; commentary?: string;
        };
        if (typeof accepted !== "boolean") {
          return res.status(400).json({ message: "accepted (boolean) is required" });
        }
        if (!password) return res.status(400).json({ message: "password required for electronic signature" });
        const doc = await performSignature(
          {
            userId: req.user!.id,
            password,
            meaning: "QC_DISPOSITION",
            entityType: "coa_document",
            entityId: req.params.id,
            commentary: commentary ?? null,
            recordSnapshot: { accepted, notes },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          (tx) => storage.qcReviewCoa(req.params.id, accepted, req.user!.id, notes, tx),
        );
        if (!doc) return res.status(404).json({ message: "COA document not found" });
        res.json(doc);
      } catch (err) {
        next(err);
      }
    },
  );

  // ─── Lab Test Results (T-06 §111.75) ─────────────────

  // §111.75: lab result entry — LAB_TECH performs, QA/ADMIN can also enter
  app.post<{ id: string }>("/api/coa/:id/results",
    requireAuth, requireRole("LAB_TECH", "QA", "ADMIN"), rejectIdentityInBody(["testedByUserId", "coaDocumentId"]),
    async (req, res, next) => {
      try {
        const coa = await storage.getCoaDocument(req.params.id);
        if (!coa) return res.status(404).json({ message: "COA document not found" });
        const data = insertLabTestResultSchema.parse(req.body);
        const result = await withAudit(
          { userId: req.user!.id, action: "LAB_RESULT_ADDED", entityType: "lab_test_result",
            entityId: (r) => (r as { id: string }).id, before: null,
            route: `${req.method} ${req.path}`, requestId: req.requestId },
          (tx) => storage.addLabTestResult(req.params.id, data, req.user!.id, tx),
        );
        res.status(201).json(result);
      } catch (err) { next(err); }
    },
  );

  app.get<{ id: string }>("/api/coa/:id/results", requireAuth, async (req, res, next) => {
    try {
      const results = await storage.getLabTestResults(req.params.id);
      res.json(results);
    } catch (err) { next(err); }
  });

  // ─── Supplier Qualifications ──────────────────────────

  app.post("/api/supplier-qualifications", requireAuth, requireRole("ADMIN", "QA"), async (req, res, next) => {
    try {
      const data = insertSupplierQualificationSchema.parse(req.body);
      const sq = await storage.createSupplierQualification(data);
      res.status(201).json(sq);
    } catch (err) { next(err); }
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

  app.put<{ id: string }>("/api/supplier-qualifications/:id", requireAuth, requireRole("ADMIN", "QA"), async (req, res, next) => {
    try {
      const data = insertSupplierQualificationSchema.partial().parse(req.body);
      const sq = await storage.updateSupplierQualification(req.params.id, data);
      if (!sq) return res.status(404).json({ message: "Supplier qualification not found" });
      res.json(sq);
    } catch (err) { next(err); }
  });

  // ─── Batch Production Records ────────────────────────────

  app.post("/api/batch-production-records", requireAuth, requireRole("PRODUCTION", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const data = insertBprSchema.parse(req.body);
      const bpr = await withAudit(
        { userId: req.user!.id, action: "CREATE", entityType: "batch_production_record",
          entityId: (r) => (r as { id: string }).id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.createBpr(data, tx),
      );
      res.status(201).json(bpr);
    } catch (err) { next(err); }
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

  app.put<{ id: string }>("/api/batch-production-records/:id", requireAuth, requireRole("PRODUCTION", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const data = insertBprSchema.partial().parse(req.body);
      const before = await storage.getBpr(req.params.id);
      if (!before) return res.status(404).json({ message: "BPR not found" });
      const bpr = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "batch_production_record",
          entityId: req.params.id, before,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.updateBpr(req.params.id, data, tx),
      );
      res.json(bpr);
    } catch (err) { next(err); }
  });

  app.post<{ id: string }>("/api/batch-production-records/:id/submit-for-review", requireAuth, requireRole("PRODUCTION", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const before = await storage.getBpr(req.params.id);
      if (!before) return res.status(404).json({ message: "BPR not found" });
      const bpr = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "batch_production_record",
          entityId: req.params.id, before,
          route: `${req.method} ${req.path}`, requestId: req.requestId,
          meta: { subtype: "SUBMIT_FOR_REVIEW" } },
        (tx) => storage.submitBprForReview(req.params.id, tx),
      );
      res.json(bpr);
    } catch (err) { next(err); }
  });

  app.post<{ id: string }>(
    "/api/batch-production-records/:id/qc-review",
    requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["reviewedBy"]),
    async (req, res, next) => {
      try {
        const { disposition, notes, password, commentary } = req.body as {
          disposition?: string; notes?: string; password?: string; commentary?: string;
        };
        if (!disposition) return res.status(400).json({ message: "disposition is required" });
        if (!password) return res.status(400).json({ message: "password required for electronic signature" });
        const bpr = await performSignature(
          {
            userId: req.user!.id,
            password,
            meaning: "QC_DISPOSITION",
            entityType: "batch_production_record",
            entityId: req.params.id,
            commentary: commentary ?? null,
            recordSnapshot: { disposition, notes },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          (tx) => storage.qcReviewBpr(req.params.id, disposition, req.user!.id, notes, tx),
        );
        if (!bpr) return res.status(404).json({ message: "BPR not found" });
        res.json(bpr);
      } catch (err) {
        next(err);
      }
    },
  );

  app.post<{ id: string }>("/api/batch-production-records/:id/steps", requireAuth, async (req, res) => {
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

  app.put<{ id: string; stepId: string }>("/api/batch-production-records/:id/steps/:stepId", requireAuth, async (req, res) => {
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

  app.post<{ id: string }>("/api/batch-production-records/:id/deviations", requireAuth, async (req, res) => {
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

  // ── Labs registry ──────────────────────────────────────────────────────────

  app.get("/api/labs", requireAuth, requireRole("QA", "ADMIN"), async (_req, res, next) => {
    try {
      const labs = await storage.listLabs();
      res.json(labs);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/labs", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const data = insertLabSchema.parse(req.body);
      const lab = await storage.createLab(data);
      res.status(201).json(lab);
    } catch (err) {
      next(err);
    }
  });

  app.patch<{ id: string }>("/api/labs/:id", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const data = insertLabSchema.partial().parse(req.body);
      if (data.status === "ACTIVE") {
        const allLabs = await storage.listLabs();
        const existing = allLabs.find((l) => l.id === req.params.id);
        if (!existing) return res.status(404).json({ message: "Lab not found" });
        if (existing.type === "THIRD_PARTY") {
          return res.status(400).json({ message: "Use POST /api/labs/:id/qualify to activate a third-party lab." });
        }
      }
      const lab = await storage.updateLab(req.params.id, data);
      if (!lab) return res.status(404).json({ message: "Lab not found" });
      res.json(lab);
    } catch (err) {
      next(err);
    }
  });

  app.post<{ id: string }>(
    "/api/labs/:id/qualify",
    requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["performedByUserId"]),
    async (req, res, next) => {
      try {
        const { qualificationMethod, requalificationFrequencyMonths, notes, signaturePassword } = req.body as {
          qualificationMethod?: string;
          requalificationFrequencyMonths?: number;
          notes?: string;
          signaturePassword?: string;
        };
        if (!qualificationMethod) return res.status(400).json({ message: "qualificationMethod required" });
        if (!requalificationFrequencyMonths || Number(requalificationFrequencyMonths) < 1) return res.status(400).json({ message: "requalificationFrequencyMonths must be a positive integer" });
        if (!signaturePassword) return res.status(400).json({ message: "signaturePassword required for electronic signature" });

        const lab = await performSignature(
          {
            userId: req.user!.id,
            password: signaturePassword,
            meaning: "LAB_APPROVAL",
            entityType: "lab",
            entityId: req.params.id,
            commentary: notes ?? null,
            recordSnapshot: { qualificationMethod, requalificationFrequencyMonths },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          (tx) =>
            storage.recordLabQualification(
              req.params.id,
              req.user!.id,
              qualificationMethod,
              Number(requalificationFrequencyMonths),
              notes,
              req.requestId,
              `${req.method} ${req.path}`,
              tx,
            ),
        );
        if (!lab) return res.status(404).json({ message: "Lab not found" });
        res.json(lab);
      } catch (err) {
        next(err);
      }
    },
  );

  app.post<{ id: string }>(
    "/api/labs/:id/disqualify",
    requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["performedByUserId"]),
    async (req, res, next) => {
      try {
        const { notes, signaturePassword } = req.body as { notes?: string; signaturePassword?: string };
        if (!signaturePassword) return res.status(400).json({ message: "signaturePassword required for electronic signature" });

        const lab = await performSignature(
          {
            userId: req.user!.id,
            password: signaturePassword,
            meaning: "LAB_DISQUALIFICATION",
            entityType: "lab",
            entityId: req.params.id,
            commentary: notes ?? null,
            recordSnapshot: { notes: notes ?? null },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          (tx) =>
            storage.recordLabDisqualification(
              req.params.id,
              req.user!.id,
              notes,
              req.requestId,
              `${req.method} ${req.path}`,
              tx,
            ),
        );
        if (!lab) return res.status(404).json({ message: "Lab not found" });
        res.json(lab);
      } catch (err) {
        next(err);
      }
    },
  );

  app.get<{ id: string }>(
    "/api/labs/:id/qualifications",
    requireAuth,
    async (req, res, next) => {
      try {
        const history = await storage.getLabQualificationHistory(req.params.id);
        res.json(history);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Approved materials ──────────────────────────────────────────────────────

  app.get("/api/approved-materials", requireAuth, requireRole("QA", "ADMIN"), async (_req, res, next) => {
    try {
      const items = await storage.listApprovedMaterials();
      res.json(items);
    } catch (err) {
      next(err);
    }
  });

  app.delete<{ id: string }>("/api/approved-materials/:id", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const revoked = await withAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "approved_material",
          entityId: req.params.id,
          before: null,
          route: `${req.method} ${req.path}`,
          requestId: req.requestId,
        },
        (_tx) => storage.revokeApprovedMaterial(req.params.id),
      );
      if (!revoked) return res.status(404).json({ message: "Approved material not found" });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // ─── User tasks (R-01) ─────────────────────────────────

  app.get("/api/tasks", requireAuth, async (req, res, next) => {
    try {
      const tasks = await storage.getUserTasks(req.user!.id, req.user!.roles);
      res.json(tasks);
    } catch (err) {
      next(err);
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

  return httpServer;
}
