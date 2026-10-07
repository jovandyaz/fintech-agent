-- 02 G3: a superseded proposal can no longer be decided, so it keeps the undecided row it replaced.
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
  IF OLD.status = 'proposed' AND current_user = 'copilot_api' AND NEW.status = 'superseded' THEN
    IF (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a superseded proposal changes nothing but its status';
  END IF;
  IF OLD.status = 'proposed' AND current_user = 'copilot_api' AND (
       (NOT OLD.is_canary AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.is_canary AND NEW.status IN ('canary_caught', 'canary_missed'))
  ) THEN
    IF NEW.decided_by IS NULL OR NEW.decided_at IS NULL OR NEW.final_reply IS NULL
       OR (NEW.status IN ('rejected', 'canary_caught') AND NEW.reject_code IS NULL) THEN
      RAISE EXCEPTION 'a decision records who decided, when, and the final reply';
    END IF;
    IF NEW.operator_override IS DISTINCT FROM
       ((NEW.type, NEW.params) IS DISTINCT FROM (NEW.agent_type, NEW.agent_params)) THEN
      RAISE EXCEPTION 'operator_override is set exactly when the action differs from the agent''s';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND current_user = 'copilot_executor'
     AND NEW.status IN ('executed', 'failed') AND NOT OLD.is_canary
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'transition % -> % refused for %', OLD.status, NEW.status, current_user;
END $$;
