CREATE TYPE "public"."import_job_status" AS ENUM('processing', 'completed', 'completed_with_errors');--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"create_time" timestamp DEFAULT now() NOT NULL,
	"update_time" timestamp DEFAULT now() NOT NULL,
	"collection_id" uuid NOT NULL,
	"collection_name" varchar(300) NOT NULL,
	"status" "import_job_status" DEFAULT 'processing' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "import_job_id" uuid;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "import_jobs_collection_id_index" ON "import_jobs" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "import_jobs_create_time_index" ON "import_jobs" USING btree ("create_time");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "documents_import_job_id_index" ON "documents" USING btree ("import_job_id");