CREATE TABLE "case_clock" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"mode" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_clock_one_row" CHECK ("case_clock"."id"),
	CONSTRAINT "case_clock_mode_known" CHECK ("case_clock"."mode" in ('wall', 'dataset'))
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON case_clock TO copilot_api;
