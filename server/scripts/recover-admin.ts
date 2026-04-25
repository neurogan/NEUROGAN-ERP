/**
 * Emergency admin recovery script.
 * Safe to run multiple times — upserts the user and ensures ADMIN role.
 * Run against staging: ! railway run npx tsx server/scripts/recover-admin.ts
 */
import { db } from "../db.ts";
import * as schema from "../../shared/schema.ts";
import { hashPassword } from "../auth/password.ts";
import { eq } from "drizzle-orm";

const EMAIL = "fhv@neurogan.com";
const TEMP_PASSWORD = "ChangeMe1!Now#";

const hash = await hashPassword(TEMP_PASSWORD);

const [existing] = await db
  .select({ id: schema.users.id })
  .from(schema.users)
  .where(eq(schema.users.email, EMAIL));

let userId: string;

if (existing) {
  await db
    .update(schema.users)
    .set({ passwordHash: hash, status: "ACTIVE" })
    .where(eq(schema.users.email, EMAIL));
  userId = existing.id;
  console.log("Updated existing user:", userId);
} else {
  const [created] = await db
    .insert(schema.users)
    .values({
      email: EMAIL,
      fullName: "Frederik Hejlskov",
      passwordHash: hash,
      status: "ACTIVE",
      createdByUserId: null as unknown as string,
    })
    .returning();
  userId = created!.id;
  console.log("Created new user:", userId);
}

// Ensure ADMIN role exists
const [existingRole] = await db
  .select()
  .from(schema.userRoles)
  .where(eq(schema.userRoles.userId, userId));

if (!existingRole) {
  await db.insert(schema.userRoles).values({
    userId,
    role: "ADMIN",
    grantedByUserId: userId,
  });
  console.log("Granted ADMIN role");
} else {
  console.log("Role already exists:", existingRole.role);
}

console.log(`\nDone. Log in with:\n  Email: ${EMAIL}\n  Password: ${TEMP_PASSWORD}\nChange your password immediately after login.\n`);
process.exit(0);
