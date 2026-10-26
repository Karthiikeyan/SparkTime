ALTER TABLE "studio"."documents" DROP CONSTRAINT "documents_status_chk";--> statement-breakpoint
ALTER TABLE "studio"."documents" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "studio"."documents" ADD COLUMN "trashed_by" uuid;--> statement-breakpoint
ALTER TABLE "studio"."documents" ADD CONSTRAINT "documents_trashed_by_users_id_fk" FOREIGN KEY ("trashed_by") REFERENCES "studio"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_operation_idx" ON "studio"."audit_logs" USING btree (("metadata"->>'operationId')) WHERE "studio"."audit_logs"."metadata" ? 'operationId';--> statement-breakpoint
ALTER TABLE "studio"."documents" ADD CONSTRAINT "documents_trash_chk" CHECK (("studio"."documents"."status" = 'trashed') = ("studio"."documents"."trashed_at" is not null));--> statement-breakpoint
ALTER TABLE "studio"."documents" ADD CONSTRAINT "documents_status_chk" CHECK ("studio"."documents"."status" in ('idea', 'draft', 'scheduled', 'published', 'archived', 'trashed'));