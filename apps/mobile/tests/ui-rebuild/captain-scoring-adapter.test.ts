import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL as NodeURL } from 'node:url';
import { compileCommonJs } from './component-harness.ts';
import type * as Adapter from '../../src/lib/supabase/captainScoring';

// Exact PostgreSQL sample 18, producer-samples.json SHA-256
// 5a1a73c61016a53cf3ff87304610692b08ad06d55984249647be523ee1765b00.
// The old illustrative NULL commentary identity was not a producer oracle.
it('decodes actual PostgreSQL commentary conflict bound to the requesting team through one RPC',async()=>{
 const producer={"label":"18-set_commentary-conflict-commentary_version_conflict","rpc":"captain_manage_game_scoring","args":{"p_request":{"kind":"set_commentary","text":"🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","request_id":"ABCDEF00-0000-0000-0000-000000000031","schema_version":1,"expected_version":0}},"response":{"code":"commentary_version_conflict","kind":"set_commentary","game_id":"50000000-0000-4000-8000-000000000007","outcome":"conflict","receipt":null,"team_id":"30000000-0000-4000-8000-000000000001","conflict":{"entity":"commentary","entity_id":"30000000-0000-4000-8000-000000000001","current_version":1},"snapshot":{"game":{"status":"scheduled","timezone":"America/Toronto","away_score":0,"home_score":0,"away_team_id":"30000000-0000-4000-8000-000000000002","home_team_id":"30000000-0000-4000-8000-000000000001","scheduled_at":"2026-10-19T18:59:32.505009-04:00","own_team_type":"home","away_team_name":"Away Team","home_team_name":"Home Team","game_started_at":null,"away_team_logo_url":null,"home_team_logo_url":null},"counts":{"roster":9,"own_goals":0},"roster":[{"state":"waiting","source":"regular","position":"Defense","full_name":"Alternate","player_id":"40000000-0000-4000-8000-000000000002","jersey_number":2,"checkin_status":null,"presence_version":0,"blocking_goal_ids":[],"eligible_for_goal":false,"availability_state":"none","has_credited_stats":false},{"state":"waiting","source":"regular","position":"Forward","full_name":"Captain","player_id":"40000000-0000-4000-8000-000000000001","jersey_number":1,"checkin_status":null,"presence_version":0,"blocking_goal_ids":[],"eligible_for_goal":false,"availability_state":"none","has_credited_stats":false},{"state":"waiting","source":"regular","position":null,"full_name":"Deleting Player","player_id":"40000000-0000-4000-8000-000000000020","jersey_number":20,"checkin_status":null,"presence_version":0,"blocking_goal_ids":[],"eligible_for_goal":false,"availability_state":"none","has_credited_stats":false},{"state":"waiting","source":"regular","position":"Forward","full_name":"Merge Source","player_id":"40000000-0000-4000-8000-000000000021","jersey_number":21,"checkin_status":null,"presence_version":0,"blocking_goal_ids":[],"eligible_for_goal":false,"availability_state":"none","has_credited_stats":false},{"state":"waiting","source":"team_spare","position":"Forward","full_name":"Part Time Player","player_id":"40000000-0000-4000-8000-000000000015","jersey_number":15,"checkin_status":null,"presence_version":0,"blocking_goal_ids":[],"eligible_for_goal":false,"availability_state":"none","has_credited_stats":false},{"state":"waiting","source":"regular","position":"Goalie","full_name":"Regular Goalie","player_id":"40000000-0000-4000-8000-000000000013","jersey_number":13,"checkin_status":null,"presence_version":0,"blocking_goal_ids":[],"eligible_for_goal":false,"availability_state":"none","has_credited_stats":false},{"state":"waiting","source":"regular","position":"Forward","full_name":"Regular One","player_id":"40000000-0000-4000-8000-000000000011","jersey_number":11,"checkin_status":null,"presence_version":0,"blocking_goal_ids":[],"eligible_for_goal":false,"availability_state":"none","has_credited_stats":false},{"state":"waiting","source":"regular","position":"Defense","full_name":"Regular Two","player_id":"40000000-0000-4000-8000-000000000012","jersey_number":12,"checkin_status":null,"presence_version":0,"blocking_goal_ids":[],"eligible_for_goal":false,"availability_state":"none","has_credited_stats":false},{"state":"waiting","source":"team_spare","position":"Forward","full_name":"Sub Player","player_id":"40000000-0000-4000-8000-000000000014","jersey_number":14,"checkin_status":null,"presence_version":0,"blocking_goal_ids":[],"eligible_for_goal":false,"availability_state":"none","has_credited_stats":false}],"complete":true,"revision":"1","own_goals":[],"season_id":"20000000-0000-4000-8000-000000000001","commentary":{"text":"🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒🏒","version":1},"permissions":{"can_comment":true,"can_add_goal":true,"blocked_reason":null,"can_correct_goal":true,"can_manage_roster":true},"server_time":"2026-10-20T18:59:34.908088-04:00"},"league_id":"10000000-0000-4000-8000-000000000001","request_id":"ABCDEF00-0000-0000-0000-000000000031","schema_version":1},"expectedSeasonId":"20000000-0000-4000-8000-000000000001"};
 const req=producer.args.p_request;
 const raw=producer.response;
 const command: Adapter.ScoringCommand={kind:'set_commentary',expected_version:req.expected_version,text:req.text};
 const actualScope={gameId:req.game_id,teamId:req.team_id,leagueId:req.league_id,seasonId:producer.expectedSeasonId};
 const {api,calls}=load(raw);
 assert.deepEqual(api.decodeScoringResponse(raw,req,producer.expectedSeasonId),raw);
 assert.deepEqual(await api.manageScoring(actualScope,req.request_id,command),raw);
 assert.deepEqual(calls,[{name:producer.rpc,args:producer.args}]);
 for(const change of [{entity_id:null},{entity_id:raw.snapshot.game.away_team_id},{current_version:raw.snapshot.commentary.version+1}]){
  const bad=structuredClone(raw);Object.assign(bad.conflict,change);
  assert.throws(()=>api.decodeScoringResponse(bad,req,producer.expectedSeasonId),(e:unknown)=>e instanceof api.CaptainScoringRpcError && e.code==='invalid_response',JSON.stringify(change));
 }
});

type ProducerSample = {label:string;rpc:string;args:{p_request:Record<string,unknown> & {request_id:string;game_id:string;team_id:string;league_id:string}};response:Adapter.ScoringResponse;expectedSeasonId:string;rawWire:string;wireSha256:string};
const readonlyProducer = JSON.parse(readFileSync(new NodeURL('./fixtures/captain-scoring-readonly-producer.json',import.meta.url),'utf8')) as {samples:ProducerSample[]};
it('preserves actual eligible attributed history when game-wide authority forbids correction',async()=>{
 const packets=readonlyProducer.samples.filter(p=>p.label.startsWith('future_game-') || p.label.startsWith('legacy_score_mismatch-'));
 assert.equal(packets.length,4);
 for(const producer of packets){
  const req=producer.args.p_request,raw=producer.response;
  assert.equal(createHash('sha256').update(producer.rawWire).digest('hex'),producer.wireSha256);
  assert.deepEqual(JSON.parse(producer.rawWire),raw);
  const {api,calls}=load(raw);
  assert.deepEqual(api.decodeScoringResponse(raw,req,producer.expectedSeasonId),raw,producer.label);
  const actualScope={gameId:req.game_id,teamId:req.team_id,leagueId:req.league_id,seasonId:producer.expectedSeasonId};
  const result=producer.rpc==='captain_get_game_scoring_context' ? await api.getScoringContext(actualScope,req.request_id) : await api.manageScoring(actualScope,req.request_id,{kind:'set_commentary',expected_version:req.expected_version as number,text:req.text as string});
  assert.deepEqual(result,raw,producer.label);assert.deepEqual(calls,[{name:producer.rpc,args:producer.args}]);
  assert.equal(result.snapshot?.permissions.can_correct_goal,false);
  assert.ok(result.snapshot?.own_goals.every(g=>!g.can_edit && g.blocked_reason===null));
 }
});

it('keeps read-only exceptions closed to malformed authority, credits and scope',()=>{
 const producer=readonlyProducer.samples.find(p=>p.label==='legacy_score_mismatch-attributed-read')!;
 const req=producer.args.p_request,{api}=load(null);
 const mutations: ((r:Adapter.ScoringResponse)=>void)[]=[
  r=>{r.request_id=r.game_id;},r=>{r.team_id=r.snapshot!.game.away_team_id;},r=>{r.snapshot!.season_id=r.game_id;},
  ...(['can_add_goal','can_correct_goal','can_manage_roster','can_comment'] as const).map(key=>(r:Adapter.ScoringResponse)=>{r.snapshot!.permissions[key]=true;}),
  ...([null,'capture_complete','roster_conflict','unknown'] as const).map(reason=>(r:Adapter.ScoringResponse)=>{r.snapshot!.permissions.blocked_reason=reason as Adapter.ScoringSnapshot['permissions']['blocked_reason'];}),
  r=>{r.snapshot!.own_goals[0].can_edit=true;},r=>{r.snapshot!.own_goals[0].scorer_id=null;},
  r=>{r.snapshot!.own_goals[0].blocked_reason='future_game' as Adapter.ScoringGoal['blocked_reason'];},
  r=>{r.snapshot!.own_goals[0].scorer_id='invalid';},r=>{r.snapshot!.own_goals[0].scorer_id=r.game_id;},
  r=>{r.snapshot!.own_goals[0].assist1_id=r.snapshot!.own_goals[0].scorer_id;},
  r=>{const s=r.snapshot!,g=s.own_goals[0];s.roster.find(p=>p.player_id===g.scorer_id)!.blocking_goal_ids=[];},
  r=>{const s=r.snapshot!,g=s.own_goals[0],p=s.roster.find(p=>p.player_id===g.scorer_id)!;Object.assign(p,{checkin_status:'out',state:'credited_not_eligible',eligible_for_goal:false});},
  r=>{const s=r.snapshot!,g=s.own_goals[0],p=s.roster.find(p=>p.player_id===g.scorer_id)!;p.has_credited_stats=false;},
 ];
 for(const mutate of mutations){const bad=structuredClone(producer.response);mutate(bad);assert.throws(()=>api.decodeScoringResponse(bad,req,producer.expectedSeasonId),(e:unknown)=>e instanceof api.CaptainScoringRpcError && e.code==='invalid_response',mutate.toString());}
 // Source-derived only: no real in_progress stats_locked lifecycle packet is claimed.
 const locked=structuredClone(producer.response);locked.snapshot!.permissions.blocked_reason='stats_locked';
 assert.deepEqual(api.decodeScoringResponse(locked,req,producer.expectedSeasonId),locked);
});
it('retains actual normal and capture-complete producer controls including null-scorer precedence',async()=>{
 const packets=readonlyProducer.samples.filter(p=>['normal-attributed-read','capture-complete-attributed-read','capture-complete-null-scorer-read'].includes(p.label));
 assert.equal(packets.length,3);
 for(const producer of packets){
  assert.equal(createHash('sha256').update(producer.rawWire).digest('hex'),producer.wireSha256);
  assert.deepEqual(JSON.parse(producer.rawWire),producer.response);
  if(producer.label==='capture-complete-null-scorer-read'){
   assert.equal(producer.response.snapshot?.permissions.blocked_reason,'capture_complete');
   assert.equal(producer.response.snapshot?.own_goals[0].scorer_id,null);
   assert.equal(producer.response.snapshot?.own_goals[0].blocked_reason,'legacy_unattributed');
  }
  const req=producer.args.p_request,{api,calls}=load(producer.response);
  const actualScope={gameId:req.game_id,teamId:req.team_id,leagueId:req.league_id,seasonId:producer.expectedSeasonId};
  assert.deepEqual(await api.getScoringContext(actualScope,req.request_id),producer.response);
  assert.deepEqual(calls,[{name:producer.rpc,args:producer.args}]);
 }
});

const request = {"schema_version": 1, "request_id": "70000000-0000-0000-0000-000000000001", "game_id": "30000000-0000-0000-0000-000000000001", "team_id": "40000000-0000-0000-0000-000000000001", "league_id": "10000000-0000-0000-0000-000000000001"};
const scope = { gameId: request.game_id, teamId: request.team_id, leagueId: request.league_id, seasonId: '20000000-0000-0000-0000-000000000001' };
const snapshot = () => ({"season_id": "20000000-0000-0000-0000-000000000001", "revision": "3", "server_time": "2026-10-20T23:00:00Z", "complete": true, "game": {"status": "in_progress", "scheduled_at": "2026-10-20T22:00:00Z", "game_started_at": "2026-10-20T22:02:00Z", "own_team_type": "home", "home_team_id": "40000000-0000-0000-0000-000000000001", "away_team_id": "40000000-0000-0000-0000-000000000002", "home_team_name": "Home", "away_team_name": "Away", "home_score": 0, "away_score": 0, "timezone": "America/Toronto", "home_team_logo_url": null, "away_team_logo_url": null}, "permissions": {"can_add_goal": true, "can_correct_goal": true, "can_manage_roster": true, "can_comment": true, "blocked_reason": null}, "own_goals": [], "roster": [], "commentary": {"text": "", "version": 0}, "counts": {"own_goals": 0, "roster": 0}});
const response = () => ({ ...request, kind: 'get_context', outcome: 'ok', code: null, receipt: null, conflict: null, snapshot: snapshot() });
function load(data: unknown, error: unknown = null, thrown?: unknown, status = 200) {
  const calls: {name:string;args:Record<string,unknown>}[] = [];
  const api = compileCommonJs<typeof Adapter>(new URL('../../src/lib/supabase/captainScoring.ts', import.meta.url), {
    './client': { supabase: { rpc: (name:string,args:Record<string,unknown>) => { calls.push({name,args}); return { abortSignal() { return this; }, then(resolve: (v:unknown)=>unknown, reject:(e:unknown)=>unknown) { return thrown ? Promise.reject(thrown).then(resolve,reject) : Promise.resolve({data,error,status}).then(resolve,reject); } }; }, from() { throw Error('No direct fallback'); } } },
    'expo-crypto': { randomUUID: () => request.request_id },
  });
  return { api, calls };
}
it('decodes complete request-bound context through one explicit RPC without trusting route actor or season as wire keys', async () => {
  const {api,calls} = load(response());
  assert.equal(typeof api.getScoringContext, 'function');
  assert.deepEqual(await api.getScoringContext(scope), response());
  assert.deepEqual(calls, [{name:'captain_get_game_scoring_context',args:{p_request:request}}]);
  assert.equal(api.createScoringRequestId(),request.request_id);
  assert.equal(api.createScoringEventId(),request.request_id);
  for (const bad of [{...response(),extra:true},{...response(),request_id:scope.gameId},{...response(),snapshot:{...snapshot(),season_id:scope.gameId}},{...response(),snapshot:{...snapshot(),revision:9007199254740992}},{...response(),snapshot:{...snapshot(),complete:false}},{...response(),snapshot:{...snapshot(),counts:{own_goals:1,roster:0}}}]) assert.throws(()=>api.decodeScoringResponse(bad,request,scope.seasonId));
});

const credited = (): Adapter.ScoringSnapshot => ({"season_id": "20000000-0000-0000-0000-000000000001", "revision": "3", "server_time": "2026-10-20T23:00:00Z", "complete": true, "game": {"status": "in_progress", "scheduled_at": "2026-10-20T22:00:00Z", "game_started_at": "2026-10-20T22:02:00Z", "own_team_type": "home", "home_team_id": "40000000-0000-0000-0000-000000000001", "away_team_id": "40000000-0000-0000-0000-000000000002", "home_team_name": "Home", "away_team_name": "Away", "home_score": 1, "away_score": 2, "timezone": "America/Toronto", "home_team_logo_url": null, "away_team_logo_url": null}, "permissions": {"can_add_goal": true, "can_correct_goal": true, "can_manage_roster": true, "can_comment": true, "blocked_reason": null}, "own_goals": [{"event_id": "60000000-0000-0000-0000-000000000001", "event_version": 1, "team_id": "40000000-0000-0000-0000-000000000001", "scorer_id": "50000000-0000-0000-0000-000000000001", "assist1_id": null, "assist2_id": null, "entered_at": "2026-10-20T23:00:00Z", "can_edit": true, "blocked_reason": null}], "roster": [{"player_id": "50000000-0000-0000-0000-000000000001", "full_name": "Example Player", "jersey_number": 12, "position": "Forward", "source": "regular", "checkin_status": "confirmed", "presence_version": 1, "state": "checked_in", "eligible_for_goal": true, "has_credited_stats": true, "availability_state": "none", "blocking_goal_ids": ["60000000-0000-0000-0000-000000000001"]}, {"player_id": "50000000-0000-0000-0000-000000000002", "full_name": "Example Scratch", "jersey_number": 9, "position": "Defense", "source": "regular", "checkin_status": "out", "presence_version": 2, "state": "scratched", "eligible_for_goal": false, "has_credited_stats": false, "availability_state": "none", "blocking_goal_ids": []}], "commentary": {"text": "", "version": 0}, "counts": {"own_goals": 1, "roster": 2}});

it('rejects internally inconsistent goal/roster/permission projections without truncating factual text', () => {
 const {api}=load(null); const good=()=>({...response(),snapshot:credited()});
 assert.deepEqual(api.decodeScoringResponse(good(),request,scope.seasonId),good());
 const corrupt: ((s:ReturnType<typeof credited>)=>void)[] = [
 s=>{s.game.home_team_id=scope.gameId;},s=>{s.game.away_team_id=s.game.home_team_id;},
 s=>{s.own_goals[0].team_id=s.game.away_team_id;},s=>{s.own_goals[0].scorer_id=scope.gameId;},
 s=>{s.own_goals[0].assist1_id=s.own_goals[0].scorer_id;},
 s=>{s.own_goals[0].assist2_id=s.roster[1].player_id;},
 s=>{s.roster[0].blocking_goal_ids=[];},s=>{s.roster[1].blocking_goal_ids=[s.own_goals[0].event_id];},
 s=>{s.roster[0].has_credited_stats=false;},s=>{s.roster[0].checkin_status='out';},
 s=>{s.roster[0].availability_state='unknown';},s=>{s.permissions.can_correct_goal=false;},
 s=>{s.game.timezone='';},s=>{s.game.timezone='Not/AZone';},s=>{s.commentary.text='\u0000';},
 s=>{s.roster[0].full_name='😀'.repeat(161);},s=>{s.revision='9223372036854775808';},
 s=>{s.roster.push({...s.roster[0]});s.counts.roster++;},
 s=>{s.own_goals.push({...s.own_goals[0]});s.counts.own_goals++;s.game.home_score++;},
 ];
 for (const mutate of corrupt) {const raw=good();mutate(raw.snapshot);assert.throws(()=>api.decodeScoringResponse(raw,request,scope.seasonId),mutate.toString());}
 const text='  Zoë\r\n e\u0301 😀  ';const raw=good();raw.snapshot.commentary.text=text;raw.snapshot.roster[0].full_name=text;
 assert.equal(api.decodeScoringResponse(raw,request,scope.seasonId).snapshot?.commentary.text,text);
});


it('preserves honest unavailable confirmed uncredited roster facts through one context RPC',async()=>{
 for(const availability of ['unknown','out','conflict'] as const){
  const snap=credited();const player=snap.roster[1];
  Object.assign(player,{checkin_status:'confirmed',availability_state:availability,state:'unavailable'});
  const raw={...response(),snapshot:snap};const run=load(raw);
  assert.deepEqual(await run.api.getScoringContext(scope),raw);
  assert.equal(run.calls.length,1);assert.equal(player.checkin_status,'confirmed');assert.equal(player.has_credited_stats,false);assert.deepEqual(player.blocking_goal_ids,[]);
  const {api}=run;
  for(const change of [{availability_state:'none'},{availability_state:'in'},{checkin_status:'out'},{checkin_status:'tentative'},{checkin_status:null},{eligible_for_goal:true},{has_credited_stats:true},{source:'credited_only'}]){
   const bad=structuredClone(raw);Object.assign(bad.snapshot.roster[1],change);assert.throws(()=>api.decodeScoringResponse(bad,request,scope.seasonId),JSON.stringify(change));
  }
  for(const state of ['checked_in','scratched','tentative','waiting','credited_not_eligible']){
   const bad=structuredClone(raw);Object.assign(bad.snapshot.roster[1],{state});assert.throws(()=>api.decodeScoringResponse(bad,request,scope.seasonId),state);
  }
 }
 const raw={...response(),snapshot:credited()};const p=raw.snapshot.roster[0];
 Object.assign(p,{checkin_status:'out',availability_state:'out',eligible_for_goal:false,state:'credited_not_eligible'});
 Object.assign(raw.snapshot.own_goals[0],{can_edit:false,blocked_reason:'not_checked_in'});
 const {api}=load(null);assert.deepEqual(api.decodeScoringResponse(raw,request,scope.seasonId),raw);
 for(const state of ['scratched','unavailable']){const bad=structuredClone(raw);Object.assign(bad.snapshot.roster[0],{state});assert.throws(()=>api.decodeScoringResponse(bad,request,scope.seasonId),state);}
 const fabricated=structuredClone(raw);Object.assign(fabricated.snapshot.roster[1],{source:'credited_only'});assert.throws(()=>api.decodeScoringResponse(fabricated,request,scope.seasonId));
});

// Contract examples and adversarial synthetic bodies, NOT claimed SQL producer fixtures.
const eventId='60000000-0000-0000-0000-000000000001';
const scorer='50000000-0000-0000-0000-000000000001';
const add: Adapter.ScoringCommand={kind:'add_goal',event_id:eventId,expected_version:null,scorer_id:scorer,assist1_id:null,assist2_id:null};
const applied=()=>({...request,kind:'add_goal',outcome:'applied',code:null,conflict:null,snapshot:credited(),receipt:{applied_revision:'3',event_id:eventId,event_version:1,player_id:null,presence_version:null,commentary_version:null,transitioned_to_in_progress:false}});
it('sends one immutable command and keeps uncertain outcomes distinct from definite SQL rejection', async()=>{
 const good=load(applied());assert.equal(typeof good.api.manageScoring,'function');
 assert.deepEqual(await good.api.manageScoring(scope,request.request_id,add),applied());
 assert.deepEqual(good.calls,[{name:'captain_manage_game_scoring',args:{p_request:{...request,...add}}}]);
 assert.equal(add.expected_version,null);
 for(const [error,thrown,status,kind] of [[{code:'42501'},null,403,'rejected'],[{code:'22023'},null,400,'rejected'],[{code:'28000'},null,401,'rejected'],[{code:'PGRST202'},null,404,'backend_update_required'],[{code:'42883'},null,404,'backend_update_required'],[{code:'42501'},null,503,'unknown'],[{code:'40001'},null,500,'unknown'],[null,{code:'42501'},200,'unknown'],[null,null,200,'unknown']] as const){
   const run=load({broken:true},error,thrown,status);await assert.rejects(run.api.manageScoring(scope,request.request_id,add),(e:unknown)=>e instanceof run.api.CaptainScoringRpcError && e.kind===kind);assert.equal(run.calls.length,1);
 }
 const invalid=load(applied());await assert.rejects(invalid.api.manageScoring(scope,request.request_id,{...add,assist1_id:scorer}));assert.equal(invalid.calls.length,0);
 for(const c of [{...add,extra:1},{...add,event_id:' '+eventId},{...add,expected_version:0},{kind:'set_commentary',expected_version:0,text:'😀'.repeat(2001)}]) {await assert.rejects(invalid.api.manageScoring(scope,request.request_id,c as Adapter.ScoringCommand));assert.equal(invalid.calls.length,0);}
});
it('binds receipts to command semantics but permits a historical replay after the current event was removed',()=>{
 const {api}=load(null);const req={...request,...add};const replay={...applied(),outcome:'replayed',snapshot:snapshot()};
 assert.deepEqual(api.decodeScoringResponse(replay,req,scope.seasonId),replay);
 for(const raw of [{...applied(),outcome:'ok'},{...applied(),receipt:null},{...applied(),receipt:{...applied().receipt,event_id:scorer}},{...applied(),receipt:{...applied().receipt,event_version:2}},{...applied(),receipt:{...applied().receipt,player_id:scorer}},{...applied(),code:'invalid_request'},{...applied(),snapshot:null},{...applied(),receipt:{...applied().receipt,applied_revision:'4'}}])assert.throws(()=>api.decodeScoringResponse(raw,req,scope.seasonId));
 const conflict={...response(),kind:'update_goal',outcome:'conflict',code:'event_version_conflict',snapshot:credited(),conflict:{entity:'event',entity_id:eventId,current_version:1}};
 const update={...request,...add,kind:'update_goal',expected_version:2};assert.deepEqual(api.decodeScoringResponse(conflict,update,scope.seasonId),conflict);
 assert.throws(()=>api.decodeScoringResponse({...conflict,conflict:{...conflict.conflict,current_version:5}},update,scope.seasonId));
 assert.throws(()=>api.decodeScoringResponse({...conflict,outcome:'rejected'},update,scope.seasonId));
});

it('uses lossless full-name tile ordering and canonical exclusions with no fabricated people',()=>{
 const model=compileCommonJs<typeof import('../../src/lib/captain/scoringModel')>(new URL('../../src/lib/captain/scoringModel.ts',import.meta.url),{});
 const s=credited(); const base=s.roster[0];
 const players: Adapter.ScoringRosterPlayer[]=[{...base,player_id:'ABCDEF00-0000-0000-0000-000000000001',full_name:'Zed Adams'}, {...base,player_id:'abcdef00-0000-0000-0000-000000000002',full_name:' Amy Zed '}, {...base,player_id:'abcdef00-0000-0000-0000-000000000003',full_name:'Amy Zed'}, {...base,player_id:'abcdef00-0000-0000-0000-000000000004',full_name:null}, {...base,eligible_for_goal:false}];
 const snap={...s,roster:players} as Adapter.ScoringSnapshot;
 assert.equal(model.scoringPlayerName(players[1]),' Amy Zed ');assert.equal(model.scoringPlayerName(players[3]),'Unnamed player');
 assert.equal(model.sameScoringIdentity(players[0].player_id,players[0].player_id.toLowerCase()),true);
 assert.equal(model.sameScoringIdentity('invalid','INVALID'),false);
 const result=model.eligibleScoringPlayers(snap,[players[0].player_id.toLowerCase()]);assert.equal(result.length,3);assert.equal(result[0].player_id,players[1].player_id);assert.equal(result[1].player_id,players[2].player_id);assert.equal(result[2].player_id,players[3].player_id);
 assert.equal(snap.roster,players);
});

it('recognizes missing read authority and accepts complete Unicode, legacy-null and uppercase identity without coercion',async()=>{
 const missing=load(null,{code:'PGRST202'},undefined,404);await assert.rejects(missing.api.getScoringContext(scope),(e:unknown)=>e instanceof missing.api.CaptainScoringRpcError && e.kind==='backend_update_required');
 const {api}=load(null);const upper={...request,request_id:'ABCDEF00-0000-0000-0000-000000000001',team_id:scope.teamId.toUpperCase()};
 const raw={...response(),...upper,snapshot:credited()};raw.snapshot.revision='9223372036854775807';raw.snapshot.own_goals[0].scorer_id=null;raw.snapshot.own_goals[0].can_edit=false;raw.snapshot.own_goals[0].blocked_reason='legacy_unattributed';raw.snapshot.roster[0].blocking_goal_ids=[];
 assert.deepEqual(api.decodeScoringResponse(raw,upper,scope.seasonId),raw);
 const invalids=[{...raw,team_id:raw.team_id.toLowerCase()},{...raw,snapshot:{...raw.snapshot,commentary:{text:'x'.repeat(2001),version:0}}},{...raw,snapshot:{...raw.snapshot,commentary:{text:'\ud800',version:0}}}];
 // Echoes preserve request bytes (a digit-only ID has no case difference).
 for(const bad of invalids.slice(1))assert.throws(()=>api.decodeScoringResponse(bad,upper,scope.seasonId));
});

it('checks fresh applied command effects while treating replay receipts only as historical acknowledgements',()=>{
 const {api}=load(null);const req={...request,...add};const raw=applied();
 assert.throws(()=>api.decodeScoringResponse({...raw,snapshot:snapshot()},req,scope.seasonId));
 const changed=applied();changed.snapshot.own_goals[0].event_version=2;assert.throws(()=>api.decodeScoringResponse(changed,req,scope.seasonId));
 const clear={...request,kind:'set_commentary',expected_version:0,text:'  exact\r\n'};
 const receipt={applied_revision:'3',event_id:null,event_version:null,player_id:null,presence_version:null,commentary_version:1,transitioned_to_in_progress:false};
 const note={...response(),kind:'set_commentary',outcome:'applied',receipt,snapshot:{...snapshot(),commentary:{text:clear.text,version:1}}};
 assert.deepEqual(api.decodeScoringResponse(note,clear,scope.seasonId),note);assert.throws(()=>api.decodeScoringResponse({...note,snapshot:snapshot()},clear,scope.seasonId));
 for(const kind of ['scratch','reinstate'] as const){const snap=credited();const player=snap.roster[1];if(kind==='reinstate'){player.state='checked_in';player.checkin_status='confirmed';player.eligible_for_goal=true;}
  const cmd={...request,kind,player_id:player.player_id,expected_version:player.presence_version};const result={...response(),kind,outcome:'applied',snapshot:snap,receipt:{...receipt,commentary_version:null,player_id:player.player_id,presence_version:player.presence_version}};
  assert.deepEqual(api.decodeScoringResponse(result,cmd,scope.seasonId),result);assert.throws(()=>api.decodeScoringResponse({...result,receipt:{...result.receipt,presence_version:player.presence_version+1}},cmd,scope.seasonId));
 }
 const update={...request,...add,kind:'update_goal',expected_version:1};const updated=applied();updated.kind='update_goal';updated.receipt.event_version=2;updated.snapshot.own_goals[0].event_version=2;assert.deepEqual(api.decodeScoringResponse(updated,update,scope.seasonId),updated);
 const remove={...request,kind:'remove_goal',event_id:eventId,expected_version:1};const removed={...applied(),kind:'remove_goal',snapshot:snapshot(),receipt:{...applied().receipt,event_version:2}};assert.deepEqual(api.decodeScoringResponse(removed,remove,scope.seasonId),removed);
});

it('fails response bytes closed before expensive nested shape traversal',()=>{
 const {api}=load(null);const raw={...response(),padding:'x'.repeat(1048576)};
 Object.defineProperty(raw,'snapshot',{get(){throw Error('oversized payload must fail before traversing snapshot');},enumerable:false});
 assert.throws(()=>api.decodeScoringResponse(raw,request,scope.seasonId),(e:unknown)=>e instanceof api.CaptainScoringRpcError && e.code==='invalid_response');
});

it('rejects each missing/extra required object key and preserves nullable legacy metadata',()=>{
 const {api}=load(null);const roots=[[] as string[],['snapshot'],['snapshot','game'],['snapshot','permissions'],['snapshot','commentary'],['snapshot','counts'],['snapshot','own_goals','0'],['snapshot','roster','0']];
 for(const path of roots){const base={...response(),snapshot:credited()};let target:unknown=base;for(const part of path)target=(target as Record<string,unknown>)[part];
  for(const key of Object.keys(target as object)){const raw=structuredClone(base);let node:unknown=raw;for(const part of path)node=(node as Record<string,unknown>)[part];delete (node as Record<string,unknown>)[key];assert.throws(()=>api.decodeScoringResponse(raw,request,scope.seasonId),path.join('.')+'.'+key);}
  (target as Record<string,unknown>).unfrozen_key=true;assert.throws(()=>api.decodeScoringResponse(base,request,scope.seasonId));
 }
});
