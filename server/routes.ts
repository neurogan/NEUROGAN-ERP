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
  insertEquipmentSchema,
  userRoleEnum,
  userStatusEnum,
  type UserResponse,
  type UserRole,
} from "@shared/schema";
import * as schema from "@shared/schema";
import { z, ZodError } from "zod";
import { requireAuth, requireRole, requireRoleOrSelf, rejectIdentityInBody } from "./auth/middleware";
import { performSignature } from "./signatures/signatures";
import { hashPassword, generateInviteToken } from "./auth/password";
import { sendInviteEmail } from "./email/resend";
import { errors } from "./errors";
import { writeAuditRow, withAudit } from "./audit/audit";
import { auditRouter } from "./audit/audit-routes";
import { signatureRouter } from "./signatures/signature-routes";
import { validationRouter } from "./validation/validation-routes";
import { mmrRouter } from "./routes/mmr-routes";
import { componentSpecRouter } from "./routes/component-spec-routes";
import { db } from "./db";
import { eq, and, desc, ne, isNull } from "drizzle-orm";
import * as equipmentStorage from "./storage/equipment";
import * as cleaningStorage from "./storage/cleaning-line-clearance";
import * as artworkStorage from "./storage/label-artwork";
import * as spoolStorage from "./storage/label-spools";
import * as issuanceStorage from "./storage/label-issuance";
import * as sopStorage from "./storage/sops";
import * as reconciliationStorage from "./storage/label-reconciliations";
import * as complaintsStorage from "./storage/complaints";
import * as returnsStorage from "./storage/returned-products";
import { requireHmacOrAuth } from "./auth/middleware";
import { HELPCORE_SYSTEM_USER_ID } from "./seed/ids";
import { getLabelPrintAdapter } from "./printing/registry";
import { runCompletionGates, CompletionGateError } from "./state/bpr-completion-gates";

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

  // ─── Master Manufacturing Records (R-07) ───────────────
  app.use("/api/mmrs", requireAuth, mmrRouter);

  // ─── Component Specifications ───────────────────────────
  app.use("/api/component-specs", requireAuth, componentSpecRouter);

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

  // POST /api/users — ADMIN only. Creates a PENDING_INVITE user + role rows
  // and sends an invite email with a one-time token. The user sets their own
  // password via /set-password (T-09).
  const createUserBody = z.object({
    email: z.string().email().trim().toLowerCase(),
    fullName: z.string().min(1).trim(),
    title: z.string().trim().nullish(),
    roles: z.array(userRoleEnum).min(1, "At least one role is required"),
  });

  app.post("/api/users", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const body = createUserBody.parse(req.body);
      const rawToken = generateInviteToken();
      const tokenHash = await hashPassword(rawToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Send the invite email before persisting the user — if Resend fails we
      // return 502 without creating a PENDING_INVITE row that can never be
      // reached (no email was delivered to complete the flow).
      try {
        await sendInviteEmail(body.email, rawToken);
      } catch {
        return res.status(502).json({ error: { code: "EMAIL_DELIVERY_FAILED", message: "Failed to send invite email. Please try again." } });
      }

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
          passwordHash: "$invite_pending$",
          status: "PENDING_INVITE",
          inviteTokenHash: tokenHash,
          inviteTokenExpiresAt: expiresAt,
          roles: body.roles,
          createdByUserId: req.user!.id,
          grantedByUserId: req.user!.id,
        }, tx),
      );

      return res.status(201).json({ user });
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

  // POST /api/users/:id/resend-invite — ADMIN only. Generates a fresh invite token
  // and resends the invite email. Only valid when user.status === 'PENDING_INVITE'.
  app.post("/api/users/:id/resend-invite", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const user = await storage.getUserById(req.params.id as string);
      if (!user) return next(errors.notFound("User"));
      if (user.status !== "PENDING_INVITE") {
        return res.status(400).json({
          error: { code: "VALIDATION_FAILED", message: "User has already accepted their invite." },
        });
      }

      const rawToken = generateInviteToken();
      const tokenHash = await hashPassword(rawToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Send email before rotating the stored token — if Resend fails the old
      // token remains valid so the user's existing link still works.
      try {
        await sendInviteEmail(user.email, rawToken);
      } catch {
        return res.status(502).json({ error: { code: "EMAIL_DELIVERY_FAILED", message: "Failed to send invite email. Please try again." } });
      }

      await storage.renewInviteToken(user.id, tokenHash, expiresAt);

      await writeAuditRow({
        userId: req.user!.id,
        action: "INVITE_RESENT",
        entityType: "user",
        entityId: user.id,
        route: `${req.method} ${req.path}`,
        requestId: req.requestId,
      });

      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/users/directory — any authenticated user. Returns minimal user
  // info (id, fullName, email) for use in dropdowns where dual-verification
  // or signer selection is required (e.g. cleaning logs F-05). Operators are
  // exactly who submits cleaning logs but cannot list /api/users (ADMIN/QA
  // only), so this minimal directory is the access path that lets non-managers
  // populate cleanedBy/verifiedBy pickers.
  app.get("/api/users/directory", requireAuth, async (_req, res, next) => {
    try {
      const users = await storage.listUsers();
      res.json(
        users
          .filter((u) => u.status === "ACTIVE")
          .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email })),
      );
    } catch (err) {
      next(err);
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

  // Default equipment list for a product, used to pre-fill the BPR Start
  // modal (R-03 Task 15). Excludes RETIRED equipment so operators don't see
  // decommissioned assets in the picker. Public-readable to mirror
  // GET /api/products/:id (no auth) — returns only equipment master rows,
  // no batch- or signature-related data.
  app.get("/api/products/:id/equipment", async (req, res) => {
    try {
      const rows = await db
        .select({ equipment: schema.equipment })
        .from(schema.equipment)
        .innerJoin(
          schema.productEquipment,
          eq(schema.productEquipment.equipmentId, schema.equipment.id),
        )
        .where(
          and(
            eq(schema.productEquipment.productId, req.params.id),
            ne(schema.equipment.status, "RETIRED"),
          ),
        );
      res.json(rows.map((r) => r.equipment));
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch product equipment" });
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
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.code === "USE_START_ENDPOINT") {
        return res.status(400).json({ code: e.code, message: e.message });
      }
      next(err);
    }
  });

  app.post<{ id: string }>("/api/production-batches/:id/start", requireAuth, requireRole("PRODUCTION", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const { equipmentIds } = req.body as { equipmentIds?: unknown };
      if (!Array.isArray(equipmentIds) || !equipmentIds.every((v) => typeof v === "string")) {
        return res.status(400).json({ message: "equipmentIds (string[]) is required" });
      }
      const batch = await storage.startProductionBatch(
        req.params.id,
        req.user!.id,
        equipmentIds as string[],
        req.requestId,
        `${req.method} ${req.path}`,
      );
      res.json(batch);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string; payload?: unknown };
      if (
        e.code === "EQUIPMENT_LIST_EMPTY" ||
        e.code === "CALIBRATION_OVERDUE" ||
        e.code === "EQUIPMENT_NOT_QUALIFIED" ||
        e.code === "LINE_CLEARANCE_MISSING"
      ) {
        return res.status(409).json({ code: e.code, message: e.message, payload: e.payload });
      }
      if (e.code === "USE_START_ENDPOINT") {
        return res.status(400).json({ code: e.code, message: e.message });
      }
      if (e.code === "LOT_NOT_APPROVED") {
        return res.status(400).json({ code: e.code, message: e.message });
      }
      if (typeof e.status === "number") {
        return res.status(e.status).json({ message: e.message });
      }
      next(err);
    }
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

      // Completion gate: enforce label reconciliation requirements before
      // allowing IN_PROGRESS → COMPLETE transition. Other status changes
      // (e.g. ON_HOLD → IN_PROGRESS) do NOT trigger this gate.
      const newStatus = data.status;
      if (newStatus === "COMPLETED") {
        await runCompletionGates(req.params.id);
      }

      const bpr = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "batch_production_record",
          entityId: req.params.id, before,
          route: `${req.method} ${req.path}`, requestId: req.requestId },
        (tx) => storage.updateBpr(req.params.id, data, tx),
      );
      res.json(bpr);
    } catch (err) {
      if (CompletionGateError.is(err)) {
        return res.status(409).json({ code: err.code, message: err.message });
      }
      next(err);
    }
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

        // R-08: block approval if any process deviations are unsigned
        const unsignedDeviations = await db
          .select({ id: schema.bprDeviations.id })
          .from(schema.bprDeviations)
          .where(and(
            eq(schema.bprDeviations.bprId, req.params.id),
            isNull(schema.bprDeviations.signatureId),
          ));
        if (unsignedDeviations.length > 0) {
          return res.status(409).json({
            code: "DEVIATIONS_UNSIGNED",
            message: `${unsignedDeviations.length} deviation(s) require sign-off before QC approval.`,
            deviationIds: unsignedDeviations.map((d) => d.id),
          });
        }

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

      // R-04 Obs 10: If a SOP citation is provided, validate it is APPROVED.
      if (data.sopCode && data.sopVersion) {
        const sop = await sopStorage.getSopByCode(data.sopCode, data.sopVersion);
        if (!sop || sop.status !== "APPROVED") {
          return res.status(409).json({ code: "SOP_NOT_APPROVED", message: "SOP must be APPROVED to cite in a BPR step" });
        }
      }

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

  // R-08: Part 11 sign-off on a single process deviation (§111.210(h)(3)(iv))
  app.post<{ id: string; deviationId: string }>(
    "/api/batch-production-records/:id/deviations/:deviationId/review",
    requireAuth, requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const { password, commentary } = req.body as { password?: string; commentary?: string };
        if (!password) return res.status(400).json({ message: "password required for electronic signature" });

        const [deviation] = await db
          .select()
          .from(schema.bprDeviations)
          .where(and(
            eq(schema.bprDeviations.id, req.params.deviationId),
            eq(schema.bprDeviations.bprId, req.params.id),
          ))
          .limit(1);
        if (!deviation) return res.status(404).json({ message: "Deviation not found" });
        if (deviation.signatureId) return res.status(409).json({ code: "ALREADY_SIGNED", message: "Deviation already signed" });

        await performSignature(
          {
            userId: req.user!.id,
            password,
            meaning: "DEVIATION_DISPOSITION",
            entityType: "bpr_deviation",
            entityId: req.params.deviationId,
            commentary: commentary ?? null,
            recordSnapshot: { bprId: req.params.id, deviationDescription: deviation.deviationDescription },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          async (_tx) => { return; },
        );

        // Signature is now committed — link it to the deviation
        const [newSig] = await db
          .select({ id: schema.electronicSignatures.id })
          .from(schema.electronicSignatures)
          .where(
            and(
              eq(schema.electronicSignatures.entityId, req.params.deviationId),
              eq(schema.electronicSignatures.meaning, "DEVIATION_DISPOSITION"),
            ),
          )
          .orderBy(desc(schema.electronicSignatures.signedAt))
          .limit(1);
        await db
          .update(schema.bprDeviations)
          .set({ signatureId: newSig!.id })
          .where(eq(schema.bprDeviations.id, req.params.deviationId));

        const [updated] = await db
          .select()
          .from(schema.bprDeviations)
          .where(eq(schema.bprDeviations.id, req.params.deviationId))
          .limit(1);
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

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

  // ─── Equipment master (R-03) ───────────────────────────────────────────

  app.post("/api/equipment", requireAuth, requireRole("ADMIN", "QA"), async (req, res, next) => {
    try {
      const parseResult = insertEquipmentSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: parseResult.error.flatten() });
      }
      const data = parseResult.data;
      const equip = await equipmentStorage.createEquipment(
        data,
        req.user!.id,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      res.status(201).json(equip);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 409 && e.code === "DUPLICATE_ASSET_TAG") {
        return res.status(409).json({ code: e.code, message: e.message });
      }
      next(err);
    }
  });

  app.get("/api/equipment", requireAuth, async (_req, res, next) => {
    try {
      const list = await equipmentStorage.listEquipment();
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  app.get<{ id: string }>("/api/equipment/:id", requireAuth, async (req, res, next) => {
    try {
      const equip = await equipmentStorage.getEquipment(req.params.id);
      if (!equip) return res.status(404).json({ message: "Equipment not found" });
      res.json(equip);
    } catch (err) {
      next(err);
    }
  });

  app.patch<{ id: string }>("/api/equipment/:id/retire", requireAuth, requireRole("ADMIN", "QA"), async (req, res, next) => {
    try {
      const equip = await equipmentStorage.retireEquipment(
        req.params.id,
        req.user!.id,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      res.json(equip);
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 404) {
        return res.status(404).json({ message: "Equipment not found" });
      }
      next(err);
    }
  });

  // ─── Equipment qualifications (R-03 Task 4: IQ/OQ/PQ + F-04 signature) ─

  app.post<{ id: string }>(
    "/api/equipment/:id/qualifications",
    requireAuth,
    requireRole("ADMIN", "QA"),
    async (req, res, next) => {
      try {
        const body = req.body as {
          type?: "IQ" | "OQ" | "PQ";
          status?: "PENDING" | "QUALIFIED" | "EXPIRED";
          validFrom?: string;
          validUntil?: string;
          documentUrl?: string;
          notes?: string;
          signaturePassword?: string;
          commentary?: string;
        };
        if (!body.type || !["IQ", "OQ", "PQ"].includes(body.type)) {
          return res.status(400).json({ message: "type must be IQ, OQ, or PQ" });
        }
        if (!body.status || !["PENDING", "QUALIFIED", "EXPIRED"].includes(body.status)) {
          return res.status(400).json({ message: "status must be PENDING, QUALIFIED, or EXPIRED" });
        }
        const row = await equipmentStorage.recordQualification(
          req.params.id,
          req.user!.id,
          {
            type: body.type,
            status: body.status,
            validFrom: body.validFrom,
            validUntil: body.validUntil,
            documentUrl: body.documentUrl,
            notes: body.notes,
            signaturePassword: body.signaturePassword,
            commentary: body.commentary,
          },
          req.requestId,
          `${req.method} ${req.path}`,
        );
        res.status(201).json(row);
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        if (e.status === 404) return res.status(404).json({ message: e.message ?? "Equipment not found" });
        if (e.status === 400) return res.status(400).json({ code: e.code, message: e.message });
        if (e.status === 401 || e.status === 423) {
          return res.status(e.status).json({ error: { code: e.code, message: e.message } });
        }
        next(err);
      }
    },
  );

  app.get<{ id: string }>(
    "/api/equipment/:id/qualifications",
    requireAuth,
    async (req, res, next) => {
      try {
        const list = await equipmentStorage.listQualifications(req.params.id);
        res.json(list);
      } catch (err) {
        next(err);
      }
    },
  );

  app.post<{ id: string }>(
    "/api/equipment/:id/disqualify",
    requireAuth,
    requireRole("ADMIN", "QA"),
    async (req, res, next) => {
      try {
        const body = req.body as {
          type?: "IQ" | "OQ" | "PQ";
          notes?: string;
        };
        if (!body.type || !["IQ", "OQ", "PQ"].includes(body.type)) {
          return res.status(400).json({ message: "type must be IQ, OQ, or PQ" });
        }
        const row = await equipmentStorage.recordQualification(
          req.params.id,
          req.user!.id,
          {
            type: body.type,
            status: "EXPIRED",
            notes: body.notes,
          },
          req.requestId,
          `${req.method} ${req.path}`,
        );
        res.status(201).json(row);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404) return res.status(404).json({ message: e.message ?? "Equipment not found" });
        next(err);
      }
    },
  );

  // ─── Equipment calibration (R-03 Task 5) ──────────────────────────────

  app.post<{ id: string }>(
    "/api/equipment/:id/calibration-schedule",
    requireAuth,
    requireRole("ADMIN", "QA"),
    async (req, res, next) => {
      try {
        const body = req.body as { frequencyDays?: number };
        if (
          body.frequencyDays === undefined ||
          !Number.isInteger(body.frequencyDays) ||
          body.frequencyDays <= 0
        ) {
          return res.status(400).json({ message: "frequencyDays must be a positive integer" });
        }
        const sched = await equipmentStorage.createCalibrationSchedule(
          req.params.id,
          body.frequencyDays,
          req.user!.id,
          req.requestId,
          `${req.method} ${req.path}`,
        );
        res.status(201).json(sched);
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        if (e.status === 404) return res.status(404).json({ message: e.message ?? "Equipment not found" });
        if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
        next(err);
      }
    },
  );

  app.post<{ id: string }>(
    "/api/equipment/:id/calibration",
    requireAuth,
    requireRole("ADMIN", "QA"),
    async (req, res, next) => {
      try {
        const body = req.body as {
          result?: "PASS" | "FAIL";
          certUrl?: string;
          notes?: string;
          signaturePassword?: string;
          commentary?: string;
        };
        if (!body.result || !["PASS", "FAIL"].includes(body.result)) {
          return res.status(400).json({ message: "result must be PASS or FAIL" });
        }
        if (!body.signaturePassword) {
          return res
            .status(400)
            .json({ code: "SIGNATURE_REQUIRED", message: "signaturePassword required to record calibration" });
        }
        const row = await equipmentStorage.recordCalibration(
          req.params.id,
          req.user!.id,
          {
            result: body.result,
            certUrl: body.certUrl,
            notes: body.notes,
            signaturePassword: body.signaturePassword,
            commentary: body.commentary,
          },
          req.requestId,
          `${req.method} ${req.path}`,
        );
        res.status(201).json(row);
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        if (e.status === 404) return res.status(404).json({ message: e.message ?? "Equipment not found" });
        if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
        if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
        if (e.status === 400) return res.status(400).json({ code: e.code, message: e.message });
        next(err);
      }
    },
  );

  app.get<{ id: string }>(
    "/api/equipment/:id/calibration",
    requireAuth,
    async (req, res, next) => {
      try {
        const status = await equipmentStorage.getCalibrationStatus(req.params.id);
        res.json(status);
      } catch (err) {
        next(err);
      }
    },
  );

  // ─── Equipment cleaning logs (R-03 Task 6: F-05 dual-verification) ───
  //
  // Role gating: requireAuth only. The F-05 gate (cleaner ≠ verifier) is the
  // real access control here — anyone authenticated can record a cleaning,
  // but the storage-level check + DB CHECK constraint ensure two distinct
  // users sign off.

  app.post<{ id: string }>(
    "/api/equipment/:id/cleaning-logs",
    requireAuth,
    async (req, res, next) => {
      try {
        const body = req.body as {
          cleanedByUserId?: string;
          verifiedByUserId?: string;
          method?: string;
          priorProductId?: string;
          nextProductId?: string;
          notes?: string;
          signaturePassword?: string;
          commentary?: string;
        };
        if (!body.cleanedByUserId || typeof body.cleanedByUserId !== "string") {
          return res.status(400).json({ message: "cleanedByUserId is required" });
        }
        if (!body.verifiedByUserId || typeof body.verifiedByUserId !== "string") {
          return res.status(400).json({ message: "verifiedByUserId is required" });
        }
        if (!body.signaturePassword) {
          return res.status(400).json({
            code: "SIGNATURE_REQUIRED",
            message: "signaturePassword is required to record cleaning",
          });
        }
        const log = await cleaningStorage.createCleaningLog(
          req.params.id,
          req.user!.id,
          {
            cleanedByUserId: body.cleanedByUserId,
            verifiedByUserId: body.verifiedByUserId,
            method: body.method,
            priorProductId: body.priorProductId,
            nextProductId: body.nextProductId,
            notes: body.notes,
            signaturePassword: body.signaturePassword,
            commentary: body.commentary,
          },
          req.requestId,
          `${req.method} ${req.path}`,
        );
        res.status(201).json(log);
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        if (e.status === 404) return res.status(404).json({ message: e.message ?? "Equipment not found" });
        if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
        if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
        if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
        if (e.status === 400) return res.status(400).json({ code: e.code, message: e.message });
        next(err);
      }
    },
  );

  app.get<{ id: string }>(
    "/api/equipment/:id/cleaning-logs",
    requireAuth,
    async (req, res, next) => {
      try {
        const list = await cleaningStorage.listCleaningLogs(req.params.id);
        res.json(list);
      } catch (err) {
        next(err);
      }
    },
  );

  // ─── Equipment line clearances (R-03 Task 7: F-04 product changeover) ─
  //
  // Role gating: requireAuth only. The F-04 signature ceremony is the access
  // control. Single-signer (the request initiator). Used by the BPR start
  // gate (Task 8) via cleaningStorage.findClearance.

  app.post<{ id: string }>(
    "/api/equipment/:id/line-clearances",
    requireAuth,
    async (req, res, next) => {
      try {
        const body = req.body as {
          productChangeFromId?: string | null;
          productChangeToId?: string;
          notes?: string;
          signaturePassword?: string;
          commentary?: string;
        };
        if (!body.productChangeToId || typeof body.productChangeToId !== "string") {
          return res.status(400).json({
            code: "PRODUCT_TO_REQUIRED",
            message: "productChangeToId is required",
          });
        }
        if (!body.signaturePassword) {
          return res.status(400).json({
            code: "SIGNATURE_REQUIRED",
            message: "signaturePassword is required to record line clearance",
          });
        }
        const clearance = await cleaningStorage.createLineClearance(
          req.params.id,
          req.user!.id,
          {
            productChangeFromId: body.productChangeFromId ?? null,
            productChangeToId: body.productChangeToId,
            notes: body.notes,
            signaturePassword: body.signaturePassword,
            commentary: body.commentary,
          },
          req.requestId,
          `${req.method} ${req.path}`,
        );
        res.status(201).json(clearance);
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        if (e.status === 404) return res.status(404).json({ message: e.message ?? "Equipment not found" });
        if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
        if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
        if (e.status === 400) return res.status(400).json({ code: e.code, message: e.message });
        next(err);
      }
    },
  );

  app.get<{ id: string }>(
    "/api/equipment/:id/line-clearances",
    requireAuth,
    async (req, res, next) => {
      try {
        const list = await cleaningStorage.listLineClearances(req.params.id);
        res.json(list);
      } catch (err) {
        next(err);
      }
    },
  );

  // ─── OOS investigations (T-08 §111.113 / §111.123 / SOP-QC-006) ───────

  const oosListQuerySchema = z.object({
    status: z.enum(["OPEN", "RETEST_PENDING", "CLOSED", "ALL"]).optional(),
    lotId: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  });

  const oosCloseBodySchema = z.object({
    disposition: z.enum(["APPROVED", "REJECTED", "RECALL"]),
    dispositionReason: z.string().min(1),
    leadInvestigatorUserId: z.string().uuid(),
    recallDetails: z.object({
      class: z.enum(["I", "II", "III"]),
      distributionScope: z.string().min(1),
      fdaNotificationDate: z.string().optional(),
      customerNotificationDate: z.string().optional(),
      recoveryTargetDate: z.string().optional(),
      affectedLotIds: z.array(z.string()).optional(),
    }).optional(),
    signaturePassword: z.string().min(1),
  });

  const oosNoInvestigationBodySchema = z.object({
    reason: z.enum(["LAB_ERROR", "SAMPLE_INVALID", "INSTRUMENT_OUT_OF_CALIBRATION", "OTHER"]),
    reasonNarrative: z.string().min(1),
    leadInvestigatorUserId: z.string().uuid(),
    signaturePassword: z.string().min(1),
  });

  const oosAssignLeadBodySchema = z.object({
    leadInvestigatorUserId: z.string().uuid(),
  });

  app.get("/api/oos-investigations", requireAuth, async (req, res, next) => {
    try {
      const q = oosListQuerySchema.parse(req.query);
      const items = await storage.listOosInvestigations({
        status: q.status,
        lotId: q.lotId,
        dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
        dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
      });
      res.json(items);
    } catch (err) { next(err); }
  });

  app.get<{ id: string }>("/api/oos-investigations/:id", requireAuth, async (req, res, next) => {
    try {
      const detail = await storage.getOosInvestigationById(req.params.id);
      if (!detail) return res.status(404).json({ message: "OOS investigation not found" });
      res.json(detail);
    } catch (err) { next(err); }
  });

  app.post<{ id: string }>(
    "/api/oos-investigations/:id/assign-lead",
    requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["assignedByUserId"]),
    async (req, res, next) => {
      try {
        const { leadInvestigatorUserId } = oosAssignLeadBodySchema.parse(req.body);
        const updated = await db.transaction((tx) => storage.assignOosLeadInvestigator(req.params.id, leadInvestigatorUserId, req.user!.id, req.requestId, `${req.method} ${req.path}`, tx));
        res.json(updated);
      } catch (err) { next(err); }
    },
  );

  app.post<{ id: string }>(
    "/api/oos-investigations/:id/retest-pending",
    requireAuth, requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const updated = await db.transaction((tx) => storage.setOosRetestPending(req.params.id, req.user!.id, req.requestId, `${req.method} ${req.path}`, tx));
        res.json(updated);
      } catch (err) { next(err); }
    },
  );

  app.post<{ id: string }>(
    "/api/oos-investigations/:id/clear-retest",
    requireAuth, requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const updated = await db.transaction((tx) => storage.clearOosRetestPending(req.params.id, req.user!.id, req.requestId, `${req.method} ${req.path}`, tx));
        res.json(updated);
      } catch (err) { next(err); }
    },
  );

  app.post<{ id: string }>(
    "/api/oos-investigations/:id/close",
    requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["closedByUserId"]),
    async (req, res, next) => {
      try {
        const body = oosCloseBodySchema.parse(req.body);
        const recall = body.recallDetails;
        // Step 1: performSignature calls fn(tx) first, then inserts signature
        await performSignature(
          {
            userId: req.user!.id,
            password: body.signaturePassword,
            meaning: "OOS_INVESTIGATION_CLOSE",
            entityType: "oos_investigation",
            entityId: req.params.id,
            commentary: body.dispositionReason,
            recordSnapshot: { disposition: body.disposition, recallClass: recall?.class },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          async (tx) => {
            return storage.closeOosInvestigation(
              req.params.id,
              {
                disposition: body.disposition,
                dispositionReason: body.dispositionReason,
                leadInvestigatorUserId: body.leadInvestigatorUserId,
                recallDetails: recall ? {
                  class: recall.class,
                  distributionScope: recall.distributionScope,
                  fdaNotificationDate: recall.fdaNotificationDate ? new Date(recall.fdaNotificationDate) : undefined,
                  customerNotificationDate: recall.customerNotificationDate ? new Date(recall.customerNotificationDate) : undefined,
                  recoveryTargetDate: recall.recoveryTargetDate ? new Date(recall.recoveryTargetDate) : undefined,
                  affectedLotIds: recall.affectedLotIds,
                } : undefined,
              },
              req.user!.id, req.requestId, `${req.method} ${req.path}`, tx,
            );
          },
        );
        // Step 2: signature row now committed — finalize the closure
        const [sig] = await db
          .select({ id: schema.electronicSignatures.id })
          .from(schema.electronicSignatures)
          .where(and(
            eq(schema.electronicSignatures.entityType, "oos_investigation"),
            eq(schema.electronicSignatures.entityId, req.params.id),
            eq(schema.electronicSignatures.requestId, req.requestId),
          ))
          .orderBy(desc(schema.electronicSignatures.signedAt))
          .limit(1);
        if (!sig) return next(Object.assign(new Error("Signature row not found after performSignature — closure not finalized"), { status: 500 }));
        const updated = await storage.finalizeOosClosure(req.params.id, sig.id);
        res.json(updated);
      } catch (err) { next(err); }
    },
  );

  app.post<{ id: string }>(
    "/api/oos-investigations/:id/mark-no-investigation-needed",
    requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["closedByUserId"]),
    async (req, res, next) => {
      try {
        const body = oosNoInvestigationBodySchema.parse(req.body);
        await performSignature(
          {
            userId: req.user!.id,
            password: body.signaturePassword,
            meaning: "OOS_INVESTIGATION_CLOSE",
            entityType: "oos_investigation",
            entityId: req.params.id,
            commentary: body.reasonNarrative,
            recordSnapshot: { disposition: "NO_INVESTIGATION_NEEDED", reason: body.reason },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          async (tx) => {
            return storage.markOosNoInvestigationNeeded(
              req.params.id, body.reason, body.reasonNarrative,
              body.leadInvestigatorUserId, req.user!.id,
              req.requestId, `${req.method} ${req.path}`, tx,
            );
          },
        );
        const [sig] = await db
          .select({ id: schema.electronicSignatures.id })
          .from(schema.electronicSignatures)
          .where(and(
            eq(schema.electronicSignatures.entityType, "oos_investigation"),
            eq(schema.electronicSignatures.entityId, req.params.id),
            eq(schema.electronicSignatures.requestId, req.requestId),
          ))
          .orderBy(desc(schema.electronicSignatures.signedAt))
          .limit(1);
        if (!sig) return next(Object.assign(new Error("Signature row not found after performSignature — closure not finalized"), { status: 500 }));
        const updated = await storage.finalizeOosClosure(req.params.id, sig.id);
        res.json(updated);
      } catch (err) { next(err); }
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

  // ─── Label artwork (R-04) ──────────────────────────────

  app.post("/api/label-artwork", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as {
        productId?: string;
        version?: string;
        artworkFileName?: string;
        artworkFileData?: string;
        artworkMimeType?: string;
        variableDataSpec?: Record<string, boolean>;
      };
      if (!body.productId) return res.status(400).json({ message: "productId is required" });
      if (!body.version) return res.status(400).json({ message: "version is required" });
      if (!body.artworkFileName) return res.status(400).json({ message: "artworkFileName is required" });
      if (!body.artworkFileData) return res.status(400).json({ message: "artworkFileData is required" });
      if (!body.artworkMimeType) return res.status(400).json({ message: "artworkMimeType is required" });
      const row = await artworkStorage.createArtwork(
        {
          productId: body.productId,
          version: body.version,
          artworkFileName: body.artworkFileName,
          artworkFileData: body.artworkFileData,
          artworkMimeType: body.artworkMimeType,
          variableDataSpec: body.variableDataSpec ?? undefined,
          status: "DRAFT",
        },
        req.user!.id,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/label-artwork", requireAuth, async (req, res, next) => {
    try {
      const { productId } = req.query as { productId?: string };
      if (!productId) return res.status(400).json({ message: "productId query param is required" });
      const rows = await artworkStorage.listArtworkByProduct(productId);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/label-artwork/drafts — dashboard helper, returns all DRAFT artworks
  app.get("/api/label-artwork/drafts", requireAuth, async (_req, res, next) => {
    try {
      const rows = await artworkStorage.listDraftArtworks();
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.get<{ id: string }>("/api/label-artwork/:id", requireAuth, async (req, res, next) => {
    try {
      const row = await artworkStorage.getArtwork(req.params.id);
      if (!row) return res.status(404).json({ message: "Label artwork not found" });
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  app.post<{ id: string }>("/api/label-artwork/:id/approve", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as { password?: string };
      if (!body.password) return res.status(400).json({ message: "password is required" });
      const row = await artworkStorage.approveArtwork(
        req.params.id,
        req.user!.id,
        body.password,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      res.json(row);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 404) return res.status(404).json({ message: "Label artwork not found" });
      if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
      if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
      if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
      next(err);
    }
  });

  app.post<{ id: string }>("/api/label-artwork/:id/retire", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as { password?: string };
      if (!body.password) return res.status(400).json({ message: "password is required" });
      const row = await artworkStorage.retireArtwork(
        req.params.id,
        req.user!.id,
        body.password,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      res.json(row);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 404) return res.status(404).json({ message: "Label artwork not found" });
      if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
      if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
      if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
      next(err);
    }
  });

  // ─── SOPs (R-04) ───────────────────────────────────────

  // POST /api/sops — roles QA|ADMIN, creates DRAFT
  app.post("/api/sops", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as {
        code?: string;
        version?: string;
        title?: string;
      };
      if (!body.code) return res.status(400).json({ message: "code is required" });
      if (!body.version) return res.status(400).json({ message: "version is required" });
      if (!body.title) return res.status(400).json({ message: "title is required" });
      const row = await sopStorage.createSop(
        {
          code: body.code,
          version: body.version,
          title: body.title,
          status: "DRAFT",
        },
        req.user!.id,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/sops — any auth, list all
  app.get("/api/sops", requireAuth, async (_req, res, next) => {
    try {
      const rows = await sopStorage.listSops();
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/sops/:id — any auth, single
  app.get<{ id: string }>("/api/sops/:id", requireAuth, async (req, res, next) => {
    try {
      const row = await sopStorage.getSop(req.params.id);
      if (!row) return res.status(404).json({ message: "SOP not found" });
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/sops/:id/approve — roles QA|ADMIN, F-04
  app.post<{ id: string }>("/api/sops/:id/approve", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as { password?: string };
      if (!body.password) return res.status(400).json({ message: "password is required" });
      const row = await sopStorage.approveSop(
        req.params.id,
        req.user!.id,
        body.password,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      res.json(row);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 404) return res.status(404).json({ message: "SOP not found" });
      if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
      if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
      if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
      next(err);
    }
  });

  // POST /api/sops/:id/retire — roles QA|ADMIN, F-04
  app.post<{ id: string }>("/api/sops/:id/retire", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as { password?: string };
      if (!body.password) return res.status(400).json({ message: "password is required" });
      const row = await sopStorage.retireSop(
        req.params.id,
        req.user!.id,
        body.password,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      res.json(row);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 404) return res.status(404).json({ message: "SOP not found" });
      if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
      if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
      if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
      next(err);
    }
  });

  // ─── Label spools (R-04) ───────────────────────────────

  // POST /api/label-spools — F-04, roles QA|ADMIN
  app.post("/api/label-spools", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as {
        artworkId?: string;
        spoolNumber?: string;
        qtyInitial?: number;
        locationId?: string | null;
        password?: string;
      };
      if (!body.artworkId) return res.status(400).json({ message: "artworkId is required" });
      if (!body.spoolNumber) return res.status(400).json({ message: "spoolNumber is required" });
      if (body.qtyInitial === null || body.qtyInitial === undefined) return res.status(400).json({ message: "qtyInitial is required" });
      if (!body.password) return res.status(400).json({ message: "password is required" });
      const row = await spoolStorage.receiveSpool(
        {
          artworkId: body.artworkId,
          spoolNumber: body.spoolNumber,
          qtyInitial: body.qtyInitial,
          locationId: body.locationId ?? null,
        },
        req.user!.id,
        body.password,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      return res.status(201).json(row);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 404) return res.status(404).json({ message: "Label artwork not found" });
      if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
      if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
      if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
      next(err);
    }
  });

  // GET /api/label-spools?artworkId=... — any auth
  app.get("/api/label-spools", requireAuth, async (req, res, next) => {
    try {
      const { artworkId } = req.query as { artworkId?: string };
      if (!artworkId) return res.status(400).json({ message: "artworkId query param is required" });
      const rows = await spoolStorage.listActiveSpools(artworkId);
      return res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/label-spools/:id/dispose — roles QA|ADMIN, no password
  app.post<{ id: string }>("/api/label-spools/:id/dispose", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as { reason?: string };
      if (!body.reason) return res.status(400).json({ message: "reason is required" });
      const row = await spoolStorage.disposeSpool(
        req.params.id,
        body.reason,
        req.user!.id,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      return res.json(row);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 404) return res.status(404).json({ message: "Label spool not found" });
      if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
      next(err);
    }
  });

  // ─── Label issuance (R-04) ─────────────────────────────

  // POST /api/bpr/:id/label-issuance — roles PRODUCTION|QA|ADMIN, no password
  app.post<{ id: string }>("/api/bpr/:id/label-issuance", requireAuth, requireRole("PRODUCTION", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as { spoolId?: string; qty?: number };
      if (!body.spoolId) return res.status(400).json({ message: "spoolId is required" });
      if (body.qty === null || body.qty === undefined) return res.status(400).json({ message: "qty is required" });
      const row = await issuanceStorage.issueLabels(
        req.params.id,
        body.spoolId,
        body.qty,
        req.user!.id,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      return res.status(201).json(row);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 404) return res.status(404).json({ message: e.message ?? "Not found" });
      if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
      next(err);
    }
  });

  // GET /api/bpr/:id/label-issuance — any auth
  app.get<{ id: string }>("/api/bpr/:id/label-issuance", requireAuth, async (req, res, next) => {
    try {
      const rows = await issuanceStorage.listIssuanceForBpr(req.params.id);
      return res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // ─── Label print jobs (R-04) ───────────────────────────

  // POST /api/label-issuance/:id/print — F-04, roles QA|ADMIN
  app.post<{ id: string }>("/api/label-issuance/:id/print", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as {
        password?: string;
        qty?: number;
        lot?: string;
        expiry?: string;
        artworkId?: string;
      };
      if (!body.password) return res.status(400).json({ message: "password is required" });
      if (body.qty === null || body.qty === undefined) return res.status(400).json({ message: "qty is required" });
      if (!body.lot) return res.status(400).json({ message: "lot is required" });
      if (!body.expiry) return res.status(400).json({ message: "expiry is required" });
      if (!body.artworkId) return res.status(400).json({ message: "artworkId is required" });

      const adapter = await getLabelPrintAdapter();
      const artwork = await artworkStorage.getArtwork(body.artworkId);
      if (!artwork) return res.status(404).json({ message: "Label artwork not found" });

      const adapterResult = await adapter.print({
        artwork,
        lot: body.lot,
        expiry: new Date(body.expiry),
        qty: body.qty,
      });

      const row = await issuanceStorage.recordPrintJob(
        {
          issuanceLogId: req.params.id,
          lot: body.lot,
          expiry: new Date(body.expiry),
          qtyPrinted: adapterResult.qtyPrinted,
          adapter: adapter.name,
          adapterResult,
        },
        req.user!.id,
        body.password,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      return res.status(201).json(row);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 404) return res.status(404).json({ message: e.message ?? "Not found" });
      if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
      if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
      if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
      next(err);
    }
  });

  // ─── Label reconciliation (R-04) ──────────────────────────

  // POST /api/bpr/:id/label-reconciliation — F-04, roles QA|ADMIN
  app.post<{ id: string }>("/api/bpr/:id/label-reconciliation", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const body = req.body as {
        password?: string;
        qtyApplied?: number;
        qtyReturned?: number;
        qtyDestroyed?: number;
        deviationId?: string | null;
        proofFileData?: string | null;
        proofMimeType?: string | null;
      };
      if (!body.password) return res.status(400).json({ message: "password is required" });
      if (body.qtyApplied === null || body.qtyApplied === undefined) return res.status(400).json({ message: "qtyApplied is required" });
      if (body.qtyReturned === null || body.qtyReturned === undefined) return res.status(400).json({ message: "qtyReturned is required" });
      if (body.qtyDestroyed === null || body.qtyDestroyed === undefined) return res.status(400).json({ message: "qtyDestroyed is required" });

      const row = await reconciliationStorage.reconcileBpr(
        {
          bprId: req.params.id,
          qtyApplied: body.qtyApplied,
          qtyReturned: body.qtyReturned,
          qtyDestroyed: body.qtyDestroyed,
          deviationId: body.deviationId ?? null,
          proofFileData: body.proofFileData ?? null,
          proofMimeType: body.proofMimeType ?? null,
        },
        req.user!.id,
        body.password,
        req.requestId,
        `${req.method} ${req.path}`,
      );
      return res.status(201).json(row);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 404) return res.status(404).json({ message: e.message ?? "Not found" });
      if (e.status === 409) return res.status(409).json({ code: e.code, message: e.message });
      if (e.status === 401) return res.status(401).json({ error: { code: e.code, message: e.message } });
      if (e.status === 423) return res.status(423).json({ error: { code: e.code, message: e.message } });
      next(err);
    }
  });

  // GET /api/bpr/:id/label-reconciliation — any auth
  app.get<{ id: string }>("/api/bpr/:id/label-reconciliation", requireAuth, async (req, res, next) => {
    try {
      const row = await reconciliationStorage.getReconciliationForBpr(req.params.id);
      if (!row) return res.status(404).json({ message: "No reconciliation found for this BPR" });
      return res.json(row);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/label-reconciliations/out-of-tolerance — dashboard helper
  app.get("/api/label-reconciliations/out-of-tolerance", requireAuth, async (_req, res, next) => {
    try {
      const rows = await reconciliationStorage.listOutOfToleranceReconciliations();
      return res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // ─── R-05 Complaints & SAER ────────────────────────────────────────────────

  // GET /api/complaints — list, optional ?status=&aeOnly=true
  app.get("/api/complaints", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const status = req.query.status as string | undefined;
      const aeOnly = req.query.aeOnly === "true";
      const rows = await complaintsStorage.listComplaints({
        status: status as import("@shared/schema").ComplaintStatus | undefined,
        aeOnly,
      });
      return res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/complaints/summary — dashboard counts
  app.get("/api/complaints/summary", requireAuth, async (_req, res, next) => {
    try {
      const summary = await complaintsStorage.getComplaintsSummary();
      return res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/complaints/trends — monthly grouped stats
  app.get("/api/complaints/trends", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { db: dbConn } = await import("./db");
      const { sql: sqlFn } = await import("drizzle-orm");
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      // Group by month × defect_category
      let whereClause = sqlFn`1=1`;
      if (from) whereClause = sqlFn`${whereClause} AND intake_at >= ${from}::timestamptz`;
      if (to) whereClause = sqlFn`${whereClause} AND intake_at < ${to}::timestamptz`;

      const rows = await dbConn.execute(sqlFn`
        SELECT
          date_trunc('month', intake_at) AS month,
          defect_category,
          count(*)::int AS count,
          count(*) FILTER (WHERE ae_flag = true)::int AS ae_count
        FROM erp_complaints
        WHERE ${whereClause}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `);
      return res.json(rows.rows);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/complaints/:id
  app.get<{ id: string }>("/api/complaints/:id", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const complaint = await complaintsStorage.getComplaint(req.params.id);
      const triage = await complaintsStorage.getComplaintTriage(req.params.id);
      const investigation = await complaintsStorage.getComplaintInvestigation(req.params.id);
      const labRetests = await complaintsStorage.getComplaintLabRetests(req.params.id);
      const adverseEvent = await complaintsStorage.getAdverseEvent(req.params.id);
      const saer = adverseEvent ? await complaintsStorage.getSaerSubmission(adverseEvent.id) : null;
      return res.json({ complaint, triage, investigation, labRetests, adverseEvent, saer });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/complaints/intake — dual auth: HMAC or session QA/ADMIN
  app.post("/api/complaints/intake", requireHmacOrAuth, async (req, res, next) => {
    try {
      const bodySchema = z.object({
        helpcoreRef: z.string().min(1),
        customerName: z.string().min(1),
        customerEmail: z.string().email(),
        customerPhone: z.string().optional(),
        lotCode: z.string().min(1),
        complaintText: z.string().min(1),
        severity: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: formatZodError(parsed.error) });

      const isHmac = (req as typeof req & { helpcoreHmacAuth?: boolean }).helpcoreHmacAuth === true;
      const source: import("@shared/schema").ComplaintSource = isHmac ? "HELPCORE" : "MANUAL";
      const createdByUserId = isHmac ? HELPCORE_SYSTEM_USER_ID : req.user!.id;

      const { complaint, status } = await complaintsStorage.intakeComplaint({
        ...parsed.data,
        source,
        createdByUserId,
        requestId: req.requestId,
        route: req.path,
      });
      return res.status(201).json({ complaintId: complaint.id, status });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "DUPLICATE_HELPCORE_REF") {
        return res.status(409).json({ code: "DUPLICATE_HELPCORE_REF" });
      }
      next(err);
    }
  });

  // PATCH /api/complaints/:id/lot-link
  app.patch<{ id: string }>("/api/complaints/:id/lot-link", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { lotId } = z.object({ lotId: z.string().uuid() }).parse(req.body);
      const complaint = await complaintsStorage.linkComplaintLot({
        complaintId: req.params.id, lotId, userId: req.user!.id,
        requestId: req.requestId, route: req.path,
      });
      return res.json(complaint);
    } catch (err) { next(err); }
  });

  // POST /api/complaints/:id/triage
  app.post<{ id: string }>("/api/complaints/:id/triage", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const bodySchema = z.object({
        severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
        defectCategory: z.enum(["FOREIGN_MATTER", "LABEL", "POTENCY", "TASTE_SMELL", "PACKAGE", "CUSTOMER_USE_ERROR", "OTHER"]),
        aeFlag: z.boolean(),
        batchLinkConfirmed: z.boolean(),
        notes: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: formatZodError(parsed.error) });
      const complaint = await complaintsStorage.triageComplaint({
        complaintId: req.params.id, userId: req.user!.id, ...parsed.data,
        requestId: req.requestId, route: req.path,
      });
      return res.json(complaint);
    } catch (err) { next(err); }
  });

  // POST /api/complaints/:id/investigation
  app.post<{ id: string }>("/api/complaints/:id/investigation", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const bodySchema = z.object({
        rootCause: z.string().min(1),
        scope: z.string().min(1),
        bprId: z.string().uuid().optional(),
        coaId: z.string().uuid().optional(),
        retestRequired: z.boolean(),
        summaryForReview: z.string().min(1),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: formatZodError(parsed.error) });
      const inv = await complaintsStorage.submitInvestigation({
        complaintId: req.params.id, userId: req.user!.id, ...parsed.data,
        requestId: req.requestId, route: req.path,
      });
      return res.status(201).json(inv);
    } catch (err) { next(err); }
  });

  // POST /api/complaints/:id/investigation/package
  app.post<{ id: string }>("/api/complaints/:id/investigation/package", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { investigationId } = z.object({ investigationId: z.string().uuid() }).parse(req.body);
      const inv = await complaintsStorage.packageInvestigation({
        complaintId: req.params.id, investigationId, userId: req.user!.id,
        requestId: req.requestId, route: req.path,
      });
      return res.json(inv);
    } catch (err) { next(err); }
  });

  // POST /api/complaints/:id/lab-retest
  app.post<{ id: string }>("/api/complaints/:id/lab-retest", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const bodySchema = z.object({
        investigationId: z.string().uuid(),
        lotId: z.string().uuid(),
        method: z.string().min(1),
        assignedLabUserId: z.string().uuid(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: formatZodError(parsed.error) });
      const retest = await complaintsStorage.requestLabRetest({
        complaintId: req.params.id, userId: req.user!.id, ...parsed.data,
        requestId: req.requestId, route: req.path,
      });
      return res.status(201).json(retest);
    } catch (err) { next(err); }
  });

  // PATCH /api/complaints/:id/lab-retest/:retestId/complete
  app.patch<{ id: string; retestId: string }>("/api/complaints/:id/lab-retest/:retestId/complete", requireAuth, requireRole("LAB_TECH", "ADMIN"), async (req, res, next) => {
    try {
      const { labTestResultId } = z.object({ labTestResultId: z.string().uuid().optional() }).parse(req.body);
      const retest = await complaintsStorage.completeLabRetest({
        retestId: req.params.retestId, complaintId: req.params.id,
        userId: req.user!.id, labTestResultId,
        requestId: req.requestId, route: req.path,
      });
      return res.json(retest);
    } catch (err) { next(err); }
  });

  // POST /api/complaints/:id/urgent-review
  app.post<{ id: string }>("/api/complaints/:id/urgent-review", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const bodySchema = z.object({
        serious: z.boolean(),
        seriousCriteria: z.record(z.boolean()),
        medwatchRequired: z.boolean(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: formatZodError(parsed.error) });
      const result = await complaintsStorage.submitUrgentReview({
        complaintId: req.params.id, userId: req.user!.id, ...parsed.data,
        requestId: req.requestId, route: req.path,
      });
      return res.json(result);
    } catch (err) { next(err); }
  });

  // POST /api/complaints/:id/disposition — F-04 ceremony (COMPLAINT_REVIEW)
  app.post<{ id: string }>("/api/complaints/:id/disposition", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const bodySchema = z.object({
        password: z.string().min(1),
        dispositionSummary: z.string().min(1),
        capaRequired: z.boolean(),
        capaRef: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: formatZodError(parsed.error) });
      const complaint = await complaintsStorage.signDisposition({
        complaintId: req.params.id, userId: req.user!.id, ...parsed.data,
        requestId: req.requestId, route: req.path,
      });
      return res.json(complaint);
    } catch (err) { next(err); }
  });

  // ─── SAER / Adverse events ─────────────────────────────────────────────────

  // GET /api/complaints/:id/ae
  app.get<{ id: string }>("/api/complaints/:id/ae", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const ae = await complaintsStorage.getAdverseEvent(req.params.id);
      if (!ae) return res.status(404).json({ message: "No adverse event for this complaint" });
      const saer = await complaintsStorage.getSaerSubmission(ae.id);
      return res.json({ adverseEvent: ae, saer });
    } catch (err) { next(err); }
  });

  // GET /api/complaints/:id/ae/print — printable MedWatch 3500A HTML (post-submission only)
  app.get<{ id: string }>("/api/complaints/:id/ae/print", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const complaint = await complaintsStorage.getComplaint(req.params.id);
      const ae = await complaintsStorage.getAdverseEvent(req.params.id);
      if (!ae) return res.status(404).json({ message: "No adverse event for this complaint" });
      const saer = await complaintsStorage.getSaerSubmission(ae.id);
      if (!saer?.submittedAt) return res.status(409).json({ message: "SAER has not been submitted yet" });

      const d = saer.draftJson as Record<string, string | undefined>;
      const submittedAt = new Date(saer.submittedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
      const dueAt = new Date(ae.dueAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" });

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>MedWatch 3500A — ${complaint.helpcoreRef}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11pt; margin: 1in; color: #000; }
    h1 { font-size: 14pt; text-align: center; margin-bottom: 4px; }
    .subtitle { text-align: center; font-size: 10pt; color: #555; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    td, th { border: 1px solid #888; padding: 4px 8px; vertical-align: top; }
    th { background: #f0f0f0; text-align: left; width: 30%; font-weight: bold; }
    .section-header { background: #333; color: #fff; font-weight: bold; padding: 4px 8px; }
    .footer { margin-top: 32px; font-size: 9pt; color: #555; border-top: 1px solid #ccc; padding-top: 8px; }
    @media print { body { margin: 0.5in; } }
  </style>
</head>
<body>
  <h1>FDA MedWatch 3500A — Mandatory Reporting Form</h1>
  <p class="subtitle">Complaint Ref: ${complaint.helpcoreRef} &nbsp;|&nbsp; Submitted: ${submittedAt} &nbsp;|&nbsp; 15-BD Deadline: ${dueAt}</p>

  <table>
    <tr><td colspan="2" class="section-header">A. Patient Information</td></tr>
    <tr><th>Patient Name</th><td>${d.patientName ?? ""}</td></tr>
    <tr><th>Phone</th><td>${d.patientPhone ?? ""}</td></tr>
  </table>

  <table>
    <tr><td colspan="2" class="section-header">B. Adverse Event / Product Problem</td></tr>
    <tr><th>Event Narrative</th><td style="white-space:pre-wrap">${d.eventNarrative ?? ""}</td></tr>
    <tr><th>Serious Criteria</th><td>${Object.entries((ae.seriousCriteria ?? {}) as Record<string, boolean>).filter(([,v]) => v).map(([k]) => k.replace(/_/g, " ")).join(", ") || "None"}</td></tr>
  </table>

  <table>
    <tr><td colspan="2" class="section-header">C. Suspect Product</td></tr>
    <tr><th>Product Name</th><td>${d.suspectProductName ?? ""}</td></tr>
    <tr><th>Lot Number</th><td>${d.suspectLotNumber ?? complaint.lotCodeRaw}</td></tr>
  </table>

  <table>
    <tr><td colspan="2" class="section-header">D. Facility / Reporter</td></tr>
    <tr><th>Facility Name</th><td>${d.facilityName ?? ""}</td></tr>
    <tr><th>Address</th><td>${d.facilityAddress ?? ""}</td></tr>
    <tr><th>Phone</th><td>${d.facilityPhone ?? ""}</td></tr>
  </table>

  <table>
    <tr><td colspan="2" class="section-header">E. Relevant History</td></tr>
    <tr><th>History / Concomitant</th><td style="white-space:pre-wrap">${d.historySection ?? ""}</td></tr>
  </table>

  ${saer.acknowledgmentRef ? `<table>
    <tr><td colspan="2" class="section-header">F. FDA Portal Acknowledgment</td></tr>
    <tr><th>Acknowledgment Ref</th><td>${saer.acknowledgmentRef}</td></tr>
  </table>` : ""}

  <div class="footer">
    Generated by Neurogan ERP &nbsp;|&nbsp; SAER ID: ${saer.id} &nbsp;|&nbsp; AE ID: ${ae.id} &nbsp;|&nbsp; Complaint: ${complaint.id}
    <br/>This document is a regulated record under 21 CFR Part 11. Do not alter after printing.
  </div>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.send(html);
    } catch (err) { next(err); }
  });

  // POST /api/complaints/:id/ae/draft — save MedWatch draft (upsert, no signature)
  app.post<{ id: string }>("/api/complaints/:id/ae/draft", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const ae = await complaintsStorage.getAdverseEvent(req.params.id);
      if (!ae) return res.status(404).json({ message: "No adverse event for this complaint" });
      const { draftJson } = z.object({ draftJson: z.record(z.unknown()) }).parse(req.body);
      const saer = await complaintsStorage.saveSaerDraft({
        complaintId: req.params.id, adverseEventId: ae.id,
        draftJson: draftJson as Record<string, unknown>,
        userId: req.user!.id, requestId: req.requestId, route: req.path,
      });
      return res.json(saer);
    } catch (err) { next(err); }
  });

  // POST /api/complaints/:id/ae/submit — F-04 ceremony (SAER_SUBMIT)
  app.post<{ id: string }>("/api/complaints/:id/ae/submit", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const ae = await complaintsStorage.getAdverseEvent(req.params.id);
      if (!ae) return res.status(404).json({ message: "No adverse event for this complaint" });
      const bodySchema = z.object({
        password: z.string().min(1),
        draftJson: z.record(z.unknown()),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: formatZodError(parsed.error) });
      const saer = await complaintsStorage.submitSaer({
        complaintId: req.params.id, adverseEventId: ae.id,
        userId: req.user!.id, password: parsed.data.password,
        draftJson: parsed.data.draftJson as Record<string, unknown>,
        requestId: req.requestId, route: req.path,
      });
      return res.json(saer);
    } catch (err) { next(err); }
  });

  // POST /api/complaints/:id/ae/acknowledge — capture FDA portal acknowledgment ref
  app.post<{ id: string }>("/api/complaints/:id/ae/acknowledge", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const ae = await complaintsStorage.getAdverseEvent(req.params.id);
      if (!ae) return res.status(404).json({ message: "No adverse event for this complaint" });
      const saer = await complaintsStorage.getSaerSubmission(ae.id);
      if (!saer) return res.status(404).json({ message: "No SAER submission found" });
      const { acknowledgmentRef, submissionProofPath } = z.object({
        acknowledgmentRef: z.string().min(1),
        submissionProofPath: z.string().optional(),
      }).parse(req.body);
      const updated = await complaintsStorage.acknowledgesSaer({
        saerSubmissionId: saer.id, acknowledgmentRef, submissionProofPath,
        userId: req.user!.id, requestId: req.requestId, route: req.path,
      });
      return res.json(updated);
    } catch (err) { next(err); }
  });

  // ─── R-06 Returned Products ────────────────────────────────────────────────

  // GET /api/returned-products/summary — dashboard counts (MUST come before :id route)
  app.get("/api/returned-products/summary", requireAuth, async (_req, res, next) => {
    try {
      const summary = await returnsStorage.getReturnsSummary();
      return res.json(summary);
    } catch (err) { next(err); }
  });

  // POST /api/returned-products — create intake
  app.post("/api/returned-products", requireAuth, requireRole("WAREHOUSE", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const { source, lotCodeRaw, lotId, qtyReturned, uom, wholesaleCustomerName, carrierTrackingRef, conditionNotes, receivedAt } =
        z.object({
          source: z.enum(["AMAZON_FBA", "WHOLESALE", "OTHER"]),
          lotCodeRaw: z.string().min(1),
          lotId: z.string().uuid().optional(),
          qtyReturned: z.number().int().positive(),
          uom: z.string().min(1),
          wholesaleCustomerName: z.string().optional(),
          carrierTrackingRef: z.string().optional(),
          conditionNotes: z.string().optional(),
          receivedAt: z.string().datetime(),
        }).parse(req.body);
      const result = await returnsStorage.createReturnIntake({
        source, lotCodeRaw, lotId, qtyReturned, uom,
        wholesaleCustomerName, carrierTrackingRef, conditionNotes,
        receivedAt: new Date(receivedAt),
        userId: req.user!.id,
        requestId: req.requestId,
        route: req.path,
      });
      return res.status(201).json(result);
    } catch (err) { next(err); }
  });

  // GET /api/returned-products — list
  app.get("/api/returned-products", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { status, lotId } = z.object({
        status: z.enum(["QUARANTINE", "DISPOSED"]).optional(),
        lotId: z.string().optional(),
      }).parse(req.query);
      return res.json(await returnsStorage.listReturnedProducts({ status, lotId }));
    } catch (err) { next(err); }
  });

  // GET /api/returned-products/:id — detail
  app.get<{ id: string }>("/api/returned-products/:id", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      return res.json(await returnsStorage.getReturnedProduct(req.params.id));
    } catch (err) { next(err); }
  });

  // POST /api/returned-products/:id/disposition — F-04
  app.post<{ id: string }>("/api/returned-products/:id/disposition", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { disposition, dispositionNotes, password } = z.object({
        disposition: z.enum(["RETURN_TO_INVENTORY", "DESTROY"]),
        dispositionNotes: z.string().optional(),
        password: z.string().min(1),
      }).parse(req.body);
      const updated = await returnsStorage.signDisposition({
        returnedProductId: req.params.id, disposition, dispositionNotes,
        userId: req.user!.id, password,
        requestId: req.requestId, route: req.path,
      });
      return res.json(updated);
    } catch (err) { next(err); }
  });

  // GET /api/return-investigations — list
  app.get("/api/return-investigations", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { status, lotId } = z.object({
        status: z.enum(["OPEN", "CLOSED"]).optional(),
        lotId: z.string().optional(),
      }).parse(req.query);
      return res.json(await returnsStorage.listReturnInvestigations({ status, lotId }));
    } catch (err) { next(err); }
  });

  // GET /api/return-investigations/:id — detail
  app.get<{ id: string }>("/api/return-investigations/:id", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      return res.json(await returnsStorage.getReturnInvestigation(req.params.id));
    } catch (err) { next(err); }
  });

  // POST /api/return-investigations/:id/close — F-04
  app.post<{ id: string }>("/api/return-investigations/:id/close", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { rootCause, correctiveAction, password } = z.object({
        rootCause: z.string().min(1),
        correctiveAction: z.string().min(1),
        password: z.string().min(1),
      }).parse(req.body);
      const updated = await returnsStorage.closeReturnInvestigation({
        investigationId: req.params.id, rootCause, correctiveAction,
        userId: req.user!.id, password,
        requestId: req.requestId, route: req.path,
      });
      return res.json(updated);
    } catch (err) { next(err); }
  });

  return httpServer;
}
