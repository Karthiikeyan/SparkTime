-- Defence in depth for hosted Postgres (Supabase).
--
-- The application connects as the table owner and enforces authorization in
-- its service layer. Supabase additionally exposes a REST/GraphQL API to the
-- `anon` and `authenticated` roles. Our tables live in the non-exposed
-- `studio` schema, and here we also (1) enable RLS with no policies, which
-- denies every non-owner role, and (2) revoke all privileges from the API
-- roles when they exist. On plain Postgres / PGlite the role checks no-op.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'studio' LOOP
    EXECUTE format('ALTER TABLE studio.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA studio FROM anon';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA studio FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA studio FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA studio FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA studio FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA studio FROM authenticated';
  END IF;
END $$;
