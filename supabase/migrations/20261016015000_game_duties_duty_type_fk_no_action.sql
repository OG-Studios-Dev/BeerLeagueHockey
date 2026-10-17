BEGIN;

-- Harden the one hosted FK action that can otherwise leave a canonical duty
-- orphaned when the Beer Guy child-delete trigger preserves the child row.
-- Accept only the exact hosted CASCADE baseline or this migration's exact
-- already-applied NO ACTION state; reject every other catalog shape.
DO $game_duties_duty_type_fk_hardening$
DECLARE
  v_game_duties oid := pg_catalog.to_regclass('public.game_duties');
  v_duty_types oid := pg_catalog.to_regclass('public.duty_types');
  v_constraint pg_catalog.pg_constraint%ROWTYPE;
  v_source_attnum smallint;
  v_target_attnum smallint;
  v_edge_count integer;
BEGIN
  IF v_game_duties IS NULL OR v_duty_types IS NULL THEN
    RAISE EXCEPTION 'game_duties duty-type FK hardening baseline is incompatible; required tables are missing'
      USING ERRCODE = '55000';
  END IF;

  LOCK TABLE public.duty_types, public.game_duties IN ACCESS EXCLUSIVE MODE;

  SELECT att.attnum INTO v_source_attnum
  FROM pg_catalog.pg_attribute AS att
  WHERE att.attrelid = v_game_duties
    AND att.attname = 'duty_type_id'
    AND att.attnum > 0
    AND NOT att.attisdropped;
  SELECT att.attnum INTO v_target_attnum
  FROM pg_catalog.pg_attribute AS att
  WHERE att.attrelid = v_duty_types
    AND att.attname = 'id'
    AND att.attnum > 0
    AND NOT att.attisdropped;
  IF v_source_attnum IS NULL OR v_target_attnum IS NULL THEN
    RAISE EXCEPTION 'game_duties duty-type FK hardening baseline is incompatible; required columns are missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT con.* INTO v_constraint
  FROM pg_catalog.pg_constraint AS con
  WHERE con.conrelid = v_game_duties
    AND con.conname = 'game_duties_duty_type_id_fkey';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_duties duty-type FK hardening baseline is incompatible; exact constraint name is missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*) INTO v_edge_count
  FROM pg_catalog.pg_constraint AS con
  WHERE con.conrelid = v_game_duties
    AND con.contype = 'f'
    AND con.confrelid = v_duty_types
    AND con.conkey = ARRAY[v_source_attnum]::smallint[]
    AND con.confkey = ARRAY[v_target_attnum]::smallint[];

  IF v_edge_count <> 1
     OR v_constraint.contype <> 'f'
     OR v_constraint.confrelid <> v_duty_types
     OR v_constraint.conkey <> ARRAY[v_source_attnum]::smallint[]
     OR v_constraint.confkey <> ARRAY[v_target_attnum]::smallint[]
     OR NOT v_constraint.convalidated
     OR v_constraint.condeferrable
     OR v_constraint.condeferred
     OR v_constraint.confmatchtype <> 's'
     OR v_constraint.confupdtype <> 'a'
     OR v_constraint.confdeltype NOT IN ('a', 'c') THEN
    RAISE EXCEPTION 'game_duties duty-type FK hardening baseline is incompatible; exact validated nondeferrable single-column CASCADE/NO ACTION contract is required'
      USING ERRCODE = '55000';
  END IF;

  IF v_constraint.confdeltype = 'c' THEN
    ALTER TABLE public.game_duties
      DROP CONSTRAINT game_duties_duty_type_id_fkey,
      ADD CONSTRAINT game_duties_duty_type_id_fkey
        FOREIGN KEY (duty_type_id)
        REFERENCES public.duty_types(id)
        MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
        NOT DEFERRABLE
        INITIALLY IMMEDIATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = v_game_duties
      AND con.conname = 'game_duties_duty_type_id_fkey'
      AND con.contype = 'f'
      AND con.confrelid = v_duty_types
      AND con.conkey = ARRAY[v_source_attnum]::smallint[]
      AND con.confkey = ARRAY[v_target_attnum]::smallint[]
      AND con.convalidated
      AND NOT con.condeferrable
      AND NOT con.condeferred
      AND con.confmatchtype = 's'
      AND con.confupdtype = 'a'
      AND con.confdeltype = 'a'
  ) THEN
    RAISE EXCEPTION 'game_duties duty-type FK hardening postcondition failed'
      USING ERRCODE = '55000';
  END IF;
END;
$game_duties_duty_type_fk_hardening$;

COMMIT;
