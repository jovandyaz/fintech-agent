ALTER TABLE "action_executions" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
GRANT UPDATE (last_attempt_at) ON action_executions TO copilot_executor;
