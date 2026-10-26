CREATE SCHEMA "studio";
--> statement-breakpoint
CREATE TABLE "studio"."audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"intro" jsonb,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"accent" text,
	"featured" boolean DEFAULT false NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"robots_index" text DEFAULT 'auto' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_robots_chk" CHECK ("studio"."categories"."robots_index" in ('auto', 'index', 'noindex'))
);
--> statement-breakpoint
CREATE TABLE "studio"."collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"group_label" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "collection_items_uq" UNIQUE("collection_id","document_id"),
	CONSTRAINT "collection_items_self_chk" CHECK ("studio"."collection_items"."collection_id" <> "studio"."collection_items"."document_id")
);
--> statement-breakpoint
CREATE TABLE "studio"."contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"message" text NOT NULL,
	"ip_hash" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "studio"."content_type_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"role" text,
	"required" boolean DEFAULT false NOT NULL,
	"help_text" text DEFAULT '' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"show_in_facts" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_type_fields_key_uq" UNIQUE("content_type_id","key")
);
--> statement-breakpoint
CREATE TABLE "studio"."content_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plural_name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"template" text NOT NULL,
	"schema_type" text DEFAULT 'CreativeWork' NOT NULL,
	"icon" text DEFAULT 'file' NOT NULL,
	"routing" text DEFAULT 'type' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"indexable" boolean DEFAULT true NOT NULL,
	"in_feeds" boolean DEFAULT true NOT NULL,
	"show_in_quick_create" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_types_slug_unique" UNIQUE("slug"),
	CONSTRAINT "content_types_routing_chk" CHECK ("studio"."content_types"."routing" in ('type', 'root'))
);
--> statement-breakpoint
CREATE TABLE "studio"."document_categories" (
	"document_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "document_categories_document_id_category_id_pk" PRIMARY KEY("document_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "studio"."document_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_relations_uq" UNIQUE("source_id","target_id","kind","origin"),
	CONSTRAINT "document_relations_self_chk" CHECK ("studio"."document_relations"."source_id" <> "studio"."document_relations"."target_id"),
	CONSTRAINT "document_relations_origin_chk" CHECK ("studio"."document_relations"."origin" in ('manual', 'content'))
);
--> statement-breakpoint
CREATE TABLE "studio"."document_tags" (
	"document_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "document_tags_document_id_tag_id_pk" PRIMARY KEY("document_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "studio"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"content" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"reading_minutes" integer DEFAULT 0 NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"featured_media_id" uuid,
	"author_id" uuid,
	"seo_title" text,
	"seo_description" text,
	"canonical_url" text,
	"robots_index" text DEFAULT 'default' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"template_override" text,
	"notes" text DEFAULT '' NOT NULL,
	"working_copy" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_extra" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(excerpt, '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(search_extra, '')), 'B') || setweight(to_tsvector('english'::regconfig, left(coalesce(plain_text, ''), 250000)), 'D')) STORED,
	CONSTRAINT "documents_type_slug_uq" UNIQUE("type_id","slug"),
	CONSTRAINT "documents_status_chk" CHECK ("studio"."documents"."status" in ('idea', 'draft', 'scheduled', 'published', 'archived')),
	CONSTRAINT "documents_visibility_chk" CHECK ("studio"."documents"."visibility" in ('private', 'unlisted', 'public')),
	CONSTRAINT "documents_robots_chk" CHECK ("studio"."documents"."robots_index" in ('default', 'index', 'noindex'))
);
--> statement-breakpoint
CREATE TABLE "studio"."media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"original_name" text DEFAULT '' NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"placeholder" text,
	"dominant_color" text,
	"alt" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"focal_x" real,
	"focal_y" real,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_kind_chk" CHECK ("studio"."media"."kind" in ('image', 'file', 'audio'))
);
--> statement-breakpoint
CREATE TABLE "studio"."navigation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location" text NOT NULL,
	"label" text NOT NULL,
	"link_type" text NOT NULL,
	"href" text,
	"ref_id" uuid,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "navigation_location_chk" CHECK ("studio"."navigation_items"."location" in ('primary', 'footer')),
	CONSTRAINT "navigation_link_type_chk" CHECK ("studio"."navigation_items"."link_type" in ('internal', 'external', 'content_type', 'category', 'document', 'group'))
);
--> statement-breakpoint
CREATE TABLE "studio"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"match_type" text DEFAULT 'exact' NOT NULL,
	"status_code" integer DEFAULT 308 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirects_from_path_unique" UNIQUE("from_path"),
	CONSTRAINT "redirects_match_chk" CHECK ("studio"."redirects"."match_type" in ('exact', 'prefix')),
	CONSTRAINT "redirects_status_chk" CHECK ("studio"."redirects"."status_code" in (301, 302, 307, 308)),
	CONSTRAINT "redirects_distinct_chk" CHECK ("studio"."redirects"."from_path" <> "studio"."redirects"."to_path")
);
--> statement-breakpoint
CREATE TABLE "studio"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "studio"."site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"robots_index" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tags_robots_chk" CHECK ("studio"."tags"."robots_index" in ('auto', 'index', 'noindex'))
);
--> statement-breakpoint
CREATE TABLE "studio"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"github_login" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
ALTER TABLE "studio"."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "studio"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "studio"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."collection_items" ADD CONSTRAINT "collection_items_collection_id_documents_id_fk" FOREIGN KEY ("collection_id") REFERENCES "studio"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."collection_items" ADD CONSTRAINT "collection_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "studio"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."content_type_fields" ADD CONSTRAINT "content_type_fields_content_type_id_content_types_id_fk" FOREIGN KEY ("content_type_id") REFERENCES "studio"."content_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."document_categories" ADD CONSTRAINT "document_categories_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "studio"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."document_categories" ADD CONSTRAINT "document_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "studio"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."document_relations" ADD CONSTRAINT "document_relations_source_id_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "studio"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."document_relations" ADD CONSTRAINT "document_relations_target_id_documents_id_fk" FOREIGN KEY ("target_id") REFERENCES "studio"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."document_tags" ADD CONSTRAINT "document_tags_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "studio"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."document_tags" ADD CONSTRAINT "document_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "studio"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."documents" ADD CONSTRAINT "documents_type_id_content_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "studio"."content_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."documents" ADD CONSTRAINT "documents_featured_media_id_media_id_fk" FOREIGN KEY ("featured_media_id") REFERENCES "studio"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."documents" ADD CONSTRAINT "documents_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "studio"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "studio"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."navigation_items" ADD CONSTRAINT "navigation_items_parent_id_navigation_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "studio"."navigation_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "studio"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "studio"."audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "studio"."categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "collection_items_document_idx" ON "studio"."collection_items" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "contact_messages_created_idx" ON "studio"."contact_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_type_fields_role_uq" ON "studio"."content_type_fields" USING btree ("content_type_id","role") WHERE "studio"."content_type_fields"."role" is not null;--> statement-breakpoint
CREATE INDEX "document_categories_category_idx" ON "studio"."document_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "document_relations_target_idx" ON "studio"."document_relations" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "document_tags_tag_idx" ON "studio"."document_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "documents_public_idx" ON "studio"."documents" USING btree ("status","visibility","published_at");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "studio"."documents" USING btree ("type_id","published_at");--> statement-breakpoint
CREATE INDEX "documents_updated_idx" ON "studio"."documents" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "studio"."documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "documents_title_trgm_idx" ON "studio"."documents" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "media_created_idx" ON "studio"."media" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "studio"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "studio"."sessions" USING btree ("expires_at");