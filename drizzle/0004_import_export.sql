CREATE TABLE "studio"."import_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"path" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text,
	"head" text,
	"content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_files_path_uq" UNIQUE("job_id","path")
);
--> statement-breakpoint
CREATE TABLE "studio"."import_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"stage" text NOT NULL,
	"key" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"target_id" uuid,
	"error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_items_key_uq" UNIQUE("job_id","key"),
	CONSTRAINT "import_items_status_chk" CHECK ("studio"."import_items"."status" in ('pending', 'done', 'skipped', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "studio"."import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"status" text DEFAULT 'staging' NOT NULL,
	"source_name" text DEFAULT '' NOT NULL,
	"source_system" text,
	"schema_version" integer,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan" jsonb,
	"plan_hash" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"file_count" integer DEFAULT 0 NOT NULL,
	"text_bytes" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "import_jobs_status_chk" CHECK ("studio"."import_jobs"."status" in ('staging', 'analyzed', 'running', 'completed', 'partial', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "studio"."portable_identities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"portable_id" text NOT NULL,
	"entity" text NOT NULL,
	"document_id" uuid,
	"category_id" uuid,
	"tag_id" uuid,
	"media_id" uuid,
	"source" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portable_identities_uq" UNIQUE("entity","portable_id"),
	CONSTRAINT "portable_identities_entity_chk" CHECK ("studio"."portable_identities"."entity" in ('document', 'topic', 'tag', 'media')),
	CONSTRAINT "portable_identities_target_chk" CHECK (("studio"."portable_identities"."entity" = 'document' and "studio"."portable_identities"."document_id" is not null and "studio"."portable_identities"."category_id" is null and "studio"."portable_identities"."tag_id" is null and "studio"."portable_identities"."media_id" is null)
       or ("studio"."portable_identities"."entity" = 'topic' and "studio"."portable_identities"."category_id" is not null and "studio"."portable_identities"."document_id" is null and "studio"."portable_identities"."tag_id" is null and "studio"."portable_identities"."media_id" is null)
       or ("studio"."portable_identities"."entity" = 'tag' and "studio"."portable_identities"."tag_id" is not null and "studio"."portable_identities"."document_id" is null and "studio"."portable_identities"."category_id" is null and "studio"."portable_identities"."media_id" is null)
       or ("studio"."portable_identities"."entity" = 'media' and "studio"."portable_identities"."media_id" is not null and "studio"."portable_identities"."document_id" is null and "studio"."portable_identities"."category_id" is null and "studio"."portable_identities"."tag_id" is null))
);
--> statement-breakpoint
ALTER TABLE "studio"."import_files" ADD CONSTRAINT "import_files_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "studio"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."import_items" ADD CONSTRAINT "import_items_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "studio"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "studio"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."portable_identities" ADD CONSTRAINT "portable_identities_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "studio"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."portable_identities" ADD CONSTRAINT "portable_identities_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "studio"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."portable_identities" ADD CONSTRAINT "portable_identities_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "studio"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."portable_identities" ADD CONSTRAINT "portable_identities_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "studio"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_items_queue_idx" ON "studio"."import_items" USING btree ("job_id","status","seq");--> statement-breakpoint
CREATE INDEX "import_jobs_created_idx" ON "studio"."import_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "portable_identities_document_idx" ON "studio"."portable_identities" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "portable_identities_category_idx" ON "studio"."portable_identities" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "portable_identities_tag_idx" ON "studio"."portable_identities" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "portable_identities_media_idx" ON "studio"."portable_identities" USING btree ("media_id");--> statement-breakpoint
-- Same defence in depth as 0002_lockdown.sql for the new tables: RLS with no
-- policies, and no privileges for Supabase's API roles (no-ops elsewhere).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_jobs', 'import_files', 'import_items', 'portable_identities'] LOOP
    EXECUTE format('ALTER TABLE studio.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON studio.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON studio.%I FROM authenticated', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA studio FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA studio FROM authenticated';
  END IF;
END $$;
