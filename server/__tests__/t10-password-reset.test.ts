import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../email/resend", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { sendPasswordResetEmail } from "../email/resend";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

describeIfDb("T-10 — Self-service password reset", () => {
  let app: Express;
  let userId: string;
  let userEmail: string;
  const toDelete = { users: [] as string[] };

  beforeAll(async () => {
    app = await buildTestApp();

    const [u] = await db
      .insert(schema.users)
      .values({
        email: `t10-${Date.now()}@test.com`,
        fullName: "T10 User",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
        status: "ACTIVE",
      })
      .returning();
    userId = u!.id;
    userEmail = u!.email;
    toDelete.users.push(userId);

    await db
      .update(schema.users)
      .set({ passwordChangedAt: new Date() })
      .where(eq(schema.users.id, userId));
  });

  afterAll(async () => {
    for (const id of toDelete.users) {
      await db.delete(schema.users).where(eq(schema.users.id, id)).catch(() => {});
    }
  });

  async function getTokenRow(id: string) {
    const [row] = await db
      .select({
        resetTokenHash: schema.users.resetTokenHash,
        resetTokenExpiresAt: schema.users.resetTokenExpiresAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return row;
  }

  async function requestReset(email: string): Promise<string | null> {
    const mock = vi.mocked(sendPasswordResetEmail);
    mock.mockClear();
    await request(app).post("/api/auth/forgot-password").send({ email });
    if (mock.mock.calls.length === 0) return null;
    return mock.mock.calls[0]![1] as string;
  }

  it("200 for unknown email (anti-enumeration)", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
  });

  it("200 for PENDING_INVITE user — no token stored", async () => {
    const [pending] = await db
      .insert(schema.users)
      .values({
        email: `t10-pending-${Date.now()}@test.com`,
        fullName: "T10 Pending",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
        status: "PENDING_INVITE",
      })
      .returning();
    toDelete.users.push(pending!.id);

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: pending!.email });
    expect(res.status).toBe(200);

    const row = await getTokenRow(pending!.id);
    expect(row?.resetTokenHash).toBeNull();
  });

  it("stores resetTokenHash for valid ACTIVE email", async () => {
    const rawToken = await requestReset(userEmail);
    expect(rawToken).not.toBeNull();
    const row = await getTokenRow(userId);
    expect(row?.resetTokenHash).toBeTruthy();
    expect(row?.resetTokenExpiresAt).toBeTruthy();
  });

  it("400 RESET_INVALID for expired token", async () => {
    await requestReset(userEmail);
    await db
      .update(schema.users)
      .set({ resetTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.users.id, userId));

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: "anytoken", password: "NewPassword1!" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("RESET_INVALID");
  });

  it("400 RESET_INVALID for wrong token", async () => {
    await requestReset(userEmail);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: "aaaaaabbbbbbccccccddddddeeeeeeffffffff", password: "NewPassword1!" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("RESET_INVALID");

    await db
      .update(schema.users)
      .set({ resetTokenHash: null, resetTokenExpiresAt: null })
      .where(eq(schema.users.id, userId));
  });

  it("200: valid token resets password, clears token, old password invalid", async () => {
    const rawToken = await requestReset(userEmail);
    expect(rawToken).not.toBeNull();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: rawToken!, password: "NewPassword1!" });
    expect(res.status).toBe(200);

    const row = await getTokenRow(userId);
    expect(row?.resetTokenHash).toBeNull();
    expect(row?.resetTokenExpiresAt).toBeNull();

    const loginOld = await request(app)
      .post("/api/auth/login")
      .send({ email: userEmail, password: VALID_PASSWORD });
    expect(loginOld.status).toBe(401);

    const restored = await hashPassword(VALID_PASSWORD);
    await db
      .update(schema.users)
      .set({ passwordHash: restored, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(schema.users.id, userId));
  });

  it("422 VALIDATION_FAILED when reusing current password", async () => {
    const rawToken = await requestReset(userEmail);
    expect(rawToken).not.toBeNull();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: rawToken!, password: VALID_PASSWORD });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");

    await db
      .update(schema.users)
      .set({ resetTokenHash: null, resetTokenExpiresAt: null })
      .where(eq(schema.users.id, userId));
  });

  it("400 RESET_INVALID when token used a second time", async () => {
    const rawToken = await requestReset(userEmail);
    expect(rawToken).not.toBeNull();

    await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: rawToken!, password: "NewPassword1!" });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: userEmail, token: rawToken!, password: "AnotherPass1!" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("RESET_INVALID");

    const restored = await hashPassword(VALID_PASSWORD);
    await db
      .update(schema.users)
      .set({ passwordHash: restored, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(schema.users.id, userId));
  });
});
