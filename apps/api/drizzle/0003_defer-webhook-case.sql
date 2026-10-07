-- 01 records the event before its case in one transaction; the key is checked at commit.
ALTER TABLE webhook_events
  ALTER CONSTRAINT webhook_events_case_id_cases_id_fk DEFERRABLE INITIALLY DEFERRED;
