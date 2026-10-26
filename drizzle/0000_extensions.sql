-- Extensions required by the schema. pg_trgm powers fuzzy title matching in
-- search. Both Supabase and PGlite ship it; IF NOT EXISTS keeps this idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
