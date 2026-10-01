import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

const ids = {
  league: '11111111-1111-4111-8111-111111111111',
  otherLeague: '22222222-2222-4222-8222-222222222222',
  teamA: '33333333-3333-4333-8333-333333333333',
  teamB: '44444444-4444-4444-8444-444444444444',
  hiddenTeam: '55555555-5555-4555-8555-555555555555',
  playerA: '66666666-6666-4666-8666-666666666666',
  playerB: '77777777-7777-4777-8777-777777777777',
  orphanRoster: '88888888-8888-4888-8888-888888888888',
};

type Row = Record<string, unknown>;
type LoaderModule = {
  loadPublicPlayersDirectory(args: { leagueId: string; leagueSlug: string; pageSize?: number }): Promise<{
    teams: Row[];
    memberships: Row[];
    omittedOrphanRows: number;
  }>;
  buildPlayersDirectoryView(data: unknown, filters: unknown): { players: Row[]; positions: string[] };
};

class Query {
  filters: Array<[string, unknown]> = [];
  orders: Array<[string, unknown]> = [];
  selected = '';
  private from = 0;
  private to = Number.MAX_SAFE_INTEGER;

  constructor(readonly table: string, private rows: Row[], private calls: Query[], private failFrom: number | null = null) { calls.push(this); }
  select(value: string) { this.selected = value.replace(/\s+/g, ''); return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  order(column: string, options?: unknown) { this.orders.push([column, options]); return this; }
  range(from: number, to: number) { this.from = from; this.to = to; return this; }
  async maybeSingle() {
    const data = this.rows.filter((row) => this.filters.every(([key, value]) => row[key] === value));
    return { data: data.length === 1 ? data[0] : null, error: data.length > 1 ? { message: 'multiple' } : null };
  }
  then(resolve: (value: unknown) => unknown) {
    if (this.failFrom !== null && this.from >= this.failFrom) {
      return Promise.resolve({ data: null, error: { message: 'later page unavailable' } }).then(resolve);
    }
    const filtered = this.rows.filter((row) => this.filters.every(([key, value]) => row[key] === value));
    return Promise.resolve({ data: filtered.slice(this.from, this.to + 1), error: null }).then(resolve);
  }
}

function loadWith(tables: Record<string, Row[]>, failRosterFrom: number | null = null) {
  const calls: Query[] = [];
  const client = { from: (table: string) => new Query(table, tables[table] ?? [], calls, table === 'team_rosters' ? failRosterFrom : null) };
  const exports = compileCommonJs<LoaderModule>(new URL('../../src/lib/playersDirectory.ts', import.meta.url), {
    './supabase/client': { publicSupabase: client },
  });
  return { ...exports, calls };
}

function fixtures(): Record<string, Row[]> {
  const teamA = { id: ids.teamA, league_id: ids.league, name: 'Alpha', slug: 'alpha', logo_url: null, division_id: null, primary_color: '#111111', team_type: 'standard' };
  const teamB = { id: ids.teamB, league_id: ids.league, name: 'Beta', slug: 'beta', logo_url: null, division_id: null, primary_color: null, team_type: 'standard' };
  const hidden = { id: ids.hiddenTeam, league_id: ids.league, name: 'Free Agents', slug: 'free-agents', logo_url: null, division_id: null, primary_color: null, team_type: 'free_agents' };
  const profileA = { id: ids.playerA, full_name: 'Alex Ten', avatar_url: ' avatar ', photo_url: 'photo' };
  const profileB = { id: ids.playerB, full_name: 'Blair Two', avatar_url: null, photo_url: ' photo-b ' };
  return {
    leagues: [{ id: ids.league, slug: 'hockey-life', name: 'Hockey Life', status: 'active' }],
    teams: [teamB, hidden, teamA],
    team_rosters: [
      { id: '90000000-0000-4000-8000-000000000001', league_id: ids.league, team_id: ids.teamA, player_id: ids.playerA, jersey_number: 10, position: 'Forward', leadership_role: 'captain', profile: profileA, team: teamA },
      { id: '90000000-0000-4000-8000-000000000002', league_id: ids.league, team_id: ids.teamB, player_id: ids.playerA, jersey_number: 2, position: 'Defense', leadership_role: null, profile: profileA, team: teamB },
      { id: '90000000-0000-4000-8000-000000000003', league_id: ids.league, team_id: ids.teamB, player_id: ids.playerB, jersey_number: null, position: 'Goalie', leadership_role: 'alternate_captain', profile: profileB, team: teamB },
      { id: ids.orphanRoster, league_id: ids.league, team_id: ids.teamA, player_id: null, jersey_number: 1, position: null, leadership_role: null, profile: null, team: teamA },
    ],
  };
}

describe('public Players directory loader and web-order model', () => {
  it('paginates exact public projections, tenant filters, canonical IDs and public team catalog', async () => {
    const f = fixtures();
    const loader = loadWith(f);
    const result = await loader.loadPublicPlayersDirectory({ leagueId: ids.league, leagueSlug: 'hockey-life', pageSize: 2 });

    assert.deepEqual(result.teams.map((team: Row) => team.name), ['Alpha', 'Beta']);
    assert.deepEqual(result.memberships.map((row: Row) => row.id), [ids.playerA, ids.playerA, ids.playerB]);
    assert.equal(result.memberships[0].photoUrl, 'avatar');
    assert.equal(result.memberships[2].photoUrl, 'photo-b');
    assert.equal(result.omittedOrphanRows, 1);
    assert.ok(loader.calls.filter((call: Query) => call.table === 'teams').length >= 2);
    assert.ok(loader.calls.filter((call: Query) => call.table === 'team_rosters').length >= 2);
    for (const call of loader.calls.filter((entry: Query) => entry.table === 'teams' || entry.table === 'team_rosters')) {
      assert.deepEqual(call.filters, [['league_id', ids.league]]);
      assert.doesNotMatch(call.selected, /email|phone|date_of_birth|service_role/i);
    }
    assert.match(loader.calls.find((call: Query) => call.table === 'team_rosters')!.selected, /profiles\(id,full_name,avatar_url,photo_url\)/);
  });

  it('matches website filter then jersey/null/tie order, player dedupe, then search semantics', async () => {
    const loader = loadWith(fixtures());
    const data = await loader.loadPublicPlayersDirectory({ leagueId: ids.league, leagueSlug: 'hockey-life', pageSize: 2 });
    const teamView = loader.buildPlayersDirectoryView(data, { teamId: ids.teamA, position: null, divisionId: null, search: '10' });
    assert.deepEqual(teamView.players.map((row: Row) => row.id), [ids.playerA]);
    assert.equal(teamView.players[0].teamId, ids.teamA);

    const allView = loader.buildPlayersDirectoryView(data, { teamId: null, position: null, divisionId: null, search: '' });
    assert.deepEqual(allView.players.map((row: Row) => [row.id, row.jerseyNumber]), [[ids.playerA, 2], [ids.playerB, null]]);
    assert.deepEqual(allView.positions, ['Defense', 'Goalie']);
  });

  it('rejects tenant identity mismatches, a later page error and cross-league rows', async () => {
    const missing = loadWith(fixtures());
    await assert.rejects(missing.loadPublicPlayersDirectory({ leagueId: ids.otherLeague, leagueSlug: 'hockey-life', pageSize: 2 }), /identity/i);

    const f = fixtures();
    f.team_rosters[2] = { ...f.team_rosters[2], team: { ...(f.team_rosters[2].team as Row), league_id: ids.otherLeague } };
    const cross = loadWith(f);
    await assert.rejects(cross.loadPublicPlayersDirectory({ leagueId: ids.league, leagueSlug: 'hockey-life', pageSize: 20 }), /tenant/i);

    const laterFailure = loadWith(fixtures(), 2);
    await assert.rejects(laterFailure.loadPublicPlayersDirectory({ leagueId: ids.league, leagueSlug: 'hockey-life', pageSize: 2 }), /later page unavailable/i);
  });

  it('normalizes blank optional display fields, falls back from blank avatar, and permits a nullable team slug', async () => {
    const f = fixtures();
    f.teams[0] = { ...f.teams[0], slug: null, logo_url: '  ', primary_color: '', team_type: '   ' };
    f.teams[1] = { ...f.teams[1], slug: '   ' };
    f.teams[2] = { ...f.teams[2] };
    delete f.teams[2].slug;
    f.team_rosters = f.team_rosters.map((row) => row.team_id === ids.teamB
      ? { ...row, team: f.teams[0] }
      : row.team_id === ids.teamA ? { ...row, team: f.teams[2] } : row);
    f.team_rosters[0] = {
      ...f.team_rosters[0],
      profile: { ...(f.team_rosters[0].profile as Row), avatar_url: '  ', photo_url: ' fallback-photo ' },
    };
    f.team_rosters[2] = {
      ...f.team_rosters[2],
      profile: { ...(f.team_rosters[2].profile as Row), avatar_url: '', photo_url: '   ' },
    };

    const result = await loadWith(f).loadPublicPlayersDirectory({ leagueId: ids.league, leagueSlug: 'hockey-life', pageSize: 20 });
    const beta = result.teams.find((team: Row) => team.id === ids.teamB);
    assert.deepEqual(beta, {
      id: ids.teamB, name: 'Beta', slug: null, logoUrl: null, divisionId: null, primaryColor: null, teamType: null,
    });
    assert.equal(result.memberships.find((row) => String(row.rosterId).endsWith('0001'))?.photoUrl, 'fallback-photo');
    assert.equal(result.memberships.find((row) => String(row.rosterId).endsWith('0003'))?.photoUrl, null);
  });

  it('requires the strict active league identity row', async () => {
    const inactive = fixtures();
    inactive.leagues[0].status = 'inactive';
    await assert.rejects(loadWith(inactive).loadPublicPlayersDirectory({ leagueId: ids.league, leagueSlug: 'hockey-life' }), /identity mismatch/i);

    const noRow = fixtures();
    noRow.leagues = [];
    const loader = loadWith(noRow);
    await assert.rejects(loader.loadPublicPlayersDirectory({ leagueId: ids.league, leagueSlug: 'hockey-life' }), /identity mismatch/i);
    const identityRead = loader.calls.find((call: Query) => call.table === 'leagues');
    assert.equal(identityRead?.selected, 'id,name,slug');
    assert.deepEqual(identityRead?.filters, [['id', ids.league], ['slug', 'hockey-life'], ['status', 'active']]);
  });
});
