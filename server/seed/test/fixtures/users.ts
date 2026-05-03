import { db } from "../../../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../../../auth/password";
import { seedIds } from "../../ids";

export async function seedUsers() {
  // Seed passwords are temporary credentials — users must rotate on first login.
  // These are intentionally generic; real passwords must never be committed.
  const frederikHash  = await hashPassword("Change_Me_Now!2");
  const qcManagerHash = await hashPassword("Change_Me_Now!3");
  const carrieHash    = await hashPassword("Change_Me_Now!4");

  const rows = [
    { id: seedIds.users.frederik,    email: "fhv@neurogan.com",          fullName: "Frederik Hejlskov", title: "Platform Engineer", passwordHash: frederikHash, status: "ACTIVE" as const },
    { id: seedIds.users.steven,      email: "qcmanager@neurogan.com",    fullName: "QC Manager",       title: "Head of QC",         passwordHash: qcManagerHash, status: "ACTIVE" as const },
    { id: seedIds.users.carrieTreat, email: "carrie.treat@neurogan.com", fullName: "Carrie Treat",     title: "QC / PCQI",          passwordHash: carrieHash,   status: "ACTIVE" as const },
  ];

  await db.insert(schema.users).values(rows).onConflictDoNothing();

  // Roles — composite PK (userId, role)
  const roleRows: { userId: string; role: schema.UserRole; grantedByUserId: string }[] = [
    { userId: seedIds.users.frederik,    role: "ADMIN", grantedByUserId: seedIds.users.frederik },
    { userId: seedIds.users.steven,      role: "QA",    grantedByUserId: seedIds.users.frederik },
    { userId: seedIds.users.carrieTreat, role: "QA",    grantedByUserId: seedIds.users.frederik },
    { userId: seedIds.users.carrieTreat, role: "ADMIN", grantedByUserId: seedIds.users.frederik },
  ];

  await db.insert(schema.userRoles).values(roleRows).onConflictDoNothing();
}
