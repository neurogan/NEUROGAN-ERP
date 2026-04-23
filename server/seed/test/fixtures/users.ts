import { db } from "../../../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../../../auth/password";
import { seedIds } from "../../ids";
import { randomBytes } from "crypto";

export async function seedUsers() {
  const adminHash    = await hashPassword("AdminSeed!2026");
  const carrieHash   = await hashPassword("CarrieSeed!2026");
  const prodHash     = await hashPassword("ProdSeed!2026");
  const prod2Hash    = await hashPassword("Prod2Seed!2026");
  const recvHash     = await hashPassword("RecvSeed!2026");
  const viewerHash   = await hashPassword("ViewSeed!2026");
  const disabledHash = await hashPassword(randomBytes(32).toString("hex")); // untouchable

  const rows = [
    { id: seedIds.users.admin,       email: "admin@neurogan.com",       fullName: "Admin Seed",       title: "Platform Admin",      passwordHash: adminHash,    status: "ACTIVE"    as const },
    { id: seedIds.users.carrieTreat, email: "carrie.treat@neurogan.com", fullName: "Carrie Treat",    title: "QC / PCQI",           passwordHash: carrieHash,   status: "ACTIVE"    as const },
    { id: seedIds.users.prod,        email: "prod@neurogan.com",         fullName: "Production Lead", title: "Production Lead",     passwordHash: prodHash,     status: "ACTIVE"    as const },
    { id: seedIds.users.prod2,       email: "prod2@neurogan.com",        fullName: "Production Op 2", title: "Production Operator", passwordHash: prod2Hash,    status: "ACTIVE"    as const },
    { id: seedIds.users.recv,        email: "recv@neurogan.com",         fullName: "Receiving Clerk", title: "Receiving",           passwordHash: recvHash,     status: "ACTIVE"    as const },
    { id: seedIds.users.viewer,      email: "viewer@neurogan.com",       fullName: "Read-Only Viewer", title: "Viewer",             passwordHash: viewerHash,   status: "ACTIVE"    as const },
    { id: seedIds.users.disabled,    email: "disabled@neurogan.com",     fullName: "Disabled User",   title: "Former Op",           passwordHash: disabledHash, status: "DISABLED"  as const },
  ];

  await db.insert(schema.users).values(rows).onConflictDoNothing();

  // Roles — composite PK (userId, role)
  const roleRows: { userId: string; role: schema.UserRole; grantedByUserId: string }[] = [
    { userId: seedIds.users.admin,       role: "ADMIN",      grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.carrieTreat, role: "QA",         grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.carrieTreat, role: "ADMIN",      grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.prod,        role: "PRODUCTION", grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.prod2,       role: "PRODUCTION", grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.recv,        role: "RECEIVING",  grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.viewer,      role: "VIEWER",     grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.disabled,    role: "PRODUCTION", grantedByUserId: seedIds.users.admin },
  ];

  await db.insert(schema.userRoles).values(roleRows).onConflictDoNothing();
}
