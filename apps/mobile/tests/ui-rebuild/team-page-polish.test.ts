/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';
import { rankHomeLeaders } from '../../src/lib/homeLeagueLeaders.ts';
import * as schedulePresentation from '../../src/lib/schedulePresentation.ts';
import { buildBroadcastTeamHeroModel } from '../../src/screens/TeamScreen/teamBroadcastHeroModel.ts';

const heroSourceUrl = new URL('../../src/screens/TeamScreen/BroadcastTeamHero.tsx', import.meta.url);
const teamModelUrl = new URL('../../src/lib/supabase/teamPage.ts', import.meta.url);
const leadersCoreUrl = new URL('../../src/components/LeagueLeadersPresentation.tsx', import.meta.url);
const homeLeadersUrl = new URL('../../src/components/HomeLeagueLeaders.tsx', import.meta.url);
const teamPageUrl = new URL('../../src/screens/TeamScreen/TeamPublicPage.tsx', import.meta.url);

function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const heroSnapshot = {
  team: { name: 'Aurora Wolves', primaryColor: '#123456', secondaryColor: '#ABCDEF' },
  league: { primaryColor: '#03299B' },
  standing: { goalsFor: 10, goalsAgainst: 8, goalDifferential: 2 },
  rank: 1,
  record: '4-1-0',
  streak: 'W2',
  hero: { winPercentage: 0.8 },
  championships: { count: 1, latestTitleSeasonName: 'Fall 2025', latestTitleLabel: '2025' },
};

describe('Team page polish contract', () => {
  it('keeps team identity accessible without rendering the profile kicker or duplicate team name', () => {
    const source = readFileSync(heroSourceUrl.pathname, 'utf8');
    const model = buildBroadcastTeamHeroModel(heroSnapshot);

    assert.doesNotMatch(source, /HOCKEY LIFE \/\/ TEAM PROFILE/);
    assert.doesNotMatch(source, /team-broadcast-name-primary|team-broadcast-name-secondary/);
    assert.match(model.heroLabel, /^Aurora Wolves,/);
    assert.match(source, /accessible\s*\n\s*accessibilityLabel=\{heroLabel\}/);
    assert.match(source, /hero:\s*\{[^}]*height:\s*(?:4[0-8]\d|[1-3]\d\d)/s, 'hero must reflow instead of reserving the old 520px identity block');
  });

  it('uses validated team primary and secondary colors for the GF/GA ribbon', () => {
    const valid = buildBroadcastTeamHeroModel(heroSnapshot);
    assert.deepEqual(valid.tickerColors, ['#123456', '#ABCDEF']);

    const missingSecondary = buildBroadcastTeamHeroModel({
      ...heroSnapshot,
      team: { ...heroSnapshot.team, secondaryColor: 'pink' },
    });
    assert.deepEqual(missingSecondary.tickerColors, ['#123456', '#123456']);

    const invalidPrimary = buildBroadcastTeamHeroModel({
      ...heroSnapshot,
      team: { ...heroSnapshot.team, primaryColor: 'purple', secondaryColor: null },
    });
    assert.deepEqual(invalidPrimary.tickerColors, ['#03299B', '#03299B']);

    const source = readFileSync(heroSourceUrl.pathname, 'utf8');
    assert.match(source, /colors=\{tickerColors\}/);
    assert.doesNotMatch(source, /#6A18D7|#D21BA4|#FF3EAD/i);

    const bright = buildBroadcastTeamHeroModel({
      ...heroSnapshot,
      team: { ...heroSnapshot.team, primaryColor: '#38BDF8', secondaryColor: '#38BDF8' },
    });
    assert.ok(bright.tickerTextColors.every((color) => contrastRatio('#38BDF8', color) >= 4.5));

    const dark = buildBroadcastTeamHeroModel({
      ...heroSnapshot,
      team: { ...heroSnapshot.team, primaryColor: '#123456', secondaryColor: '#123456' },
    });
    assert.ok(dark.tickerTextColors.every((color) => contrastRatio('#123456', color) >= 4.5));

    const adversarial = buildBroadcastTeamHeroModel({
      ...heroSnapshot,
      team: { ...heroSnapshot.team, primaryColor: '#E41480', secondaryColor: '#E41480' },
    });
    assert.ok(
      adversarial.tickerTextColors.every((color) => contrastRatio('#E41480', color) >= 4.5),
      'every label and value must retain WCAG AA contrast for valid team colours',
    );
    assert.match(source, /color:\s*tickerTextColors\[index\]/);
  });

  it('builds the Team League Leaders population only from team-scoped current-season public facts', () => {
    const model = compileCommonJs<Record<string, (...args: any[]) => any>>(teamModelUrl, {
      './client': { supabase: {} },
      './team': { getMetricsOperationalSeason: async () => ({ season: null, error: null }) },
      './publicStats': { getPublicSeasonStats: async () => ({ players: [] }) },
    });
    const metric = (value: number | null, state = value === null ? 'unknown' : 'recorded') => ({ value, state, sources: value === null ? [] : ['public'] });
    const player = (
      playerId: string,
      playerName: string,
      teamId: string,
      points: number | null,
      options: { goals?: number | null; assists?: number | null; gaa?: number | null; roles?: Array<'skater' | 'goalie'>; teams?: Array<{ id: string; name: string }> } = {},
    ) => {
      const roles = options.roles ?? ['skater'];
      const teams = options.teams ?? [{ id: teamId, name: teamId === 'team-a' ? 'Aurora Wolves' : 'Other Team' }];
      return {
        playerId, playerName, avatarUrl: `${playerId}.png`, displayTeam: teams[0] ?? null, teams, roles,
        metrics: {
          gamesPlayed: metric(4), goals: metric(options.goals ?? points), assists: metric(options.assists ?? 0),
          points: metric(points), penaltyMinutes: metric(0),
        },
        goalie: roles.includes('goalie') ? {
          gamesPlayed: metric(2), wins: metric(1), losses: metric(1), saves: metric(30), goalsAgainst: metric(4),
          savePercentage: metric(.882), goalsAgainstAverage: metric(options.gaa ?? null), shutouts: metric(0),
        } : null,
      };
    };
    const publicStats = { players: [
      player('departed', 'Departed Contributor', 'team-a', 12, { goals: 8, assists: 4 }),
      player('dual', 'Dual Role', 'team-a', 10, { goals: 5, assists: 5, gaa: 1.5, roles: ['skater', 'goalie'] }),
      player('goalie', 'Goalie Only', 'team-a', null, { goals: null, assists: null, gaa: 2.5, roles: ['goalie'] }),
      player('boundary-a', 'A Boundary', 'team-a', 9),
      player('boundary-b', 'B Boundary', 'team-a', 9),
      player('boundary-c', 'C Boundary', 'team-a', 9),
      player('wrong-team', 'Wrong Team', 'team-b', 999),
      player('mixed-total', 'Mixed Team Total', 'team-a', 998, { teams: [{ id: 'team-a', name: 'Aurora Wolves' }, { id: 'team-b', name: 'Other Team' }] }),
    ] };

    const population = model.buildTeamLeagueLeaderPopulation(publicStats, {
      id: 'team-a', name: 'Aurora Wolves', logoUrl: 'aurora.png', primaryColor: '#123456', secondaryColor: '#ABCDEF', slug: 'aurora',
    });
    assert.deepEqual(population.map((row: any) => row.player_id), ['departed', 'dual', 'goalie', 'boundary-a', 'boundary-b', 'boundary-c']);
    assert.equal(population.find((row: any) => row.player_id === 'departed')?.team_id, 'team-a');
    assert.equal(population.find((row: any) => row.player_id === 'dual')?.gaa, 1.5, 'dual-role output keeps both skater and goalie facts');
    const points = rankHomeLeaders(population, 'points');
    assert.deepEqual(points.map((row) => row.player_id), ['departed', 'dual', 'boundary-a']);
    assert.deepEqual([points[2].rankLabel, points[2].tied], ['T3', true], 'the hidden tied population is ranked before the top-three limit');
    assert.deepEqual(rankHomeLeaders(population, 'gaa').map((row) => row.player_id), ['dual', 'goalie']);
  });

  it('shares the Home League Leaders presentation while preserving Home IDs and omitting Team league-wide navigation', () => {
    assert.equal(existsSync(leadersCoreUrl.pathname), true, 'shared LeagueLeadersPresentation core must exist');
    const core = readFileSync(leadersCoreUrl.pathname, 'utf8');
    const home = readFileSync(homeLeadersUrl.pathname, 'utf8');
    const team = readFileSync(teamPageUrl.pathname, 'utf8');

    assert.match(core, />League Leaders</);
    assert.match(core, /Goals.*Assists.*Points.*GAA/s);
    assert.match(core, /testID=\{`\$\{testIDPrefix\}-leader-feature-art`\}/);
    assert.match(home, /LeagueLeadersPresentation/);
    assert.match(home, /testIDPrefix=['"]home['"]/);
    assert.match(team, /useState<HomeLeaderMetric>\(['"]points['"]\)/);
    assert.match(team, /<LeagueLeadersPresentation/);
    assert.match(team, /leaders=\{snapshot\.leagueLeaders\}/);
    assert.match(team, /showAllStats=\{false\}/);
    assert.doesNotMatch(team, /Team Leaders/);
  });

  it('selects the last two results and prefers one live game with deterministic time and ID ties', () => {
    assert.equal(typeof schedulePresentation.selectTeamScheduleGames, 'function');
    const game = (id: string, scheduled_at: string, status: string | null) => ({
      id, scheduled_at, status,
      home_team_id: 'team-a', away_team_id: 'team-b', home_score: null, away_score: null,
      location: null, season_id: 'season-1', home_team: null, away_team: null,
    });
    const games = [
      game('completed-old', '2026-01-01T12:00:00Z', 'completed'),
      game('completed-recent-b', '2026-01-03T12:00:00Z', 'completed'),
      game('completed-recent-a', '2026-01-03T12:00:00Z', 'pending_verification'),
      game('scheduled-first', '2026-01-05T12:00:00Z', 'scheduled'),
      game('live-b', '2026-01-04T12:00:00Z', 'in_progress'),
      game('live-a', '2026-01-04T12:00:00Z', 'in_progress'),
      game('cancelled', '2026-01-06T12:00:00Z', 'cancelled'),
      game('postponed', '2026-01-07T12:00:00Z', 'postponed'),
      game('unknown', '2026-01-08T12:00:00Z', 'mystery'),
    ];
    const expected = ['completed-recent-a', 'completed-recent-b', 'live-a'];
    assert.deepEqual(schedulePresentation.selectTeamScheduleGames(games).map((row) => row.id), expected);
    assert.deepEqual(schedulePresentation.selectTeamScheduleGames([...games].reverse()).map((row) => row.id), expected);
  });

  it('returns only available canonical games for partial schedules and scheduled fallback', () => {
    const game = (id: string, scheduled_at: string, status: string | null) => ({ id, scheduled_at, status });
    assert.deepEqual(schedulePresentation.selectTeamScheduleGames([
      game('scheduled-later', '2026-01-06T12:00:00Z', 'scheduled'),
      game('scheduled-earlier', '2026-01-05T12:00:00Z', 'scheduled'),
      game('cancelled', '2026-01-04T12:00:00Z', 'cancelled'),
      game('postponed', '2026-01-03T12:00:00Z', 'postponed'),
      game('unknown', '2026-01-02T12:00:00Z', null),
      game('invalid-date', 'not-a-date', 'completed'),
    ]).map((row) => row.id), ['scheduled-earlier']);
    assert.deepEqual(schedulePresentation.selectTeamScheduleGames([
      game('only-result', '2026-01-01T12:00:00Z', 'pending_verification'),
    ]).map((row) => row.id), ['only-result']);
    assert.deepEqual(schedulePresentation.selectTeamScheduleGames([]), []);
  });

  it('renders the canonical Schedule matchup/date-card treatment without expansion or placeholder rows', () => {
    const team = readFileSync(teamPageUrl.pathname, 'utf8');
    assert.match(team, /import ScheduleMatchupCard from ['"]\.\.\/\.\.\/components\/ScheduleMatchupCard['"]/);
    assert.match(team, /buildScheduleRows/);
    assert.match(team, /selectTeamScheduleGames/);
    assert.match(team, /<FocusCard focusId=\{`team-public:\$\{snapshot\.team\.id\}:schedule:/);
    assert.match(team, /<ScheduleMatchupCard/);
    assert.doesNotMatch(team, /function ScheduleRow/);
    assert.doesNotMatch(team, /View full schedule|placeholder/i);
  });
});
