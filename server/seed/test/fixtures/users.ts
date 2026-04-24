import { db } from "../../../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../../../auth/password";
import { seedIds } from "../../ids";
import { randomBytes } from "crypto";

export async function seedUsers() {
  // Seed passwords are temporary credentials — users must rotate on first login.
  // These are intentionally generic; real passwords must never be committed.
  const adminHash     = await hashPassword("Change_Me_Now!1");
  const frederikHash  = await hashPassword("Change_Me_Now!2");
  const stevenHash    = await hashPassword("Change_Me_Now!3");
  const carrieHash    = await hashPassword("Change_Me_Now!4");
  const prodHash      = await hashPassword("Change_Me_Now!5");
  const prod2Hash     = await hashPassword("Change_Me_Now!6");
  const recvHash      = await hashPassword("Change_Me_Now!7");
  const viewerHash    = await hashPassword("Change_Me_Now!8");
  const disabledHash  = await hashPassword(randomBytes(32).toString("hex")); // untouchable

  const rows = [
    { id: seedIds.users.admin,       email: "admin@neurogan.com",       fullName: "Admin Seed",       title: "Platform Admin",      passwordHash: adminHash,    status: "ACTIVE"    as const },
    { id: seedIds.users.frederik,    email: "fhv@neurogan.com",          fullName: "Frederik Hejlskov", title: "Platform Engineer", passwordHash: frederikHash, status: "ACTIVE"    as const },
    { id: seedIds.users.steven,      email: "stb@neurogan.com",          fullName: "Steven Burgueno",  title: "QC Manager",         passwordHash: stevenHash,   status: "ACTIVE"    as const },
    { id: seedIds.users.carrieTreat, email: "carrie.treat@neurogan.com", fullName: "Carrie Treat",     title: "QC / PCQI",          passwordHash: carrieHash,   status: "ACTIVE"    as const },
    { id: seedIds.users.prod,        email: "prod@neurogan.com",         fullName: "Production Lead",  title: "Production Lead",    passwordHash: prodHash,     status: "ACTIVE"    as const },
    { id: seedIds.users.prod2,       email: "prod2@neurogan.com",        fullName: "Production Op 2",  title: "Production Operator", passwordHash: prod2Hash,   status: "ACTIVE"    as const },
    { id: seedIds.users.recv,        email: "recv@neurogan.com",         fullName: "Receiving Clerk",  title: "Receiving",          passwordHash: recvHash,     status: "ACTIVE"    as const },
    { id: seedIds.users.viewer,      email: "viewer@neurogan.com",       fullName: "Read-Only Viewer", title: "Viewer",             passwordHash: viewerHash,   status: "ACTIVE"    as const },
    { id: seedIds.users.disabled,    email: "disabled@neurogan.com",     fullName: "Disabled User",    title: "Former Op",          passwordHash: disabledHash, status: "DISABLED"  as const },
  ];

  await db.insert(schema.users).values(rows).onConflictDoNothing();

  // Roles — composite PK (userId, role)
  const roleRows: { userId: string; role: schema.UserRole; grantedByUserId: string }[] = [
    { userId: seedIds.users.admin,       role: "ADMIN",      grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.frederik,    role: "ADMIN",      grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.steven,      role: "QA",         grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.carrieTreat, role: "QA",         grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.carrieTreat, role: "ADMIN",      grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.prod,        role: "PRODUCTION", grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.prod2,       role: "PRODUCTION", grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.recv,        role: "WAREHOUSE",  grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.viewer,      role: "VIEWER",     grantedByUserId: seedIds.users.admin },
    { userId: seedIds.users.disabled,    role: "PRODUCTION", grantedByUserId: seedIds.users.admin },
  ];

  await db.insert(schema.userRoles).values(roleRows).onConflictDoNothing();
}
