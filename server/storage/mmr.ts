import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

// ─── R-07 Master Manufacturing Records ───────────────────────────────────────

export async function listMmrs(): Promise<schema.MmrWithSteps[]> {
  const rows = await db
    .select({
      mmr: schema.mmrs,
      productName: schema.products.name,
      recipeName: schema.recipes.name,
      createdByName: schema.users.fullName,
    })
    .from(schema.mmrs)
    .innerJoin(schema.products, eq(schema.mmrs.productId, schema.products.id))
    .innerJoin(schema.recipes, eq(schema.mmrs.recipeId, schema.recipes.id))
    .innerJoin(schema.users, eq(schema.mmrs.createdByUserId, schema.users.id))
    .orderBy(schema.products.name, desc(schema.mmrs.version));

  if (rows.length === 0) return [];

  const allSteps = await db
    .select()
    .from(schema.mmrSteps)
    .orderBy(schema.mmrSteps.mmrId, schema.mmrSteps.stepNumber);

  // group steps by mmrId
  const stepsByMmr = new Map<string, schema.MmrStep[]>();
  for (const step of allSteps) {
    const arr = stepsByMmr.get(step.mmrId) ?? [];
    arr.push(step);
    stepsByMmr.set(step.mmrId, arr);
  }

  return rows.map(({ mmr, productName, recipeName, createdByName }) => ({
    ...mmr,
    steps: stepsByMmr.get(mmr.id) ?? [],
    productName,
    recipeName,
    createdByName,
    approvedByName: null, // resolved in getMmr when needed
  }));
}

export async function getMmr(id: string): Promise<schema.MmrWithSteps | undefined> {
  const [row] = await db
    .select({
      mmr: schema.mmrs,
      productName: schema.products.name,
      recipeName: schema.recipes.name,
      createdByName: schema.users.fullName,
    })
    .from(schema.mmrs)
    .innerJoin(schema.products, eq(schema.mmrs.productId, schema.products.id))
    .innerJoin(schema.recipes, eq(schema.mmrs.recipeId, schema.recipes.id))
    .innerJoin(schema.users, eq(schema.mmrs.createdByUserId, schema.users.id))
    .where(eq(schema.mmrs.id, id));

  if (!row) return undefined;

  const steps = await db
    .select()
    .from(schema.mmrSteps)
    .where(eq(schema.mmrSteps.mmrId, id))
    .orderBy(schema.mmrSteps.stepNumber);

  let approvedByName: string | null = null;
  if (row.mmr.approvedByUserId) {
    const [approver] = await db
      .select({ fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.id, row.mmr.approvedByUserId));
    approvedByName = approver?.fullName ?? null;
  }

  return {
    ...row.mmr,
    steps,
    productName: row.productName,
    recipeName: row.recipeName,
    createdByName: row.createdByName,
    approvedByName,
  };
}

export async function getMmrByProduct(
  productId: string,
  status?: schema.MmrStatus,
): Promise<schema.MmrWithSteps | undefined> {
  const condition = status
    ? and(eq(schema.mmrs.productId, productId), eq(schema.mmrs.status, status))
    : eq(schema.mmrs.productId, productId);

  const rows = await db
    .select()
    .from(schema.mmrs)
    .where(condition)
    .orderBy(desc(schema.mmrs.version))
    .limit(1);

  if (rows.length === 0) return undefined;
  return getMmr(rows[0]!.id);
}

export async function createMmr(data: {
  productId: string;
  recipeId: string;
  notes?: string;
  createdByUserId: string;
}): Promise<schema.MmrWithSteps> {
  const [row] = await db
    .insert(schema.mmrs)
    .values({
      productId: data.productId,
      recipeId: data.recipeId,
      notes: data.notes ?? null,
      createdByUserId: data.createdByUserId,
      version: 1,
      status: "DRAFT",
    })
    .returning();
  return getMmr(row!.id) as Promise<schema.MmrWithSteps>;
}

export async function updateMmr(
  id: string,
  data: {
    yieldMinThreshold?: string | null;
    yieldMaxThreshold?: string | null;
    notes?: string | null;
  },
): Promise<schema.MmrWithSteps> {
  await db
    .update(schema.mmrs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schema.mmrs.id, id));
  return getMmr(id) as Promise<schema.MmrWithSteps>;
}

export async function addMmrStep(
  mmrId: string,
  data: {
    stepNumber: number;
    description: string;
    equipmentIds?: string[];
    criticalParams?: string | null;
    sopReference?: string | null;
  },
): Promise<schema.MmrStep> {
  const [row] = await db
    .insert(schema.mmrSteps)
    .values({
      mmrId,
      stepNumber: data.stepNumber,
      description: data.description,
      equipmentIds: (data.equipmentIds ?? []) as string[],
      criticalParams: data.criticalParams ?? null,
      sopReference: data.sopReference ?? null,
    })
    .returning();
  return row!;
}

export async function updateMmrStep(
  stepId: string,
  data: Partial<{
    stepNumber: number;
    description: string;
    equipmentIds: string[];
    criticalParams: string | null;
    sopReference: string | null;
  }>,
): Promise<schema.MmrStep> {
  const [row] = await db
    .update(schema.mmrSteps)
    .set(data as Partial<schema.MmrStep>)
    .where(eq(schema.mmrSteps.id, stepId))
    .returning();
  return row!;
}

export async function deleteMmrStep(stepId: string): Promise<void> {
  await db.delete(schema.mmrSteps).where(eq(schema.mmrSteps.id, stepId));
}

export async function reorderMmrSteps(mmrId: string, orderedStepIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedStepIds.length; i++) {
      await tx
        .update(schema.mmrSteps)
        .set({ stepNumber: i + 1 })
        .where(and(eq(schema.mmrSteps.id, orderedStepIds[i]!), eq(schema.mmrSteps.mmrId, mmrId)));
    }
  });
}

export async function approveMmr(
  id: string,
  data: { approvedByUserId: string; signatureId: string },
): Promise<schema.MmrWithSteps> {
  await db
    .update(schema.mmrs)
    .set({
      status: "APPROVED",
      approvedByUserId: data.approvedByUserId,
      signatureId: data.signatureId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.mmrs.id, id));
  return getMmr(id) as Promise<schema.MmrWithSteps>;
}

export async function reviseMmr(id: string, createdByUserId: string): Promise<schema.MmrWithSteps> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(schema.mmrs).where(eq(schema.mmrs.id, id));
    if (!current) throw Object.assign(new Error("MMR not found"), { status: 404 });

    // Mark current as SUPERSEDED
    await tx
      .update(schema.mmrs)
      .set({ status: "SUPERSEDED", updatedAt: new Date() })
      .where(eq(schema.mmrs.id, id));

    // Create new DRAFT at version + 1
    const [newMmr] = await tx
      .insert(schema.mmrs)
      .values({
        productId: current.productId,
        recipeId: current.recipeId,
        version: current.version + 1,
        status: "DRAFT",
        notes: current.notes,
        createdByUserId,
        yieldMinThreshold: current.yieldMinThreshold,
        yieldMaxThreshold: current.yieldMaxThreshold,
      })
      .returning();

    // Copy steps from current MMR
    const oldSteps = await tx
      .select()
      .from(schema.mmrSteps)
      .where(eq(schema.mmrSteps.mmrId, id))
      .orderBy(schema.mmrSteps.stepNumber);

    if (oldSteps.length > 0) {
      await tx.insert(schema.mmrSteps).values(
        oldSteps.map((s) => ({
          mmrId: newMmr!.id,
          stepNumber: s.stepNumber,
          description: s.description,
          equipmentIds: s.equipmentIds,
          criticalParams: s.criticalParams,
          sopReference: s.sopReference,
        })),
      );
    }

    // Return the new MMR with full details (can't use getMmr in transaction, build it directly)
    const steps = await tx
      .select()
      .from(schema.mmrSteps)
      .where(eq(schema.mmrSteps.mmrId, newMmr!.id))
      .orderBy(schema.mmrSteps.stepNumber);

    const [product] = await tx
      .select({ name: schema.products.name })
      .from(schema.products)
      .where(eq(schema.products.id, newMmr!.productId));
    const [recipe] = await tx
      .select({ name: schema.recipes.name })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, newMmr!.recipeId));
    const [creator] = await tx
      .select({ fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.id, newMmr!.createdByUserId));

    return {
      ...newMmr!,
      steps,
      productName: product?.name ?? "",
      recipeName: recipe?.name ?? "",
      createdByName: creator?.fullName ?? "",
      approvedByName: null,
    };
  });
}
