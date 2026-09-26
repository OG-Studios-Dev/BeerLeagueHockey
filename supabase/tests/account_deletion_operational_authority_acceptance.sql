-- Rerunnable post-migration acceptance fixture for current/future authority.
-- Apply all repository migrations first. The fixture is fully rolled back.

BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- Never reuse an identity from outside this rollback-only fixture.
DO $fixture_identity$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN ('a11ce000-0000-4000-8000-000000000081', 'a11ce000-0000-4000-8000-000000000091'))
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN ('a11ce000-0000-4000-8000-000000000081', 'a11ce000-0000-4000-8000-000000000091')) THEN
    RAISE EXCEPTION 'Acceptance fixture identity already exists';
  END IF;
END;
$fixture_identity$;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a11ce000-0000-4000-8000-000000000081',
  'authenticated', 'authenticated', 'operational-delete@example.invalid', '',
  now(), now(), now()
), (
  '00000000-0000-0000-0000-000000000000',
  'a11ce000-0000-4000-8000-000000000091',
  'authenticated', 'authenticated', 'operational-owner@example.invalid', '',
  now(), now(), now()
);

INSERT INTO public.profiles (id, email, full_name, jersey_number, position)
VALUES (
  'a11ce000-0000-4000-8000-000000000081',
  'operational-delete@example.invalid',
  'Operational Delete Fixture', 81, 'C'
), (
  'a11ce000-0000-4000-8000-000000000091',
  'operational-owner@example.invalid',
  'Operational Owner Fixture', 91, 'D'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name,
  jersey_number = EXCLUDED.jersey_number, position = EXCLUDED.position;

INSERT INTO public.organizations (id, name, slug, owner_user_id)
VALUES (
  'a11ce000-0000-4000-8000-000000000092',
  'Operational Fixture Organization', 'operational-fixture-organization',
  'a11ce000-0000-4000-8000-000000000091'
);

INSERT INTO public.leagues (id, name, slug)
VALUES ('a11ce000-0000-4000-8000-000000000082', 'Operational Deletion League', 'operational-deletion-league');

INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
VALUES (
  'a11ce000-0000-4000-8000-000000000092',
  'a11ce000-0000-4000-8000-000000000081',
  'admin', 'active', 'a11ce000-0000-4000-8000-000000000091'
);
INSERT INTO public.league_ownerships (league_id, organization_id, user_id, role)
VALUES (
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000092',
  'a11ce000-0000-4000-8000-000000000081', 'admin'
);

INSERT INTO public.seasons (id, league_id, name, start_date, status)
VALUES (
  'a11ce000-0000-4000-8000-000000000083',
  'a11ce000-0000-4000-8000-000000000082',
  'Operational Deletion Season', '2026-01-01', 'active'
);

INSERT INTO public.teams (id, league_id, name, short_name)
VALUES
  ('a11ce000-0000-4000-8000-000000000084', 'a11ce000-0000-4000-8000-000000000082', 'Fixture Home', 'FH'),
  ('a11ce000-0000-4000-8000-000000000085', 'a11ce000-0000-4000-8000-000000000082', 'Fixture Away', 'FA');

INSERT INTO public.games (
  id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status
) VALUES
  (
    'a11ce000-0000-4000-8000-000000000086',
    'a11ce000-0000-4000-8000-000000000082',
    'a11ce000-0000-4000-8000-000000000083',
    'a11ce000-0000-4000-8000-000000000084',
    'a11ce000-0000-4000-8000-000000000085',
    '2026-02-01T20:00:00Z', 'completed'
  ),
  (
    'a11ce000-0000-4000-8000-000000000087',
    'a11ce000-0000-4000-8000-000000000082',
    'a11ce000-0000-4000-8000-000000000083',
    'a11ce000-0000-4000-8000-000000000084',
    'a11ce000-0000-4000-8000-000000000085',
    '2027-02-01T20:00:00Z', 'scheduled'
  );

INSERT INTO public.team_rosters (
  id, player_id, team_id, league_id, season_id, jersey_number, position,
  player_type, status, start_date
) VALUES (
  'a11ce000-0000-4000-8000-000000000088',
  'a11ce000-0000-4000-8000-000000000081',
  'a11ce000-0000-4000-8000-000000000084',
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000083',
  81, 'Forward', 'regular', 'active', '2026-01-01'
);

INSERT INTO public.game_checkins (game_id, team_id, player_id, status, note)
VALUES
  ('a11ce000-0000-4000-8000-000000000086', 'a11ce000-0000-4000-8000-000000000084', 'a11ce000-0000-4000-8000-000000000081', 'confirmed', 'historical note'),
  ('a11ce000-0000-4000-8000-000000000087', 'a11ce000-0000-4000-8000-000000000084', 'a11ce000-0000-4000-8000-000000000081', 'confirmed', 'future note');

INSERT INTO public.player_availability (game_id, team_id, season_id, player_id, status, reason)
VALUES
  ('a11ce000-0000-4000-8000-000000000086', 'a11ce000-0000-4000-8000-000000000084', 'a11ce000-0000-4000-8000-000000000083', 'a11ce000-0000-4000-8000-000000000081', 'available', 'historical reason'),
  ('a11ce000-0000-4000-8000-000000000087', 'a11ce000-0000-4000-8000-000000000084', 'a11ce000-0000-4000-8000-000000000083', 'a11ce000-0000-4000-8000-000000000081', 'available', 'future reason');

INSERT INTO public.sub_invitations (game_id, team_id, invited_by, invited_player_id, status, message)
VALUES
  ('a11ce000-0000-4000-8000-000000000086', 'a11ce000-0000-4000-8000-000000000084', 'a11ce000-0000-4000-8000-000000000081', 'a11ce000-0000-4000-8000-000000000081', 'accepted', 'historical message'),
  ('a11ce000-0000-4000-8000-000000000087', 'a11ce000-0000-4000-8000-000000000084', 'a11ce000-0000-4000-8000-000000000081', 'a11ce000-0000-4000-8000-000000000081', 'accepted', 'future message');

INSERT INTO public.captain_player_invites (
  league_id, season_id, team_id, target_player_id, registration_path, invited_by
) VALUES (
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000083',
  'a11ce000-0000-4000-8000-000000000084',
  'a11ce000-0000-4000-8000-000000000081',
  '/fixture-registration',
  'a11ce000-0000-4000-8000-000000000081'
);

INSERT INTO public.league_spare_pool (league_id, player_id, season_id, active, notes, added_by)
VALUES (
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000081',
  'a11ce000-0000-4000-8000-000000000083',
  TRUE, 'available in future', 'a11ce000-0000-4000-8000-000000000081'
);

INSERT INTO public.drafts (id, league_id, season_id, status, created_by)
VALUES (
  'a11ce000-0000-4000-8000-000000000089',
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000083',
  'active', 'a11ce000-0000-4000-8000-000000000081'
);
INSERT INTO public.draft_pool (draft_id, league_id, player_id, player_name)
VALUES (
  'a11ce000-0000-4000-8000-000000000089',
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000081',
  'Operational Delete Fixture'
);

INSERT INTO public.season_opt_ins (season_id, player_id)
VALUES ('a11ce000-0000-4000-8000-000000000083', 'a11ce000-0000-4000-8000-000000000081');

INSERT INTO public.duty_types (id, team_id, name)
VALUES ('a11ce000-0000-4000-8000-000000000090', 'a11ce000-0000-4000-8000-000000000084', 'Fixture Duty');
INSERT INTO public.game_duties (game_id, team_id, duty_type_id, assigned_player_id, notes)
VALUES (
  'a11ce000-0000-4000-8000-000000000087',
  'a11ce000-0000-4000-8000-000000000084',
  'a11ce000-0000-4000-8000-000000000090',
  'a11ce000-0000-4000-8000-000000000081', 'future duty'
);
INSERT INTO public.duty_rotation_settings (
  team_id, duty_type_id, rotation_enabled, player_order, current_player_index
) VALUES (
  'a11ce000-0000-4000-8000-000000000084',
  'a11ce000-0000-4000-8000-000000000090', TRUE,
  ARRAY['a11ce000-0000-4000-8000-000000000081']::uuid[], 0
);

INSERT INTO public.league_scorekeepers (id, league_id, scorekeeper_id, status, is_active)
VALUES (
  'a11ce000-0000-4000-8000-000000000093',
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000081', 'active', TRUE
);

INSERT INTO public.game_scorekeeper_assignments (
  game_id, league_id, scorekeeper_id, assigned_by, notes
) VALUES (
  'a11ce000-0000-4000-8000-000000000087',
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000081',
  'a11ce000-0000-4000-8000-000000000081', 'future assignment'
);
INSERT INTO public.scorekeeper_swap_requests (game_id, requesting_scorekeeper_id, status, reason)
VALUES (
  'a11ce000-0000-4000-8000-000000000087',
  'a11ce000-0000-4000-8000-000000000093', 'pending', 'future swap'
);

INSERT INTO public.team_invites (team_id, season_id, email, invited_by, status)
VALUES (
  'a11ce000-0000-4000-8000-000000000084',
  'a11ce000-0000-4000-8000-000000000083',
  'operational-delete@example.invalid',
  'a11ce000-0000-4000-8000-000000000081', 'pending'
);

-- A paid registration remains as a minimized financial fact, but it must no
-- longer be selectable as pending/approved/waitlisted participation.
INSERT INTO public.registration_submissions (
  id, league_id, season_id, player_id, registration_type, status,
  amount_paid_cents, team_id, assigned_team_id
) VALUES (
  'a11ce000-0000-4000-8000-000000000094',
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000083',
  'a11ce000-0000-4000-8000-000000000081',
  'individual', 'pending', 5000,
  'a11ce000-0000-4000-8000-000000000084',
  'a11ce000-0000-4000-8000-000000000084'
);

INSERT INTO public.suspensions (
  id, league_id, season_id, team_id, player_id, issued_by, reason,
  start_date, games_remaining, status, severity, suspension_type
) VALUES (
  'a11ce000-0000-4000-8000-000000000095',
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000083',
  'a11ce000-0000-4000-8000-000000000084',
  'a11ce000-0000-4000-8000-000000000081',
  'a11ce000-0000-4000-8000-000000000091',
  'open suspension fixture', '2026-01-01', 2, 'active', 'major', 'games'
);

INSERT INTO public.game_team_lineups (
  game_id, league_id, team_id, status, layout_json, published_by, updated_by
) VALUES (
  'a11ce000-0000-4000-8000-000000000087',
  'a11ce000-0000-4000-8000-000000000082',
  'a11ce000-0000-4000-8000-000000000084',
  'published',
  '{"version":1,"roster":[{"playerId":"a11ce000-0000-4000-8000-000000000081","fullName":"Operational Delete Fixture","avatarUrl":null}],"placedPlayers":[{"playerId":"a11ce000-0000-4000-8000-000000000081","x":50,"y":20}]}'::jsonb,
  'a11ce000-0000-4000-8000-000000000081',
  'a11ce000-0000-4000-8000-000000000081'
);

SELECT public.prepare_account_deletion('a11ce000-0000-4000-8000-000000000081');
SELECT public.mark_account_storage_deleted('a11ce000-0000-4000-8000-000000000081');
SELECT public.execute_account_deletion('a11ce000-0000-4000-8000-000000000081');

DO $acceptance$
DECLARE
  v_user_id uuid := 'a11ce000-0000-4000-8000-000000000081';
  v_future_game uuid := 'a11ce000-0000-4000-8000-000000000087';
  v_operational_rows integer;
BEGIN
  SELECT (
    (SELECT count(*) FROM public.game_checkins WHERE player_id = v_user_id AND game_id = v_future_game)
    + (SELECT count(*) FROM public.player_availability WHERE player_id = v_user_id AND game_id = v_future_game)
    + (SELECT count(*) FROM public.sub_invitations WHERE invited_player_id = v_user_id AND game_id = v_future_game)
    + (SELECT count(*) FROM public.captain_player_invites WHERE target_player_id = v_user_id)
    + (SELECT count(*) FROM public.draft_pool WHERE player_id = v_user_id)
    + (SELECT count(*) FROM public.season_opt_ins WHERE player_id = v_user_id)
    + (SELECT count(*) FROM public.game_duties WHERE assigned_player_id = v_user_id AND game_id = v_future_game)
    + (SELECT count(*) FROM public.game_scorekeeper_assignments WHERE scorekeeper_id = v_user_id AND game_id = v_future_game)
    + (SELECT count(*) FROM public.team_invites WHERE accepted_by = v_user_id OR pg_catalog.lower(email) = 'operational-delete@example.invalid')
    + (SELECT count(*) FROM public.team_rosters
       WHERE player_id = v_user_id AND (status = 'active' OR end_date IS NULL))
    + (SELECT count(*) FROM public.league_spare_pool WHERE player_id = v_user_id AND active)
    + (SELECT count(*) FROM public.game_team_lineups AS gtl
       WHERE gtl.game_id = v_future_game
         AND EXISTS (
           SELECT 1 FROM pg_catalog.jsonb_array_elements(gtl.layout_json -> 'roster') AS entry
           WHERE entry ->> 'playerId' = v_user_id::text
         ))
    + (SELECT count(*) FROM public.duty_rotation_settings
       WHERE player_order @> ARRAY[v_user_id]::uuid[])
    + (SELECT count(*) FROM public.scorekeeper_swap_requests AS ssr
       JOIN public.league_scorekeepers AS ls
         ON ls.id IN (ssr.requesting_scorekeeper_id, ssr.accepting_scorekeeper_id)
       WHERE ls.scorekeeper_id = v_user_id)
    + (SELECT count(*) FROM public.registration_submissions
       WHERE player_id = v_user_id AND status IN ('pending', 'approved', 'waitlisted'))
    + (SELECT count(*) FROM public.suspensions
       WHERE player_id = v_user_id AND COALESCE(status, '') NOT IN ('served', 'denied'))
    + (SELECT count(*) FROM public.organization_members WHERE user_id = v_user_id)
    + (SELECT count(*) FROM public.league_ownerships WHERE user_id = v_user_id)
  )::integer INTO v_operational_rows;

  IF v_operational_rows <> 0 THEN
    RAISE EXCEPTION 'Deleted profile remains selectable in % open/future operations', v_operational_rows;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE player_id = v_user_id
      AND game_id = 'a11ce000-0000-4000-8000-000000000086'
      AND note IS NULL
  ) THEN
    RAISE EXCEPTION 'Completed check-in fact was not retained and minimized';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Auth/profile deletion invariant failed';
  END IF;
END;
$acceptance$;

ROLLBACK;
