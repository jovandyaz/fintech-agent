CREATE TABLE "canary_cases" (
	"case_id" text PRIMARY KEY NOT NULL,
	"defect" text NOT NULL,
	CONSTRAINT "canary_cases_defect_known" CHECK ("canary_cases"."defect" in ('wrong_transaction', 'none_on_disputable', 'wrong_supported_action', 'misstated_policy', 'wrong_category', 'cold_tone'))
);
--> statement-breakpoint
ALTER TABLE "canary_cases" ADD CONSTRAINT "canary_cases_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT ON canary_cases TO copilot_api;
