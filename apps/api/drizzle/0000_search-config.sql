CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'es_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION es_unaccent (COPY = spanish);
    ALTER TEXT SEARCH CONFIGURATION es_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;
  END IF;
END $$;
