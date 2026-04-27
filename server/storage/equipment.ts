import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

export async function createEquipment(
  data: {
    assetTag: string;
    name: string;
    model?: string;
    serial?: string;
    manufacturer?: string;
    locationId?: string;
  },
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.Equipment> {
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.equipment)
      .where(eq(schema.equipment.assetTag, data.assetTag));
    if (existing.length > 0) {
      throw Object.assign(
        new Error("Equipment with this asset tag already exists"),
        { status: 409, code: "DUPLICATE_ASSET_TAG" },
      );
    }
    const [created] = await tx.insert(schema.equipment).values(data).returning();
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "EQUIPMENT_CREATED",
      entityType: "equipment",
      entityId: created!.id,
      after: { assetTag: created!.assetTag, name: created!.name },
      requestId,
      route,
    });
    return created!;
  });
}

export async function listEquipment(): Promise<schema.Equipment[]> {
  return db.select().from(schema.equipment).orderBy(schema.equipment.assetTag);
}

export async function getEquipment(id: string): Promise<schema.Equipment | undefined> {
  const [row] = await db
    .select()
    .from(schema.equipment)
    .where(eq(schema.equipment.id, id));
  return row;
}

export async function retireEquipment(
  id: string,
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.Equipment> {
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.equipment)
      .where(eq(schema.equipment.id, id));
    if (!existing) {
      throw Object.assign(new Error("Equipment not found"), { status: 404 });
    }
    const [updated] = await tx
      .update(schema.equipment)
      .set({ status: "RETIRED" })
      .where(eq(schema.equipment.id, id))
      .returning();
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "EQUIPMENT_RETIRED",
      entityType: "equipment",
      entityId: id,
      before: { status: existing.status },
      after: { status: "RETIRED" },
      requestId,
      route,
    });
    return updated!;
  });
}
