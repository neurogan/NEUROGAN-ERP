-- 0013: Remove placeholder seed users from a fresh-DB bootstrap fixture.
--
-- DESIGN INTENT: This migration was written to clean placeholder accounts that
-- a fresh-DB bootstrap seeded (Admin Seed, Production Lead, etc). It is NOT
-- intended to run on environments where those UUIDs were repurposed as real
-- disabled accounts with audit history (i.e. production).
--
-- THREE INDEPENDENT GUARDS protect against accidental data loss:
--   1. PRODUCTION-USE GUARD: aborts if any placeholder UUID has audit-trail
--      entries, electronic signatures, or is older than 24 hours. Real
--      production-state accounts have all three.
--   2. ADMIN-SURVIVAL GUARD: aborts if no admin remains after placeholder
--      removal.
--   3. NO PATTERN DELETES: only deletes by explicit UUID array. Never uses
--      email LIKE, name LIKE, or any other broad pattern.
--
-- If you need to bypass this migration on a production-state DB, mark it
-- applied without executing:
--   INSERT INTO __drizzle_migrations (hash, created_at)
--   VALUES ('manually-skipped-0013', 1745500500000);

DO $$
DECLARE
  placeholder_ids uuid[] := ARRAY[
    '00000000-0000-0001-0000-000000000001'::uuid,  -- Admin Seed
    '00000000-0000-0001-0000-000000000003'::uuid,  -- Production Lead
    '00000000-0000-0001-0000-000000000004'::uuid,  -- Production Op 2
    '00000000-0000-0001-0000-000000000005'::uuid,  -- Warehouse Clerk
    '00000000-0000-0001-0000-000000000006'::uuid,  -- Read-Only Viewer
    '00000000-0000-0001-0000-000000000007'::uuid   -- Disabled User
  ];
  frederik_id uuid := '00000000-0000-0001-0000-000000000008';
  placeholder_audit_count   bigint;
  placeholder_sig_count     bigint;
  oldest_placeholder_hours  numeric;
  remaining_admin_count     bigint;
BEGIN
  -- ── GUARD 1: production-use check ─────────────────────────────────────────
  -- If any placeholder UUID has audit/signature history or has existed for
  -- more than 24 hours, this is a production-state DB. Abort.
  SELECT COUNT(*) INTO placeholder_audit_count
    FROM erp_audit_trail WHERE user_id = ANY(placeholder_ids);

  SELECT COUNT(*) INTO placeholder_sig_count
    FROM erp_electronic_signatures WHERE user_id = ANY(placeholder_ids);

  SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 3600, 0)
    INTO oldest_placeholder_hours
    FROM erp_users WHERE id = ANY(placeholder_ids);

  IF placeholder_audit_count > 0
     OR placeholder_sig_count > 0
     OR oldest_placeholder_hours > 24 THEN
    RAISE EXCEPTION
      'Migration 0013 aborted by production-use guard: placeholder UUIDs '
      'show real usage (audit_entries=%, signatures=%, oldest_age_hours=%). '
      'These are not fresh-seed bootstrap users — they are real accounts. '
      'To skip this migration without executing it, run: '
      'INSERT INTO __drizzle_migrations (hash, created_at) VALUES '
      '(''manually-skipped-0013'', 1745500500000);',
      placeholder_audit_count, placeholder_sig_count, oldest_placeholder_hours;
  END IF;

  -- ── GUARD 2: admin-survival check ─────────────────────────────────────────
  -- Count admins that will remain after placeholder removal (Frederik counts).
  SELECT COUNT(*) INTO remaining_admin_count
    FROM erp_user_roles r
    JOIN erp_users u ON u.id = r.user_id
    WHERE r.role = 'ADMIN'
    AND u.id != ALL(placeholder_ids);

  IF remaining_admin_count = 0 THEN
    RAISE EXCEPTION
      'Migration 0013 aborted by admin-survival guard: no admin account '
      'would remain after placeholder removal. Create a real admin via '
      'Settings → Users (or run server/scripts/recover-admin.ts) before '
      'running this migration.';
  END IF;
  -- ── End guards ────────────────────────────────────────────────────────────

  -- Re-attribute any role grants that reference a placeholder user
  UPDATE erp_user_roles
    SET granted_by_user_id = frederik_id
    WHERE granted_by_user_id = ANY(placeholder_ids);

  -- Delete FK-dependent rows before removing the users themselves.
  -- These deletes target ONLY the explicit placeholder UUIDs — never a
  -- pattern. After GUARD 1 these rows are guaranteed empty, so the deletes
  -- are no-ops. They are kept for defense-in-depth.
  DELETE FROM erp_audit_trail         WHERE user_id = ANY(placeholder_ids);
  DELETE FROM erp_electronic_signatures WHERE user_id = ANY(placeholder_ids);
  DELETE FROM erp_approved_materials  WHERE approved_by_user_id = ANY(placeholder_ids);
  DELETE FROM erp_user_roles          WHERE user_id = ANY(placeholder_ids);

  DELETE FROM erp_users WHERE id = ANY(placeholder_ids);

  -- NOTE: The original migration also deleted users matching email LIKE
  -- '%@%.test'. That block has been intentionally removed. It is too broad
  -- and will delete real accounts if a legitimate email ends in a .test TLD.
  -- CI databases are ephemeral and do not need cleanup via migration.
END $$;
