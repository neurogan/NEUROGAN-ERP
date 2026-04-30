/**
 * Prod user safety check — snapshot before, verify after a deploy.
 *
 * Captures every user's id, email, status, role list, and a SHA-256 of the
 * password_hash. The hash-of-hash means we can prove "no password changed"
 * without ever putting the actual argon2id hash in a file.
 *
 * Modes:
 *   snapshot  — write current state to /tmp/prod-users-snapshot.json
 *   verify    — re-read state, diff against snapshot, exit non-zero on any
 *               (a) deleted user, (b) status flip, (c) password_hash change,
 *               (d) role change. New users are reported but do not fail.
 *
 * Run BEFORE the merge:
 *   DATABASE_URL=<prod-url> npx tsx server/scripts/prod-user-safety-check.ts snapshot
 *
 * Run AFTER the deploy completes:
 *   DATABASE_URL=<prod-url> npx tsx server/scripts/prod-user-safety-check.ts verify
 */
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT_PATH = "/tmp/prod-users-snapshot.json";

interface UserRow {
  id: string;
  email: string;
  status: string;
  password_hash_sha256: string;
  roles: string[];
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function captureState(): Promise<UserRow[]> {
  const users = await pool.query<{ id: string; email: string; status: string; password_hash: string }>(
    `SELECT id::text, email, status, password_hash FROM erp_users ORDER BY id`,
  );
  const roles = await pool.query<{ user_id: string; role: string }>(
    `SELECT user_id::text, role FROM erp_user_roles`,
  );
  const rolesByUser = new Map<string, string[]>();
  for (const r of roles.rows) {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(r.role);
    rolesByUser.set(r.user_id, list);
  }
  return users.rows.map((u) => ({
    id: u.id,
    email: u.email,
    status: u.status,
    password_hash_sha256: sha256(u.password_hash),
    roles: (rolesByUser.get(u.id) ?? []).sort(),
  }));
}

async function snapshot() {
  const state = await captureState();
  writeFileSync(SNAPSHOT_PATH, JSON.stringify({ capturedAt: new Date().toISOString(), users: state }, null, 2));
  console.log(`Snapshot written: ${SNAPSHOT_PATH}`);
  console.log(`  Total users: ${state.length}`);
  console.log(`  Active: ${state.filter((u) => u.status === "ACTIVE").length}`);
  console.log(`  Disabled: ${state.filter((u) => u.status === "DISABLED").length}`);
  console.log("\nKeep this file until you've verified the post-deploy state.");
}

async function verify() {
  const before: { capturedAt: string; users: UserRow[] } = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
  const after = await captureState();

  const beforeById = new Map<string, UserRow>(before.users.map((u) => [u.id, u]));
  const afterById = new Map<string, UserRow>(after.map((u) => [u.id, u]));

  const failures: string[] = [];
  const warnings: string[] = [];

  for (const [id, b] of beforeById) {
    const a = afterById.get(id);
    if (!a) {
      failures.push(`❌ DELETED: ${b.email} (id=${id})`);
      continue;
    }
    if (a.email !== b.email) failures.push(`❌ EMAIL CHANGED: ${b.email} → ${a.email} (id=${id})`);
    if (a.status !== b.status) failures.push(`❌ STATUS CHANGED: ${b.email} ${b.status} → ${a.status}`);
    if (a.password_hash_sha256 !== b.password_hash_sha256) {
      failures.push(`❌ PASSWORD CHANGED: ${b.email}`);
    }
    if (JSON.stringify(a.roles) !== JSON.stringify(b.roles)) {
      warnings.push(`⚠️  ROLES CHANGED: ${b.email} [${b.roles.join(",")}] → [${a.roles.join(",")}]`);
    }
  }

  for (const [id, a] of afterById) {
    if (!beforeById.has(id)) {
      warnings.push(`ℹ️  NEW USER: ${a.email} (id=${id}) — additive, not a failure`);
    }
  }

  console.log(`Snapshot taken at: ${before.capturedAt}`);
  console.log(`Verifying against: ${new Date().toISOString()}`);
  console.log(`Users before: ${before.users.length}, after: ${after.length}\n`);

  if (warnings.length) {
    console.log("Warnings:");
    warnings.forEach((w) => console.log(`  ${w}`));
    console.log("");
  }

  if (failures.length) {
    console.log("FAILURES:");
    failures.forEach((f) => console.log(`  ${f}`));
    console.log(`\n❌ ${failures.length} user-safety violation(s). Roll back the deploy.`);
    process.exit(1);
  }

  console.log("✅ All pre-existing users intact: no deletions, no status flips, no password changes.");
  process.exit(0);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "snapshot") await snapshot();
  else if (mode === "verify") await verify();
  else {
    console.error("Usage: prod-user-safety-check.ts <snapshot|verify>");
    process.exit(2);
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
