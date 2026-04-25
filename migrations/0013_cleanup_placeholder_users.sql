-- 0013: Remove placeholder seed users created by the bootstrap seed fixture.
--
-- SAFETY GUARD: Aborts if no real (non-placeholder, non-test) admin account
-- exists. This ensures the migration cannot wipe all admins on any environment.
--
-- Only removes the six explicit placeholder UUIDs. Does NOT use email pattern
-- matching — that approach is too broad and risks deleting real accounts.

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
  real_admin_count int;
BEGIN
  -- ── Safety guard ──────────────────────────────────────────────────────────
  -- Count admins whose UUID is NOT one of the placeholder IDs.
  -- These are accounts created via Settings → Users after bootstrap.
  SELECT COUNT(*) INTO real_admin_count
    FROM erp_user_roles r
    JOIN erp_users u ON u.id = r.user_id
    WHERE r.role = 'ADMIN'
    AND u.id != ALL(placeholder_ids)
    AND u.id != frederik_id;

  IF real_admin_count = 0 THEN
    RAISE EXCEPTION
      'Migration 0013 safety guard: no real admin account found. '
      'Create an admin via Settings → Users before running this migration. '
      'Aborting to protect all user accounts.';
  END IF;
  -- ── End safety guard ──────────────────────────────────────────────────────

  -- Re-attribute any role grants that reference a placeholder user
  UPDATE erp_user_roles
    SET granted_by_user_id = frederik_id
    WHERE granted_by_user_id = ANY(placeholder_ids);

  -- Delete FK-dependent rows before removing the users themselves
  DELETE FROM erp_audit_trail         WHERE user_id = ANY(placeholder_ids);
  DELETE FROM erp_electronic_signatures WHERE user_id = ANY(placeholder_ids);
  DELETE FROM erp_approved_materials  WHERE approved_by_user_id = ANY(placeholder_ids);
  DELETE FROM erp_user_roles          WHERE user_id = ANY(placeholder_ids);

  DELETE FROM erp_users WHERE id = ANY(placeholder_ids);

  -- NOTE: The original migration also deleted users matching email LIKE '%@%.test'.
  -- That block has been intentionally removed. It is too broad and will delete
  -- real accounts if a legitimate email happens to end in a .test TLD.
  -- CI databases are ephemeral and do not need cleanup via migration.
END $$;
