DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_api') THEN
    CREATE ROLE copilot_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_executor') THEN
    CREATE ROLE copilot_executor NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_mcp') THEN
    CREATE ROLE copilot_mcp NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO copilot_api, copilot_executor, copilot_mcp;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON webhook_events, cases, agent_runs, run_steps, resolutions TO copilot_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON proposed_actions TO copilot_api;
--> statement-breakpoint
GRANT UPDATE (type, params, status, decided_by, decided_at, final_reply, reject_code, reject_reason, reply_edit_ratio, acknowledged_flags, reviewed_transaction_ids, operator_override) ON proposed_actions TO copilot_api;
--> statement-breakpoint
GRANT SELECT ON action_executions, security_events, policy_chunks TO copilot_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO copilot_api;
--> statement-breakpoint
GRANT SELECT ON proposed_actions, cases TO copilot_executor;
--> statement-breakpoint
GRANT UPDATE (status) ON proposed_actions TO copilot_executor;
--> statement-breakpoint
GRANT SELECT, INSERT ON action_executions TO copilot_executor;
--> statement-breakpoint
GRANT UPDATE (status, attempts, finished_at, result) ON action_executions TO copilot_executor;
--> statement-breakpoint
GRANT INSERT ON audit_log TO copilot_executor;
--> statement-breakpoint
GRANT INSERT ON security_events TO copilot_mcp;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_transition_role() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed'
       OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL
       OR NEW.final_reply IS NOT NULL OR NEW.reject_code IS NOT NULL
       OR NEW.reject_reason IS NOT NULL OR NEW.reply_edit_ratio IS NOT NULL
       OR NEW.acknowledged_flags IS NOT NULL OR NEW.reviewed_transaction_ids IS NOT NULL
       OR NEW.operator_override
       OR NEW.type <> NEW.agent_type OR NEW.params <> NEW.agent_params THEN
      RAISE EXCEPTION 'a proposal starts undecided, executing what the agent proposed';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_canary IS DISTINCT FROM OLD.is_canary THEN
    RAISE EXCEPTION 'is_canary is immutable';
  END IF;
  IF NEW.status = OLD.status THEN
    RAISE EXCEPTION 'a proposal changes only through a transition';
  END IF;
  IF OLD.status = 'proposed' AND current_user = 'copilot_api' AND (
       (NOT OLD.is_canary AND NEW.status IN ('approved', 'rejected', 'superseded'))
    OR (OLD.is_canary AND NEW.status IN ('canary_caught', 'canary_missed', 'superseded'))
  ) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND current_user = 'copilot_executor'
     AND NEW.status IN ('executed', 'failed') AND NOT OLD.is_canary
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'transition % -> % refused for %', OLD.status, NEW.status, current_user;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS enforce_transition_role ON proposed_actions;
--> statement-breakpoint
CREATE TRIGGER enforce_transition_role BEFORE INSERT OR UPDATE ON proposed_actions
  FOR EACH ROW EXECUTE FUNCTION enforce_transition_role();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_execution_of_approved() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.proposed_actions
    WHERE id = NEW.action_id AND status = 'approved' AND NOT is_canary
  ) THEN
    RAISE EXCEPTION 'only an approved, non-canary action is executed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS enforce_execution_of_approved ON action_executions;
--> statement-breakpoint
CREATE TRIGGER enforce_execution_of_approved BEFORE INSERT ON action_executions
  FOR EACH ROW EXECUTE FUNCTION enforce_execution_of_approved();
