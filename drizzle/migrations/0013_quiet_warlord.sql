CREATE TYPE "public"."prompt_status" AS ENUM('draft', 'published');--> statement-breakpoint
ALTER TABLE "prompts" RENAME COLUMN "mergeStrategy" TO "merge_strategy";--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "current_version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "status" "prompt_status" DEFAULT 'published';--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "role_definition_variables" jsonb;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "instruction_template_variables" jsonb;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "role_definition_variable_schemas" jsonb;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "instruction_template_variable_schemas" jsonb;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "max_tokens" integer;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "temperature" integer;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "models" jsonb;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "pined_time" timestamp;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "provider" varchar;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "legacy_id" varchar(300);--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_legacy_id_unique" ON "prompts" USING btree ("legacy_id") WHERE "prompts"."legacy_id" is not null;--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"create_time" timestamp DEFAULT now() NOT NULL,
	"update_time" timestamp DEFAULT now() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(300) NOT NULL,
	"role_definition_template" varchar,
	"instruction_template" varchar NOT NULL,
	"role_definition_variable_schemas" jsonb,
	"instruction_template_variable_schemas" jsonb,
	"max_tokens" integer,
	"temperature" integer,
	"models" jsonb,
	"changelog" varchar,
	"published_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE TABLE "prompt_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"create_time" timestamp DEFAULT now() NOT NULL,
	"update_time" timestamp DEFAULT now() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"name" varchar(300) NOT NULL,
	"role_definition_template" varchar,
	"instruction_template" varchar NOT NULL,
	"role_definition_variable_schemas" jsonb,
	"instruction_template_variable_schemas" jsonb,
	"max_tokens" integer,
	"temperature" integer,
	"models" jsonb,
	"saved_at" timestamp NOT NULL
);--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prompt_drafts" ADD CONSTRAINT "prompt_drafts_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "prompt_versions_prompt_id_index" ON "prompt_versions" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX "prompt_versions_version_index" ON "prompt_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_prompt_id_version_unique" ON "prompt_versions" USING btree ("prompt_id", "version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_drafts_prompt_id_unique" ON "prompt_drafts" USING btree ("prompt_id");
