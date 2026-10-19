import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import {
  getMobileProfileGameLog,
  getMobileProfileSelectedSeasonPlayer,
  getMobileProfileTimeline,
  MOBILE_PROFILE_RPC_NAME,
  readMobileProfilePhaseFacts,
} from '@/lib/mobile-profile-rpc-bundles';
import { createClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/strict-service-role', () => ({
  createStrictServiceRoleClient: jest.fn(),
}));

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockedCreateStrictServiceRoleClient = jest.requireMock('@/lib/supabase/strict-service-role')
  .createStrictServiceRoleClient as jest.Mock;
const LEAGUE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const PLAYER_ID = 'bdd94b26-b344-459f-9727-8cddae9783df';
const SEASON_ID = '20000000-0000-4000-8000-000000000002';
const TEAM_ID = '70000000-0000-4000-8000-000000000007';
const OTHER_TEAM_ID = '71000000-0000-4000-8000-000000000007';
const GAME_ID = '80000000-0000-4000-8000-000000000001';

const commonFacts = () => ({
  seasons: [{ id: SEASON_ID, league_id: LEAGUE_ID, name: 'Fall 2026', start_date: '2026-09-01' }],
  games: [{
    id: GAME_ID,
    league_id: LEAGUE_ID,
    season_id: SEASON_ID,
    status: 'completed',
    home_team_id: TEAM_ID,
    away_team_id: OTHER_TEAM_ID,
    home_score: 2,
    away_score: 1,
    scheduled_at: '2026-09-20T20:00:00Z',
    location: 'Arena',
    penalty_capture_status: null,
    goalie_capture_status: null,
    skater_capture_status: null,
  }],
  teams: [
    { id: TEAM_ID, league_id: LEAGUE_ID, division_id: null, name: 'Home', slug: 'home' },
    { id: OTHER_TEAM_ID, league_id: LEAGUE_ID, division_id: null, name: 'Away', slug: 'away' },
  ],
  profiles: [{ id: PLAYER_ID, full_name: 'Fixture Player', avatar_url: null, photo_url: null }],
  rosters: [],
  checkins: [],
  availabilities: [],
  acceptedSubs: [],
  playerStats: [],
  goalieStats: [],
  goalieAppearances: [],
  baselines: [],
  teamPlayerSignals: [],
  teamGoalieSignals: [],
});

function envelope(
  phase: 'selected_stats' | 'timeline' | 'game_log' = 'timeline',
  facts: Record<string, unknown[]> = commonFacts(),
) {
  const phaseFacts = phase === 'selected_stats'
    ? Object.fromEntries(Object.entries(facts).filter(([name]) => ![
        'seasons', 'baselines', 'teamPlayerSignals', 'teamGoalieSignals',
      ].includes(name)))
    : facts;
  const sourceCounts = Object.fromEntries(Object.entries(phaseFacts).map(([name, rows]) => [name, rows.length]));
  return {
    schema_version: 'mobile_profile_phase_facts_v1',
    phase,
    scope: { league_id: LEAGUE_ID, player_id: PLAYER_ID, season_id: phase === 'timeline' ? null : SEASON_ID },
    limits: { source_cap: 5000, total_cap: 5000 },
    counts: {
      ...sourceCounts,
      total: Object.values(sourceCounts).reduce((total, count) => total + count, 0),
    },
    facts: phaseFacts,
  };
}

function mockRpcResult(data: unknown, error: unknown = null) {
  const rpc = jest.fn().mockResolvedValue({ data, error });
  mockedCreateStrictServiceRoleClient.mockReturnValue({ rpc });
  return rpc;
}

describe('mobile profile RPC bundle boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses one versioned RPC with exact arguments for each ordered phase contract', async () => {
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: envelope('selected_stats'), error: null })
      .mockResolvedValueOnce({ data: envelope('timeline'), error: null })
      .mockResolvedValueOnce({ data: envelope('game_log'), error: null });
    mockedCreateStrictServiceRoleClient.mockReturnValue({ rpc });

    await readMobileProfilePhaseFacts('selected_stats', LEAGUE_ID, PLAYER_ID, SEASON_ID);
    await readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null);
    await readMobileProfilePhaseFacts('game_log', LEAGUE_ID, PLAYER_ID, SEASON_ID);

    expect(rpc.mock.calls).toEqual([
      [MOBILE_PROFILE_RPC_NAME, { p_phase: 'selected_stats', p_league_id: LEAGUE_ID, p_player_id: PLAYER_ID, p_season_id: SEASON_ID }],
      [MOBILE_PROFILE_RPC_NAME, { p_phase: 'timeline', p_league_id: LEAGUE_ID, p_player_id: PLAYER_ID, p_season_id: null }],
      [MOBILE_PROFILE_RPC_NAME, { p_phase: 'game_log', p_league_id: LEAGUE_ID, p_player_id: PLAYER_ID, p_season_id: SEASON_ID }],
    ]);
    expect(mockedCreateStrictServiceRoleClient).toHaveBeenCalledTimes(3);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it.each([
    ['schema version', (value: ReturnType<typeof envelope>) => { value.schema_version = 'mobile_profile_phase_facts_v2'; }],
    ['phase', (value: ReturnType<typeof envelope>) => { value.phase = 'game_log'; }],
    ['scope', (value: ReturnType<typeof envelope>) => { value.scope.player_id = '10000000-0000-4000-8000-000000000001'; }],
    ['count', (value: ReturnType<typeof envelope>) => { value.counts.games = 99; }],
    ['cap metadata', (value: ReturnType<typeof envelope>) => { value.limits.total_cap = 5001; }],
  ])('rejects deterministic malformed %s metadata', async (_label, mutate) => {
    const value = envelope();
    mutate(value);
    mockRpcResult(value);
    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null))
      .rejects.toThrow(/mobile profile RPC/);
  });

  it.each([
    ['nil', '00000000-0000-0000-0000-000000000000'],
    ['version 1', '01890f47-789a-1bcd-8def-0123456789ab'],
    ['version 7', '01890f47-789a-7bcd-8def-0123456789ab'],
    ['unassigned version nibble', '01890f47-789a-fbcd-fdef-0123456789ab'],
    ['uppercase canonical form', '01890F47-789A-7BCD-8DEF-0123456789AB'],
  ])('accepts canonical PostgreSQL UUID text: %s', async (_label, playerId) => {
    const facts = commonFacts();
    for (const source of Object.keys(facts) as Array<keyof typeof facts>) facts[source] = [];
    facts.profiles = [{ id: playerId, full_name: 'Fixture Player', avatar_url: null, photo_url: null }];
    const value = envelope('timeline', facts);
    value.scope.player_id = playerId;
    mockRpcResult(value);

    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, playerId, null))
      .resolves.toBeDefined();
  });

  it.each([
    ['leading whitespace', ` ${PLAYER_ID}`],
    ['trailing whitespace', `${PLAYER_ID} `],
    ['braced input', `{${PLAYER_ID}}`],
    ['hyphenless input', PLAYER_ID.replaceAll('-', '')],
    ['invalid hexadecimal', 'gdd94b26-b344-459f-9727-8cddae9783df'],
    ['noncanonical group width', 'bdd94b26-b344-459f-9727-8cddae9783d'],
  ])('rejects noncanonical PostgreSQL UUID text: %s', async (_label, playerId) => {
    const facts = commonFacts();
    for (const source of Object.keys(facts) as Array<keyof typeof facts>) facts[source] = [];
    facts.profiles = [{ id: playerId, full_name: 'Fixture Player', avatar_url: null, photo_url: null }];
    const value = envelope('timeline', facts);
    value.scope.player_id = playerId;
    mockRpcResult(value);

    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, playerId, null))
      .rejects.toThrow(/must be a UUID/);
  });

  it('rejects a source over the 5,000-row cap before accepting the facts', async () => {
    const value = envelope();
    value.facts.profiles = Array.from({ length: 5001 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
      full_name: 'Oversize',
      avatar_url: null,
      photo_url: null,
    }));
    value.counts.profiles = 5001;
    value.counts.total = Object.values(value.facts).reduce((total, rows) => total + rows.length, 0);
    mockRpcResult(value);

    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null))
      .rejects.toThrow('source row limit exceeded');
  });

  it('rejects a cumulative bundle over the 5,000-row cap even when each source is under its cap', async () => {
    const value = envelope();
    value.facts.games = Array.from({ length: 2501 }, () => ({}));
    value.facts.teams = Array.from({ length: 2500 }, () => ({}));
    value.counts.games = 2501;
    value.counts.teams = 2500;
    value.counts.total = Object.values(value.facts).reduce((total, rows) => total + rows.length, 0);
    mockRpcResult(value);

    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null))
      .rejects.toThrow('total row limit exceeded');
  });

  it('rejects a serialized bundle over the byte cap before accepting its rows', async () => {
    const value = envelope();
    value.facts.profiles[0].full_name = 'x'.repeat(8 * 1024 * 1024);
    mockRpcResult(value);

    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null))
      .rejects.toThrow('bundle byte limit exceeded');
  });

  it('rejects malformed fact fields and duplicate source identities', async () => {
    const malformed = envelope();
    malformed.facts.games[0].home_score = '2';
    mockRpcResult(malformed);
    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null))
      .rejects.toThrow('game.home_score must be a finite number');

    const duplicate = envelope();
    duplicate.facts.games.push({ ...duplicate.facts.games[0] });
    duplicate.counts.games = duplicate.facts.games.length;
    duplicate.counts.total += 1;
    mockRpcResult(duplicate);
    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null))
      .rejects.toThrow('duplicate game id');
  });

  it.each([
    ['league', (facts: ReturnType<typeof commonFacts>) => { facts.teams[0].league_id = '10000000-0000-4000-8000-000000000001'; }],
    ['season', (facts: ReturnType<typeof commonFacts>) => { facts.games[0].season_id = '10000000-0000-4000-8000-000000000001'; }],
    ['player', (facts: ReturnType<typeof commonFacts>) => {
      facts.rosters.push({
        id: '10000000-0000-4000-8000-000000000001', player_id: '10000000-0000-4000-8000-000000000001',
        team_id: TEAM_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: '2026-09-01', end_date: null,
        is_goalie: false, position: 'C', status: 'active', player_type: 'regular', historical_retained: false,
        games_played_override: null,
      });
    }],
  ])('rejects a cross-scope %s composite', async (_label, mutate) => {
    const facts = commonFacts();
    mutate(facts);
    mockRpcResult(envelope('timeline', facts));
    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null))
      .rejects.toThrow(/mobile profile RPC/);
  });

  it('rejects exact game/team/player composite conflicts', async () => {
    const facts = commonFacts();
    facts.checkins = [{
      id: '90000000-0000-4000-8000-000000000001',
      game_id: GAME_ID,
      player_id: PLAYER_ID,
      team_id: '72000000-0000-4000-8000-000000000007',
      status: 'confirmed',
    }];
    mockRpcResult(envelope('timeline', facts));

    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null))
      .rejects.toThrow('game/team composite mismatch');
  });

  it.each([
    ['checkin', (facts: ReturnType<typeof commonFacts>) => {
      facts.checkins.push({
        id: '90000000-0000-4000-8000-000000000011', game_id: GAME_ID,
        player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, status: 'confirmed',
      });
    }],
    ['availability', (facts: ReturnType<typeof commonFacts>) => {
      facts.availabilities.push({
        id: '91000000-0000-4000-8000-000000000011', game_id: GAME_ID,
        player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, season_id: SEASON_ID, status: 'out',
      });
    }],
    ['player stat', (facts: ReturnType<typeof commonFacts>) => {
      facts.playerStats.push({
        id: 'a0000000-0000-4000-8000-000000000011', game_id: GAME_ID,
        player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, league_id: LEAGUE_ID,
        season_id: SEASON_ID, goals: 1, assists: 0, penalty_minutes: 0,
        scorekeeping_provenance: 'event_derived', created_at: '2026-09-20T21:00:00Z',
      });
    }],
    ['goalie stat', (facts: ReturnType<typeof commonFacts>) => {
      facts.goalieStats.push({
        id: 'b0000000-0000-4000-8000-000000000011', game_id: GAME_ID,
        player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, league_id: LEAGUE_ID,
        season_id: SEASON_ID, game_result: 'W', saves: 20, shots_against: 21,
        goals_against: 1, shutout: false, scorekeeping_provenance: 'event_derived',
      });
    }],
    ['goalie appearance', (facts: ReturnType<typeof commonFacts>) => {
      facts.goalieAppearances.push({
        game_id: GAME_ID, player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, team_type: 'away',
      });
    }],
  ])('rejects an opposing participating-team %s without an exact player relationship', async (_label, addForgedRow) => {
    const facts = commonFacts();
    facts.rosters.push({
      id: '10000000-0000-4000-8000-000000000011', player_id: PLAYER_ID,
      team_id: TEAM_ID, league_id: LEAGUE_ID, season_id: SEASON_ID,
      start_date: '2026-09-01', end_date: null, is_goalie: true, position: 'G',
      status: 'active', player_type: 'regular', historical_retained: false,
      games_played_override: null,
    });
    facts.rosters.push(
      {
        ...facts.rosters[0], id: '10000000-0000-4000-8000-000000000012',
        team_id: OTHER_TEAM_ID, status: 'inactive',
      },
      {
        ...facts.rosters[0], id: '10000000-0000-4000-8000-000000000013',
        team_id: OTHER_TEAM_ID, player_type: 'part_time',
      },
      {
        ...facts.rosters[0], id: '10000000-0000-4000-8000-000000000014',
        team_id: OTHER_TEAM_ID, start_date: '2026-10-01',
      },
    );
    addForgedRow(facts);
    mockRpcResult(envelope('selected_stats', facts));

    await expect(readMobileProfilePhaseFacts('selected_stats', LEAGUE_ID, PLAYER_ID, SEASON_ID))
      .rejects.toThrow(/player\/team authorization/);
  });

  it.each([
    ['checkin', (facts: ReturnType<typeof commonFacts>) => {
      facts.checkins.push({
        id: '90000000-0000-4000-8000-000000000019', game_id: GAME_ID,
        player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, status: 'confirmed',
      });
    }],
    ['availability', (facts: ReturnType<typeof commonFacts>) => {
      facts.availabilities.push({
        id: '91000000-0000-4000-8000-000000000019', game_id: GAME_ID,
        player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, season_id: SEASON_ID, status: 'out',
      });
    }],
    ['player stat', (facts: ReturnType<typeof commonFacts>) => {
      facts.playerStats.push({
        id: 'a0000000-0000-4000-8000-000000000019', game_id: GAME_ID,
        player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, league_id: LEAGUE_ID,
        season_id: SEASON_ID, goals: 1, assists: 0, penalty_minutes: 0,
        scorekeeping_provenance: 'event_derived', created_at: '2026-09-20T21:00:00Z',
      });
    }],
    ['goalie stat', (facts: ReturnType<typeof commonFacts>) => {
      facts.goalieStats.push({
        id: 'b0000000-0000-4000-8000-000000000019', game_id: GAME_ID,
        player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, league_id: LEAGUE_ID,
        season_id: SEASON_ID, game_result: 'W', saves: 20, shots_against: 21,
        goals_against: 1, shutout: false, scorekeeping_provenance: 'event_derived',
      });
    }],
    ['goalie appearance', (facts: ReturnType<typeof commonFacts>) => {
      facts.goalieAppearances.push({
        game_id: GAME_ID, player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, team_type: 'away',
      });
    }],
  ])('accepts exact accepted-sub authorization for a participating-team %s', async (_label, addAuthorizedRow) => {
    const facts = commonFacts();
    facts.acceptedSubs.push({
      id: '92000000-0000-4000-8000-000000000019', game_id: GAME_ID,
      invited_player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, status: 'accepted',
    });
    addAuthorizedRow(facts);
    mockRpcResult(envelope('selected_stats', facts));

    await expect(readMobileProfilePhaseFacts('selected_stats', LEAGUE_ID, PLAYER_ID, SEASON_ID))
      .resolves.toBeDefined();
  });

  it('rejects duplicate and conflicting goalie identity rows', async () => {
    const facts = commonFacts();
    facts.rosters = [{
      id: '10000000-0000-4000-8000-000000000021', player_id: PLAYER_ID,
      team_id: TEAM_ID, league_id: LEAGUE_ID, season_id: SEASON_ID,
      start_date: '2026-09-01', end_date: null, is_goalie: true, position: 'G',
      status: 'active', player_type: 'regular', historical_retained: false,
      games_played_override: null,
    }];
    facts.acceptedSubs = [{
      id: '92000000-0000-4000-8000-000000000021', game_id: GAME_ID,
      invited_player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, status: 'accepted',
    }];
    facts.goalieAppearances = [
      { game_id: GAME_ID, player_id: PLAYER_ID, team_id: TEAM_ID, team_type: 'home' },
      { game_id: GAME_ID, player_id: PLAYER_ID, team_id: OTHER_TEAM_ID, team_type: 'away' },
    ];
    mockRpcResult(envelope('timeline', facts));

    await expect(readMobileProfilePhaseFacts('timeline', LEAGUE_ID, PLAYER_ID, null))
      .rejects.toThrow('duplicate goalie appearance composite');
  });

  it('retains other selected-season goalie identities so canonical conflict handling stays fail-closed', async () => {
    const facts = commonFacts();
    const otherPlayerId = '10000000-0000-4000-8000-000000000001';
    facts.games[0].goalie_capture_status = 'complete';
    const goalieRoster = (id: string, playerId: string) => ({
      id, player_id: playerId, team_id: TEAM_ID, league_id: LEAGUE_ID, season_id: SEASON_ID,
      start_date: '2026-09-01', end_date: null, is_goalie: true, position: 'G', status: 'active',
      player_type: 'regular', historical_retained: false, games_played_override: null,
    });
    facts.rosters = [
      goalieRoster('10000000-0000-4000-8000-000000000031', PLAYER_ID),
      goalieRoster('10000000-0000-4000-8000-000000000032', otherPlayerId),
    ];
    facts.goalieStats = [
      {
        id: 'b0000000-0000-4000-8000-000000000001', game_id: GAME_ID, player_id: PLAYER_ID,
        team_id: TEAM_ID, league_id: LEAGUE_ID, season_id: SEASON_ID,
        game_result: 'W', saves: 20, shots_against: 21, goals_against: 1, shutout: false,
        scorekeeping_provenance: 'event_derived',
      },
      {
        id: 'b0000000-0000-4000-8000-000000000002', game_id: GAME_ID, player_id: otherPlayerId,
        team_id: TEAM_ID, league_id: LEAGUE_ID, season_id: SEASON_ID,
        game_result: 'W', saves: 20, shots_against: 21, goals_against: 1, shutout: false,
        scorekeeping_provenance: 'event_derived',
      },
    ];
    facts.goalieAppearances = [
      { game_id: GAME_ID, player_id: PLAYER_ID, team_id: TEAM_ID, team_type: 'home' },
    ];
    mockRpcResult(envelope('selected_stats', facts));

    const player = await getMobileProfileSelectedSeasonPlayer(LEAGUE_ID, SEASON_ID, PLAYER_ID);
    expect(player?.goalie?.gamesPlayed).toMatchObject({ value: null, state: 'conflicted' });
    expect(player?.goalie?.goalsAgainst).toMatchObject({ value: null, state: 'conflicted' });
  });

  it('rejects unrelated cross-player evidence from a selected bundle', async () => {
    const facts = commonFacts();
    facts.rosters.push({
      id: '10000000-0000-4000-8000-000000000004',
      player_id: '10000000-0000-4000-8000-000000000005',
      team_id: TEAM_ID,
      league_id: LEAGUE_ID,
      season_id: SEASON_ID,
      start_date: '2026-09-01',
      end_date: null,
      is_goalie: false,
      position: 'F',
      status: 'active',
      player_type: 'regular',
      historical_retained: false,
      games_played_override: null,
    });
    mockRpcResult(envelope('selected_stats', facts));
    await expect(getMobileProfileSelectedSeasonPlayer(LEAGUE_ID, SEASON_ID, PLAYER_ID))
      .rejects.toThrow('non-goalie cross-player');
  });

  it('retains other selected-season roster identities so ambiguous goalie evidence stays unknown', async () => {
    const facts = commonFacts();
    const roster = (id: string, playerId: string) => ({
      id, player_id: playerId, team_id: TEAM_ID, league_id: LEAGUE_ID, season_id: SEASON_ID,
      start_date: '2026-09-01', end_date: null, is_goalie: true, position: 'G', status: 'active',
      player_type: 'regular', historical_retained: false, games_played_override: null,
    });
    facts.rosters = [
      roster('10000000-0000-4000-8000-000000000001', PLAYER_ID),
      roster('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'),
    ];
    mockRpcResult(envelope('selected_stats', facts));

    const player = await getMobileProfileSelectedSeasonPlayer(LEAGUE_ID, SEASON_ID, PLAYER_ID);
    expect(player?.goalie?.gamesPlayed).toMatchObject({ value: null, state: 'unknown' });
  });

  it('preserves provider timeout identity for the route stage mapper', async () => {
    const providerError = { code: '57014', message: 'canceling statement due to statement timeout' };
    mockRpcResult(null, providerError);
    await expect(readMobileProfilePhaseFacts('selected_stats', LEAGUE_ID, PLAYER_ID, SEASON_ID))
      .rejects.toBe(providerError);
  });

  it('reuses canonical attendance helpers for regular-roster defaults and explicit out exclusions', async () => {
    const facts = commonFacts();
    const secondGameId = '80000000-0000-4000-8000-000000000002';
    facts.games.push({ ...facts.games[0], id: secondGameId, scheduled_at: '2026-09-27T20:00:00Z' });
    facts.rosters.push({
      id: '10000000-0000-4000-8000-000000000001', player_id: PLAYER_ID, team_id: TEAM_ID,
      league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: '2026-09-01', end_date: null,
      is_goalie: false, position: 'C', status: 'active', player_type: 'regular',
      historical_retained: false, games_played_override: null,
    });
    facts.availabilities.push({
      id: '90000000-0000-4000-8000-000000000001', game_id: secondGameId,
      player_id: PLAYER_ID, team_id: TEAM_ID, season_id: SEASON_ID, status: 'out',
    });
    mockRpcResult(envelope('timeline', facts));

    await expect(getMobileProfileTimeline(LEAGUE_ID, PLAYER_ID, false, true)).resolves.toMatchObject([{
      season_id: SEASON_ID,
      team_id: TEAM_ID,
      games_played: 1,
      team_games: 2,
      attendance_pct: 50,
    }]);
  });

  it('reuses the canonical game-log fallback without crediting an explicit out game', async () => {
    const facts = commonFacts();
    const secondGameId = '80000000-0000-4000-8000-000000000002';
    facts.games.push({ ...facts.games[0], id: secondGameId, scheduled_at: '2026-09-27T20:00:00Z' });
    facts.rosters.push({
      id: '10000000-0000-4000-8000-000000000001', player_id: PLAYER_ID, team_id: TEAM_ID,
      league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: '2026-09-01', end_date: null,
      is_goalie: false, position: 'C', status: 'active', player_type: 'regular',
      historical_retained: false, games_played_override: null,
    });
    facts.availabilities.push({
      id: '90000000-0000-4000-8000-000000000001', game_id: secondGameId,
      player_id: PLAYER_ID, team_id: TEAM_ID, season_id: SEASON_ID, status: 'out',
    });
    mockRpcResult(envelope('game_log', facts));

    const rows = await getMobileProfileGameLog(LEAGUE_ID, PLAYER_ID, SEASON_ID);
    expect(rows.map((row) => row.game_id)).toEqual([GAME_ID]);
    expect(rows[0]).toMatchObject({ goals: 0, assists: 0, points: 0, opponent: 'Away' });
  });

  it('keeps the installed Supabase client RPC request target tiny and arguments in the POST body', async () => {
    let observed: { targetBytes: number; body: string } | null = null;
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      observed = {
        targetBytes: Buffer.byteLength(`${url.pathname}${url.search}`, 'utf8'),
        body: String(init?.body ?? ''),
      };
      return new Response(JSON.stringify(envelope('selected_stats')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = createSupabaseClient('https://project.supabase.co', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchMock },
    });
    mockedCreateStrictServiceRoleClient.mockReturnValue(client);

    await readMobileProfilePhaseFacts('selected_stats', LEAGUE_ID, PLAYER_ID, SEASON_ID);

    expect(observed).not.toBeNull();
    expect(observed!.targetBytes).toBeLessThanOrEqual(8192);
    expect(observed!.targetBytes).toBeLessThan(128);
    expect(JSON.parse(observed!.body)).toEqual({
      p_phase: 'selected_stats',
      p_league_id: LEAGUE_ID,
      p_player_id: PLAYER_ID,
      p_season_id: SEASON_ID,
    });
  });
});
