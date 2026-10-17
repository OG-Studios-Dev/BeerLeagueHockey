import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as jerseyModel from '../../src/screens/TeamScreen/teamRosterJerseyVariant';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle } from './component-harness';

type Snapshot = Parameters<NonNullable<typeof jerseyModel.resolveTeamRosterBeerGuyScope>>[0];

const team = (id: string) => ({ id, name: id, slug: id, logoUrl: null, primaryColor: null, secondaryColor: null });
const game = (id: string, status: string, scheduledAt: string) => ({
  id,
  status,
  scheduledAt,
  location: null,
  homeScore: null,
  awayScore: null,
  homeTeam: team('team-a'),
  awayTeam: team('team-b'),
});

function snapshot(games: ReturnType<typeof game>[]) {
  return {
    season: { id: 'season-a' },
    team: team('team-a'),
    league: { id: 'league-a' },
    games,
  } as Snapshot;
}

describe('Team jersey Beer Guy scope', () => {
  it('maps the Team page to its earliest eligible future scheduled current-snapshot game', () => {
    assert.equal(typeof jerseyModel.resolveTeamRosterBeerGuyScope, 'function');
    const scope = jerseyModel.resolveTeamRosterBeerGuyScope(snapshot([
      game('completed', 'completed', '2026-10-15T20:00:00.000Z'),
      game('live', 'in_progress', '2026-10-16T21:00:00.000Z'),
      game('past-scheduled', 'scheduled', '2026-10-15T21:00:00.000Z'),
      game('later', 'scheduled', '2026-10-19T21:00:00.000Z'),
      game('next', 'scheduled', '2026-10-17T21:00:00.000Z'),
    ]), new Date('2026-10-16T12:00:00.000Z'));

    assert.deepEqual(scope, {
      key: 'league-a:season-a:team-a:next',
      leagueId: 'league-a',
      seasonId: 'season-a',
      teamId: 'team-a',
      gameId: 'next',
    });
  });

  it('returns no scope for no game, another team, malformed dates, non-scheduled statuses, or non-future games', () => {
    const invalidGames = [
      game('other-team', 'scheduled', '2026-10-17T21:00:00.000Z'),
      game('bad-date', 'scheduled', 'not-a-date'),
      game('postponed', 'postponed', '2026-10-17T21:00:00.000Z'),
      game('now', 'scheduled', '2026-10-16T12:00:00.000Z'),
    ];
    invalidGames[0] = {
      ...invalidGames[0],
      homeTeam: team('team-b'),
      awayTeam: team('team-c'),
    };
    assert.equal(
      jerseyModel.resolveTeamRosterBeerGuyScope(snapshot(invalidGames), new Date('2026-10-16T12:00:00.000Z')),
      null,
    );
    assert.equal(
      jerseyModel.resolveTeamRosterBeerGuyScope(snapshot([]), new Date('2026-10-16T12:00:00.000Z')),
      null,
    );
  });
});

type Node = { props: Record<string, unknown>; type: unknown };

function findNodes(root: unknown, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(root)) return root.flatMap((child) => findNodes(child, predicate));
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as Node;
  const children = (node.props as { children?: unknown }).children;
  return [...(predicate(node) ? [node] : []), ...findNodes(children, predicate)];
}

const rosterPlayer = (
  playerId: string,
  overrides: Record<string, unknown> = {},
) => ({
  rosterId: `roster-${playerId}`,
  playerId,
  name: playerId === 'assigned' ? 'Assigned Goalie' : 'Other Captain',
  photoUrl: null,
  jerseyNumber: playerId === 'assigned' ? 31 : 12,
  position: playerId === 'assigned' ? 'Goalie' : 'Forward',
  isGoalie: playerId === 'assigned',
  leadershipRole: playerId === 'assigned' ? 'alternate_captain' : 'captain',
  playerType: 'regular',
  gamesPlayed: null,
  gamesPlayedProvenance: null,
  goals: null,
  assists: null,
  points: null,
  penaltyMinutes: null,
  goalieGamesPlayed: null,
  goalieGamesPlayedProvenance: null,
  goalsAgainstAverage: null,
  goalsAgainstAverageProvenance: null,
  ...overrides,
});

type PublicSnapshotFixture = {
  [key: string]: unknown;
  roster: Array<Record<string, unknown>>;
  acceptedSubstitutions: Array<Record<string, unknown>>;
  publishedLineup: Record<string, unknown> | null;
};

function publicSnapshot(teamIdentity = team('team-a')): PublicSnapshotFixture {
  const players = [
    rosterPlayer('other'),
    rosterPlayer('assigned'),
    rosterPlayer('spare', { playerType: 'sub', name: 'Spare Player', isGoalie: false, position: 'Forward' }),
  ];
  return {
    season: { id: 'season-a', name: 'Fall 2026', status: 'active', startDate: '2026-09-01', endDate: null },
    team: teamIdentity,
    league: { id: 'league-a', name: 'League A', slug: 'league-a', primaryColor: '#22D3EE', timezone: 'America/Toronto' },
    standing: null,
    standings: [],
    rank: null,
    record: 'No games yet',
    streak: null,
    hero: { winPercentage: null },
    roster: players,
    leaders: { points: [], goals: [], assists: [], penaltyMinutes: [] },
    leagueLeaders: [],
    games: [],
    collapsedSchedule: [],
    nextGame: null,
    rivals: [],
    championships: { count: 0, latestTitleSeasonName: null, latestTitleLabel: null, titleSeasonIds: [] },
    captain: players[0],
    publishedLineup: null,
    acceptedSubstitutions: [],
    sponsors: [],
  };
}

function publicPageRuntime(beerGuyPlayerId: string | null, sourceSnapshot = publicSnapshot(), width = 390) {
  const harness = createHookHarness();
  const SelectableControl = (props: Record<string, unknown>) => createElement('Pressable', {
    ...props,
    accessibilityState: { selected: props.selected === true, disabled: false },
  }, props.children);
  const Component = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/TeamScreen/TeamPublicPage.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        Image: 'Image', ImageBackground: 'ImageBackground', Pressable: 'Pressable', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: { position: 'absolute', inset: 0 }, hairlineWidth: 1 },
        useWindowDimensions: () => ({ width, height: 844, fontScale: 1 }),
      },
      '@expo/vector-icons': { Ionicons: 'Ionicon', MaterialCommunityIcons: 'MaterialCommunityIcon' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      '../../components/Avatar': (props: Record<string, unknown>) => createElement('Avatar', props),
      '../../components/CarouselPager': () => null,
      '../../components/LeagueLeadersPresentation': () => null,
      '../../components/ScheduleMatchupCard': () => null,
      '../../components/SelectableControl': {
        SelectableControl,
        SelectableControlGroup: (props: Record<string, unknown>) => createElement('View', props, props.children),
      },
      '../../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../../lib/schedulePresentation': { selectTeamScheduleGames: () => [] },
      '../../lib/supabase/publicStats': { formatPublicMetric: () => ({ value: '—', hint: 'Not recorded.' }) },
      '../../theme/colors': { __esModule: true, default: { primary: '#8B5CF6', textSecondary: '#A8B4C8', glassStrokeStrong: '#334155', bgSurface: '#07111F' } },
      '../../theme/focusAccent': { resolveFocusAccent: () => '#22D3EE' },
      '../../theme/ui': { ui: { minTouchTarget: 44 } },
      './BroadcastTeamHero': () => null,
      '../../assets/team-page/weekly-games-bg.jpg': 1,
      '../../assets/team-page/jersey-back-bad-bunny.png': 6,
      '../../assets/team-page/jersey-back-first-general-london.png': 7,
      '../../assets/team-page/jersey-back-liuna.png': 8,
      '../../assets/team-page/jersey-back-fitzrays.png': 9,
      '../../assets/team-page/jersey-back-fallback.png': 10,
      '../../assets/team-page/captain-contact-player-base.png': 11,
      '../../assets/team-page/captain-contact-team-mask.png': 12,
      '../../assets/team-page/captain-contact-neutral-base.png': 13,
      '../../assets/team-page/captain-contact-neutral-team-mask.png': 14,
    },
  ).default;
  harness.mount(() => Component({
    snapshot: sourceSnapshot,
    beerGuyPlayerId,
    reduceTransparency: false,
    onOpenPlayer: () => undefined,
    onOpenGame: () => undefined,
  }));
  return harness;
}

describe('public Team jersey Beer Guy badge', () => {
  it('renders one compact decorative mug on only the exact assigned regular player and names it on the parent jersey', () => {
    const output = publicPageRuntime('assigned', publicSnapshot(), 320).output;
    const badges = findNodes(output, (node) => typeof node.props.testID === 'string'
      && node.props.testID.startsWith('team-roster-beer-guy-'));
    assert.deepEqual(badges.map((badge) => badge.props.testID), ['team-roster-beer-guy-assigned']);

    const assigned = findNode(output, (node) => node.props.testID === 'team-roster-player-assigned');
    assert.match(String(assigned?.props.accessibilityLabel), /Assigned Goalie.*jersey number 31.*goalie.*alternate captain.*Beer Guy for the next scheduled game.*Open player card/i);
    const badge = badges[0];
    assert.equal(badge.props.accessible, false);
    assert.equal(badge.props.accessibilityLabel, undefined);
    const style = flattenStyle(badge.props.style);
    assert.equal(style.position, 'absolute');
    assert.ok(style.width <= 24 && style.height <= 24, 'mug stays compact');
    assert.ok(Number(style.right) >= 0 && Number(style.bottom) >= 0, 'mug stays inside the jersey corner');
    const mug = findNode(badge, (node) => node.type === 'MaterialCommunityIcon');
    assert.equal(mug?.props.name, 'beer');

    const other = findNode(output, (node) => node.props.testID === 'team-roster-player-other');
    assert.doesNotMatch(String(other?.props.accessibilityLabel), /Beer Guy/i);
    assert.equal(findNode(output, (node) => node.props.testID === 'team-roster-player-spare'), undefined);
  });

  it('fails closed for no assignment, an absent player, and a spare identity', () => {
    for (const playerId of [null, 'missing', 'spare']) {
      const output = publicPageRuntime(playerId).output;
      assert.equal(findNodes(output, (node) => typeof node.props.testID === 'string'
        && node.props.testID.startsWith('team-roster-beer-guy-')).length, 0);
      for (const jersey of findNodes(output, (node) => typeof node.props.testID === 'string'
        && node.props.testID.startsWith('team-roster-player-'))) {
        assert.doesNotMatch(String(jersey.props.accessibilityLabel), /Beer Guy/i);
      }
    }
  });

  it('keeps the exact mug mapping across every live jersey variant and fallback', () => {
    const variants = [
      ['093f611c-0cdc-4509-afde-9c661b5833c9', 6],
      ['453d62d9-80b4-4f26-a2ee-861f0c063402', 7],
      ['346833e0-2780-492d-86db-94df0b0cb3e1', 8],
      ['e4be829d-952c-4531-8376-215907fab3b7', 9],
      ['unknown-team', 10],
    ] as const;
    for (const [teamId, expectedArt] of variants) {
      const output = publicPageRuntime('assigned', publicSnapshot(team(teamId))).output;
      assert.ok(findNode(output, (node) => node.props.testID === 'team-roster-beer-guy-assigned'));
      assert.equal(findNode(output, (node) => node.props.testID === 'team-roster-art-assigned')?.props.source, expectedArt);
      assert.equal(findNode(output, (node) => node.props.testID === 'team-roster-beer-guy-other'), undefined);
    }
  });

  it('preserves substitute identity in a published jersey label without ever giving the spare a mug', () => {
    const source = publicSnapshot();
    source.roster = [rosterPlayer('spare', {
      playerType: 'sub',
      name: 'Accepted Spare',
      leadershipRole: null,
      isGoalie: false,
      position: 'Forward',
    })];
    source.acceptedSubstitutions = [{
      id: 'invite-spare',
      subPlayerId: 'spare',
      subPlayerName: 'Accepted Spare',
      replacedPlayerId: null,
      replacedPlayerName: null,
    }];
    source.publishedLineup = {
      status: 'published',
      layout_json: {
        roster: [{ playerId: 'spare', fullName: 'Accepted Spare', jerseyNumber: 12 }],
        placedPlayers: [{ playerId: 'spare', x: 28, y: 22 }],
      },
    };
    const output = publicPageRuntime('spare', source).output;
    const spare = findNode(output, (node) => node.props.testID === 'team-roster-player-spare');
    assert.match(String(spare?.props.accessibilityLabel), /Accepted Spare.*jersey number 12.*substitute.*Open player card/i);
    assert.equal(findNode(output, (node) => node.props.testID === 'team-roster-beer-guy-spare'), undefined);
  });
});
