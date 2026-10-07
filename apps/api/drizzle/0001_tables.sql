CREATE TYPE "public"."action_status" AS ENUM('proposed', 'approved', 'executed', 'rejected', 'failed', 'superseded', 'canary_caught', 'canary_missed');--> statement-breakpoint
CREATE TYPE "public"."action_type" AS ENUM('open_dispute', 'resend_cep', 'escalate_fraud', 'none');--> statement-breakpoint
CREATE TYPE "public"."case_category" AS ENUM('spei_outgoing_not_received', 'spei_incoming_not_credited', 'unrecognized_card_charge', 'card_purchase_declined', 'general_inquiry', 'out_of_scope_or_suspicious');--> statement-breakpoint
CREATE TYPE "public"."case_source" AS ENUM('webhook', 'console', 'eval');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('queued', 'investigating', 'needs_review', 'resolved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('started', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reject_code" AS ENUM('wrong_category', 'wrong_action', 'wrong_transactions', 'wrong_policy_or_ungrounded', 'missing_policy', 'tone', 'other');--> statement-breakpoint
CREATE TYPE "public"."review_tier" AS ENUM('standard', 'high');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'fallback', 'failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."security_event_kind" AS ENUM('cross_customer_lookup');--> statement-breakpoint
CREATE TYPE "public"."step_kind" AS ENUM('llm', 'tool', 'retrieval', 'guard', 'validation');--> statement-breakpoint
CREATE TYPE "public"."stop_reason" AS ENUM('completed', 'budget', 'validation', 'agent_disabled', 'error');--> statement-breakpoint
CREATE TABLE "action_executions" (
	"action_id" text PRIMARY KEY NOT NULL,
	"status" "execution_status" NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"variant" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"stop_reason" "stop_reason",
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"event" text NOT NULL,
	"ref" text NOT NULL,
	"detail_masked" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"key_id" text,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"folio" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"source" "case_source" NOT NULL,
	"customer_id" text NOT NULL,
	"text_masked" text NOT NULL,
	"text_redacted" text,
	"status" "case_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"manual_reruns" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"claim_token" uuid,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" "case_category",
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_tier" "review_tier",
	CONSTRAINT "cases_ticket_id_unique" UNIQUE("ticket_id"),
	CONSTRAINT "cases_folio_unique" UNIQUE("folio")
);
--> statement-breakpoint
CREATE TABLE "policy_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"section" text NOT NULL,
	"content" text NOT NULL,
	"keywords" text DEFAULT '' NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('es_unaccent', "policy_chunks"."section"), 'A') || setweight(to_tsvector('es_unaccent', "policy_chunks"."keywords"), 'B') || setweight(to_tsvector('es_unaccent', "policy_chunks"."content"), 'D')) STORED NOT NULL,
	"state_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"quarantined" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposed_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"run_id" text,
	"agent_type" "action_type" NOT NULL,
	"agent_params" jsonb NOT NULL,
	"type" "action_type" NOT NULL,
	"params" jsonb NOT NULL,
	"justification" text NOT NULL,
	"status" "action_status" DEFAULT 'proposed' NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"final_reply" text,
	"reject_code" "reject_code",
	"reject_reason" text,
	"reply_edit_ratio" real,
	"acknowledged_flags" jsonb,
	"reviewed_transaction_ids" jsonb,
	"operator_override" boolean DEFAULT false NOT NULL,
	"is_canary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolutions" (
	"run_id" text PRIMARY KEY NOT NULL,
	"category" "case_category" NOT NULL,
	"draft_reply" text NOT NULL,
	"citations" jsonb NOT NULL,
	"abstained" boolean NOT NULL,
	"reasoning_summary" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"run_id" text NOT NULL,
	"idx" integer NOT NULL,
	"kind" "step_kind" NOT NULL,
	"name" text NOT NULL,
	"input_masked" jsonb,
	"output_masked" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_input_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"provider_request_id" text,
	"finish_reason" text,
	CONSTRAINT "run_steps_run_id_idx_pk" PRIMARY KEY("run_id","idx")
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "security_event_kind" NOT NULL,
	"case_id" text NOT NULL,
	"run_id" text NOT NULL,
	"ref_masked" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"payload_hash" text NOT NULL,
	"case_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_action_id_proposed_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."proposed_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_claimable" ON "cases" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "policy_chunks_tsv" ON "policy_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_proposal_per_case" ON "proposed_actions" USING btree ("case_id") WHERE "proposed_actions"."status" = 'proposed';