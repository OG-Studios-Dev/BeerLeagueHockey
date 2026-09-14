import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBumpChartSegment, buildPlayoffsDirectoryView, buildTeamsDirectoryView, commitLatestPageResult, createLatestRequestGate, filterPlayers, reconcilePlayerFilters } from '../../src/lib/leaguePagesModel.ts';
import type { PagePlayer, PlayoffsPageResponse, TeamsPageResponse } from '../../src/lib/leaguePages.ts';

const ids = {
  player: '11111111-1111-4111-8111-111111111111',
  secondPlayer: '22222222-2222-4222-8222-222222222222',
  northTeam: '33333333-3333-4333-8333-333333333333',
  southTeam: '44444444-4444-4444-8444-444444444444',
  north: '55555555-5555-4555-8555-555555555555',
  south: '66666666-6666-4666-8666-666666666666',
};

function member(overrides: Partial<PagePlayer>): PagePlayer {
  return {
    id: ids.player, fullName: 'Casey Zero', photoUrl: null, jerseyNumber: 0, position: null,
    leadershipRole: null, teamId: ids.northTeam, teamName: 'North Stars', teamSlug: 'north-stars',
    teamLogoUrl: null, divisionId: ids.north, ...overrides,
  };
}

describe('league page pure models', () => {
  it('filters membership rows before deterministic player dedupe and searches jersey zero', () => {
    const transfers = [
      member({ teamId: ids.northTeam, teamName: 'North Stars', teamSlug: 'north-stars', divisionId: ids.north }),
      member({ teamId: ids.southTeam, teamName: 'South Bears', teamSlug: 'south-bears', divisionId: ids.south, jerseyNumber: 19 }),
      member({ id: ids.secondPlayer, fullName: 'Taylor Wing', teamId: ids.southTeam, teamName: 'South Bears', teamSlug: 'south-bears', divisionId: ids.south, position: 'Forward', jerseyNumber: 8 }),
    ];

    assert.deepEqual(filterPlayers(transfers, { divisionId: ids.south, teamId: ids.northTeam }), []);
    assert.deepEqual(filterPlayers(transfers, { divisionId: ids.south }).map((row) => [row.id, row.teamId]), [
      [ids.player, ids.southTeam],
      [ids.secondPlayer, ids.southTeam],
    ]);
    assert.deepEqual(filterPlayers(transfers, { search: '0' }).map((row) => row.id), [ids.player]);
  });

  it('clears stale team and position selections when season or division options change', () => {
    const transfers = [
      member({ teamId: ids.northTeam, divisionId: ids.north, position: 'Defense' }),
      member({ id: ids.secondPlayer, teamId: ids.southTeam, divisionId: ids.south, position: null, jerseyNumber: null }),
    ];
    assert.deepEqual(
      reconcilePlayerFilters(transfers, { divisionId: ids.south, teamId: ids.northTeam, position: 'Defense', search: 'Casey' }),
      { divisionId: ids.south, teamId: null, position: null, search: 'Casey' },
    );
    assert.deepEqual(reconcilePlayerFilters([], { divisionId: ids.north, teamId: ids.northTeam, position: 'Defense' }), {
      divisionId: null, teamId: null, position: null, search: '',
    });
  });

  it('groups team cards and reranks all five positioning metrics inside the selected division', () => {
    const seasonId = '77777777-7777-4777-8777-777777777777';
    const metric = (rank: number, value: number, valueLabel: string) => ({ rank, value, valueLabel });
    const response = {
      schemaVersion: 1, page: 'teams', league: { id: ids.player, slug: 'hockey-life', name: 'Hockey Life' },
      seasons: [{ id: seasonId, name: 'Summer', status: 'active' }],
      selectedSeason: { id: seasonId, name: 'Summer', status: 'active' },
      divisions: [{ id: ids.north, name: 'North' }, { id: ids.south, name: 'South' }],
      teams: [
        { id: ids.northTeam, name: 'North Stars', slug: 'north-stars', logoUrl: null, divisionId: ids.north, divisionName: 'North', primaryColor: '#112233' },
        { id: ids.southTeam, name: 'South Bears', slug: 'south-bears', logoUrl: null, divisionId: ids.south, divisionName: 'South', primaryColor: '#223344' },
      ],
      positioning: {
        seasonId, totalTeams: 2, attendanceSource: 'confirmed-plus-fallback-roster-appearances',
        teams: [
          { teamId: ids.northTeam, teamName: 'North Stars', teamSlug: 'north-stars', logoUrl: null, primaryColor: '#112233', divisionId: ids.north,
            metrics: { overall: metric(2, 3, '3 pts'), offense: metric(2, 4, '4 GF'), defense: metric(1, 2, '2 GA'), scoringDepth: metric(1, 2, '2 goals'), commitment: metric(2, 60, '60%') } },
          { teamId: ids.southTeam, teamName: 'South Bears', teamSlug: 'south-bears', logoUrl: null, primaryColor: '#223344', divisionId: ids.south,
            metrics: { overall: metric(1, 6, '6 pts'), offense: metric(1, 8, '8 GF'), defense: metric(2, 5, '5 GA'), scoringDepth: metric(2, 1, '1 goal'), commitment: metric(1, 90, '90%') } },
        ],
      },
    } satisfies TeamsPageResponse;

    const view = buildTeamsDirectoryView(response, ids.north, seasonId);
    assert.equal(view.count, 1);
    assert.deepEqual(view.groups.map((group) => [group.name, group.teams[0]?.name]), [['North', 'North Stars']]);
    assert.deepEqual(Object.values(view.positioning?.teams[0]?.metrics ?? {}).map((item) => item.rank), [1, 1, 1, 1, 1]);
    assert.equal(view.positioning?.attendanceSource, 'confirmed-plus-fallback-roster-appearances');
  });

  it('connects exact bump-chart crest centers with measured segment geometry', () => {
    const segment = buildBumpChartSegment({ x: 92, y: 84 }, { x: 204, y: 212 });
    assert.equal(segment.length, Math.hypot(112, 128));
    assert.equal(segment.angleRadians, Math.atan2(128, 112));
    assert.deepEqual(segment.center, { x: 148, y: 148 });

    const halfX = Math.cos(segment.angleRadians) * segment.length / 2;
    const halfY = Math.sin(segment.angleRadians) * segment.length / 2;
    assert.ok(Math.abs(segment.center.x - halfX - 92) < 1e-10);
    assert.ok(Math.abs(segment.center.y - halfY - 84) < 1e-10);
    assert.ok(Math.abs(segment.center.x + halfX - 204) < 1e-10);
    assert.ok(Math.abs(segment.center.y + halfY - 212) < 1e-10);
  });

  it('separates official champion, BYE and TBD semantics from a local Preview Only bracket', () => {
    const seasonId = '77777777-7777-4777-8777-777777777777';
    const gameId = '88888888-8888-4888-8888-888888888888';
    const seriesId = '99999999-9999-4999-8999-999999999999';
    const response = {
      schemaVersion: 1, page: 'playoffs', league: { id: ids.player, slug: 'hockey-life', name: 'Hockey Life' },
      seasons: [{ id: seasonId, name: 'Summer', status: 'playoffs' }], selectedSeason: { id: seasonId, name: 'Summer', status: 'playoffs' },
      divisions: [{ id: ids.north, name: 'North' }],
      teams: [
        { id: ids.northTeam, name: 'North Stars', slug: 'north-stars', logoUrl: null, divisionId: ids.north, divisionName: 'North', primaryColor: null },
        { id: ids.southTeam, name: 'South Bears', slug: 'south-bears', logoUrl: null, divisionId: ids.north, divisionName: 'North', primaryColor: null },
      ],
      series: [
        { id: seriesId, divisionId: ids.north, divisionName: 'North', roundNumber: 1, seriesNumber: 1,
          highSeed: { id: ids.northTeam, name: 'North Stars', logoUrl: null }, lowSeed: null,
          highSeedWins: 0, lowSeedWins: 0, winnerId: null, status: 'scheduled', nextGame: { id: gameId, scheduledAt: '2026-09-20T20:00:00Z', location: 'Rink 1' } },
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', divisionId: ids.north, divisionName: 'North', roundNumber: 2, seriesNumber: 1,
          highSeed: { id: ids.northTeam, name: 'North Stars', logoUrl: null }, lowSeed: { id: ids.southTeam, name: 'South Bears', logoUrl: null },
          highSeedWins: 2, lowSeedWins: 1, winnerId: ids.northTeam, status: 'completed', nextGame: null },
      ],
      standings: [
        { teamId: ids.northTeam, teamName: 'North Stars', logoUrl: null, points: 10, divisionId: ids.north, divisionName: 'North' },
        { teamId: ids.southTeam, teamName: 'South Bears', logoUrl: null, points: 8, divisionId: ids.north, divisionName: 'North' },
      ],
      previewConfig: { playoffTeamsTotal: 2, playoffTeamsPerDivision: null, useDivisionPlayoffs: false },
    } satisfies PlayoffsPageResponse;

    const view = buildPlayoffsDirectoryView(response);
    assert.equal(view.sections[0]?.champion?.name, 'North Stars');
    const pendingWithOneKnown = view.sections[0]?.rounds[0]?.series[0];
    assert.equal(pendingWithOneKnown && view.seedLabel(pendingWithOneKnown, 'low'), 'TBD');
    assert.equal(view.seedLabel({ ...response.series[0]!, status: 'bye' }, 'low'), 'BYE');
    assert.equal(view.seedLabel({ ...response.series[0]!, status: 'bye', highSeed: null }, 'low'), 'TBD');
    assert.deepEqual(view.previewContext, { availableDivisions: [{ id: ids.north, name: 'North', teamCount: 2 }], requiresDivisionSelection: false, totalTeams: 2 });
    assert.equal(view.generatePreview(null).success, true);
  });

  it('commits only the latest tenant-season reply and invalidates it on scope cleanup', () => {
    const gate = createLatestRequestGate();
    const commits: string[] = [];
    const oldRequest = gate.begin('league-a:season-a');
    const currentRequest = gate.begin('league-a:season-b');
    assert.equal(commitLatestPageResult(gate, oldRequest, 'league-a:season-a', () => commits.push('stale')), false);
    assert.equal(commitLatestPageResult(gate, currentRequest, 'league-a:season-b', () => commits.push('current')), true);
    gate.invalidate();
    assert.equal(commitLatestPageResult(gate, currentRequest, 'league-a:season-b', () => commits.push('after-cleanup')), false);
    assert.deepEqual(commits, ['current']);
  });
});
