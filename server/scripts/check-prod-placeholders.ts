import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const placeholderIds = [
  "00000000-0000-0001-0000-000000000001",
  "00000000-0000-0001-0000-000000000003",
  "00000000-0000-0001-0000-000000000004",
  "00000000-0000-0001-0000-000000000005",
  "00000000-0000-0001-0000-000000000006",
  "00000000-0000-0001-0000-000000000007",
];

async function main() {
  const present = await pool.query(
    `SELECT id, email, full_name, status, created_at FROM erp_users WHERE id::text = ANY($1)`,
    [placeholderIds],
  );
  console.log("Placeholder UUIDs present on prod:", present.rowCount);
  present.rows.forEach((r) => console.log(`  ${r.id} ${r.email} status=${r.status} created=${r.created_at}`));

  const auditCount = await pool.query(`SELECT COUNT(*) FROM erp_audit_trail WHERE user_id::text = ANY($1)`, [placeholderIds]);
  const sigCount = await pool.query(`SELECT COUNT(*) FROM erp_electronic_signatures WHERE user_id::text = ANY($1)`, [placeholderIds]);
  const ageHours = await pool.query(
    `SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 3600, 0)::numeric AS h FROM erp_users WHERE id::text = ANY($1)`,
    [placeholderIds],
  );
  console.log("\nGUARD 1 inputs:");
  console.log("  audit_count:", auditCount.rows[0].count);
  console.log("  signature_count:", sigCount.rows[0].count);
  console.log("  oldest_age_hours:", ageHours.rows[0].h);
  const fires =
    Number(auditCount.rows[0].count) > 0 ||
    Number(sigCount.rows[0].count) > 0 ||
    Number(ageHours.rows[0].h) > 24;
  console.log("  → GUARD 1 fires:", fires);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
