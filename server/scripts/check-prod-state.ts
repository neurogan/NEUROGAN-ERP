import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const drz = await pool.query(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations') AS exists_drizzle_schema,
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '__drizzle_migrations') AS exists_public
  `);
  console.log("__drizzle_migrations:", drz.rows[0]);

  for (const t of ["erp_users", "erp_user_roles", "erp_audit_trail", "erp_electronic_signatures", "erp_lab_qualifications", "erp_lab_test_results", "erp_validation_documents"]) {
    const e = await pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS x`, [t]);
    console.log(`  table ${t}: ${e.rows[0].x}`);
  }

  const userCount = await pool.query(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active, COUNT(*) FILTER (WHERE status = 'DISABLED') AS disabled FROM erp_users`);
  console.log("\nerp_users:", userCount.rows[0]);

  const roleCount = await pool.query(`SELECT role, COUNT(*) FROM erp_user_roles GROUP BY role`);
  console.log("erp_user_roles:", roleCount.rows);

  if (drz.rows[0].exists_drizzle_schema) {
    const r = await pool.query(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`);
    console.log("\ndrizzle.__drizzle_migrations rows:", r.rowCount);
    r.rows.forEach((x: { hash: string; created_at: number | string }) => console.log(`  ${x.created_at} ${String(x.hash).slice(0, 80)}`));
  }
  if (drz.rows[0].exists_public) {
    const r = await pool.query(`SELECT hash, created_at FROM public.__drizzle_migrations ORDER BY created_at`);
    console.log("\npublic.__drizzle_migrations rows:", r.rowCount);
    r.rows.forEach((x: { hash: string; created_at: number | string }) => console.log(`  ${x.created_at} ${String(x.hash).slice(0, 80)}`));
  }

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
