/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { resolveTeamRosterJerseyVariant } from '../../src/screens/TeamScreen/teamRosterJerseyVariant';


function pngPixels(asset: string) {
  const bytes = readFileSync(new NodeURL(`../../src/assets/team-page/${asset}.png`, import.meta.url));
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 6, '8-bit RGBA artwork');
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), pixels = Buffer.alloc(width * height * 4), stride = width * 4;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? pixels[i - 4] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= 4 ? pixels[i - stride - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      pixels[i] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return {
    width,
    height,
    alpha: (x: number, y: number) => pixels[(y * width + x) * 4 + 3],
    rgba: (x: number, y: number) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)],
    pixels,
  };
}

it('ships only efficient 2x transparent full-colour jersey variants with real palette pixels', () => {
  const variants = [
    ['jersey-back-bad-bunny', [243, 74, 154]],
    ['jersey-back-first-general-london', [118, 201, 239]],
    ['jersey-back-liuna', [21, 24, 29]],
    ['jersey-back-fitzrays', [217, 38, 53]],
    ['jersey-back-fallback', [137, 149, 168]],
  ] as const;
  const signatures = new Set<string>();
  for (const [asset, palettePixel] of variants) {
    const image = pngPixels(asset);
    assert.deepEqual([image.width, image.height], [240, 224]);
    assert.equal(image.alpha(0, 0), 0, `${asset}: transparent corner`);
    assert.equal(image.alpha(239, 223), 0);
    const alpha = [...image.pixels].filter((_, index) => index % 4 === 3);
    assert.ok(alpha.some((value) => value === 255), `${asset}: visible opaque paint`);
    assert.ok(alpha.filter((value) => value > 0).length < alpha.length * .7, `${asset}: genuine exterior transparency`);
    const colours = new Set<string>();
    for (let index = 0; index < image.pixels.length; index += 4) {
      if (image.pixels[index + 3] > 0) colours.add(`${image.pixels[index]},${image.pixels[index + 1]},${image.pixels[index + 2]}`);
    }
    assert.ok(colours.size > 500, `${asset}: gradients, texture, highlights and seams survive rasterization`);
    assert.ok(colours.has(palettePixel.join(',')), `${asset}: exact palette colour is painted`);
    signatures.add(`${image.rgba(120, 110)}|${image.rgba(48, 106)}|${image.rgba(120, 45)}`);
  }
  assert.equal(signatures.size, variants.length, 'every team and fallback ships distinct rendered pixels');
  for (const legacyMask of ['jersey-primary', 'jersey-secondary', 'jersey-detail']) {
    assert.equal(existsSync(new NodeURL(`../../src/assets/team-page/${legacyMask}.png`, import.meta.url)), false, `${legacyMask} is replaced rather than shipped alongside full-colour art`);
  }
});

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

const team = (id: string, name: string, color: string) => ({ id, name, slug: id, logoUrl: `${id}.png`, primaryColor: color, secondaryColor: '#D9B64C' });
const roster = [
  { rosterId: 'r1', playerId: 'p1', name: 'Matt Grossi', photoUrl: 'matt.jpg', jerseyNumber: 96, position: 'forward', isGoalie: false, leadershipRole: 'captain', playerType: 'regular', gamesPlayed: 11, gamesPlayedProvenance: 'estimated', goals: 12, assists: 13, points: 25, penaltyMinutes: 4, goalieGamesPlayed: null, goalieGamesPlayedProvenance: null, goalsAgainstAverage: null, goalsAgainstAverageProvenance: null },
  { rosterId: 'r2', playerId: 'p2', name: 'Ash Moore', photoUrl: 'ash.jpg', jerseyNumber: 71, position: 'forward', isGoalie: false, leadershipRole: null, playerType: 'regular', gamesPlayed: 11, gamesPlayedProvenance: 'estimated', goals: 10, assists: 12, points: 22, penaltyMinutes: 12, goalieGamesPlayed: null, goalieGamesPlayedProvenance: null, goalsAgainstAverage: null, goalsAgainstAverageProvenance: null },
  { rosterId: 'r3', playerId: 'p3', name: 'Stefan Kowles', photoUrl: 'stefan.jpg', jerseyNumber: 16, position: 'defense', isGoalie: false, leadershipRole: null, playerType: 'regular', gamesPlayed: 11, gamesPlayedProvenance: 'estimated', goals: 7, assists: 9, points: 16, penaltyMinutes: 20, goalieGamesPlayed: null, goalieGamesPlayedProvenance: null, goalsAgainstAverage: null, goalsAgainstAverageProvenance: null },
];
const leader = (player: any, value: number) => ({ playerId: player.playerId, name: player.name, photoUrl: player.photoUrl, jerseyNumber: player.jerseyNumber, gamesPlayed: player.gamesPlayed, gamesPlayedProvenance: player.gamesPlayedProvenance, value });
const games = ['Past Three', 'Past Two', 'Past One', 'Next One', 'Next Two', 'Next Three'].map((label, index) => ({
  id: `g${index}`, scheduledAt: `2026-03-${String(index + 1).padStart(2, '0')}T20:00:00Z`, status: index < 3 ? 'completed' : 'scheduled', location: label,
  homeScore: index < 3 ? index + 1 : null, awayScore: index < 3 ? index + 2 : null,
  homeTeam: team('team-a', 'London Eco Metal', '#36A852'), awayTeam: team('team-b', 'First General London', '#2454A3'),
}));
const viewedSide = { ...team('team-a', 'London Eco Metal', '#36A852'), overallRecord: '7-2-2', goalsFor: 34, goalsAgainst: 22, goalDifferential: 12, strength: 'offense', weakness: 'defence', sniper: { name: 'Matt Grossi', goals: 12 }, playmaker: { name: 'Matt Grossi', assists: 13 }, tendy: { name: 'No data', gamesPlayed: null, gamesPlayedProvenance: null, goalsAgainstAverage: null, goalsAgainstAverageProvenance: null } };
const snapshot: any = {
  season: { id: 'season-a', name: 'Winter 2026', status: 'active', startDate: '2026-01-01', endDate: null },
  team: team('team-a', 'London Eco Metal', '#36A852'), league: { id: 'league-a', name: 'Hockey Life', slug: 'hockey-life', primaryColor: '#22D3EE', timezone: 'America/Toronto' },
  standing: { teamId: 'team-a', teamName: 'London Eco Metal', logoUrl: 'team-a.png', primaryColor: '#36A852', gamesPlayed: 11, wins: 7, losses: 2, ties: 2, points: 16, goalsFor: 34, goalsAgainst: 22, goalDifferential: 12 },
  standings: [], rank: 2, record: '7-2-2', streak: 'W1', hero: { winPercentage: 7 / 11 }, roster,
  leaders: { points: [leader(roster[0], 25), leader(roster[1], 22), leader(roster[2], 16)], goals: [leader(roster[0], 12), leader(roster[1], 10), leader(roster[2], 7)], assists: [leader(roster[0], 13), leader(roster[1], 12), leader(roster[2], 9)], penaltyMinutes: [leader(roster[2], 20), leader(roster[1], 12), leader(roster[0], 4)] },
  leagueLeaders: roster.map((player) => ({ player_id: player.playerId, player_name: player.name, avatar_url: player.photoUrl, team_id: 'team-a', team_name: 'London Eco Metal', display_team_name: 'London Eco Metal', display_team_logo_url: 'team-a.png', position: player.position, goals: player.goals, assists: player.assists, points: player.points, gaa: null, is_goalie: false, estimated: false })),
  games, collapsedSchedule: [games[1], games[2], games[3], games[4]], nextGame: games[3],
  championships: { count: 1, latestTitleSeasonName: 'Fall 2025', latestTitleLabel: '2025', titleSeasonIds: ['old'] }, captain: roster[0], publishedLineup: null, acceptedSubstitutions: [], sponsors: [{ id: 'sponsor-1', name: 'Rink Shop', logoUrl: 'sponsor.png', websiteUrl: 'https://rinkshop.test', tier: 'gold' }],
  rivals: [
    { team: viewedSide, rival: { ...viewedSide, ...team('team-b', 'First General London', '#2454A3'), overallRecord: '6-4-1', goalsFor: 30, goalsAgainst: 28, goalDifferential: 2, sniper: { name: 'Rival Sniper', goals: 9 }, playmaker: { name: 'Rival Passer', assists: 10 } }, h2hRecord: '2-1', h2hRecordRival: '1-2', gamesPlayed: 3 },
    { team: viewedSide, rival: { ...viewedSide, ...team('team-c', 'Purple Cobras', '#7C3AED'), overallRecord: '5-5-1', goalsFor: 26, goalsAgainst: 26, goalDifferential: 0 }, h2hRecord: '1-1', h2hRecordRival: '1-1', gamesPlayed: 2 },
  ],
};

function LeagueLeadersPresentationMock(props: any) {
  const labels: Record<string, string> = { goals: 'Goals', assists: 'Assists', points: 'Points', gaa: 'GAA' };
  const eligible = props.leaders
    .filter((leader: any) => props.metric !== 'gaa' || leader.is_goalie)
    .filter((leader: any) => leader[props.metric] != null)
    .sort((left: any, right: any) => props.metric === 'gaa'
      ? left.gaa - right.gaa || left.player_id.localeCompare(right.player_id)
      : right[props.metric] - left[props.metric] || left.player_id.localeCompare(right.player_id))
    .slice(0, 3);
  return createElement('View', { ...props, testID: 'team-league-leaders' }, [
    createElement('Text', {}, 'League Leaders'),
    ...Object.entries(labels).map(([metric, label]) => createElement('Pressable', {
      testID: `team-leaders-tab-${metric}`,
      accessibilityRole: 'tab',
      accessibilityState: { selected: props.metric === metric, disabled: false },
      onPress: () => props.onMetricChange(metric),
    }, createElement('Text', {}, label))),
    ...eligible.map((leader: any) => createElement('Pressable', {
      testID: `team-leader-row-${leader.player_id}`,
      accessibilityLabel: `${leader.player_name}, ${leader[props.metric]} ${props.metric}. Open player card.`,
      onPress: () => props.onOpenPlayer(leader.player_id),
    }, createElement('Text', {}, `${leader.player_name}${leader[props.metric]}`))),
  ]);
}

function ScheduleMatchupCardMock(props: any) {
  const game = props.game;
  const date = new Date(game.scheduled_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: props.timezone });
  const time = new Date(game.scheduled_at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: props.timezone });
  const showScore = ['completed', 'in_progress', 'live'].includes(game.status);
  const score = showScore ? ` ${game.away_score}–${game.home_score}` : '';
  const status = game.status === 'completed' ? 'Final' : game.status === 'in_progress' || game.status === 'live' ? 'Live' : 'Scheduled';
  return createElement('Pressable', {
    testID: `schedule-matchup-card-${game.id}`,
    compact: props.compact,
    accessibilityLabel: `${game.away_team.name} at ${game.home_team.name}, ${date}, ${time}, ${game.location}, ${game.away_team.name} ${game.away_score}, ${game.home_team.name} ${game.home_score}`,
    onPress: () => props.onOpenGame(game.id),
  }, props.compact ? [
    createElement('Text', { testID: 'schedule-matchup-facts' }, `${date} ${time} ${status}`),
    createElement('View', { testID: 'schedule-compact-matchup-row', style: { flexDirection: 'row' } }, [
      createElement('TeamLogo', { transparentBacking: true, teamId: game.away_team_id, teamName: game.away_team.name, logoUrl: game.away_team.logo_url }),
      createElement('Text', { testID: showScore ? 'schedule-compact-score' : 'schedule-matchup-versus' }, showScore ? score.trim() : 'VS'),
      createElement('TeamLogo', { transparentBacking: true, teamId: game.home_team_id, teamName: game.home_team.name, logoUrl: game.home_team.logo_url }),
    ]),
  ] : [
    createElement('Text', {}, `${game.away_team.name} vs ${game.home_team.name} ${game.location} ${time}${score}`),
    createElement('TeamLogo', { transparentBacking: true, teamId: game.away_team_id }),
    createElement('TeamLogo', { transparentBacking: true, teamId: game.home_team_id }),
  ]);
}

function runtime(width = 390, sourceSnapshot: any = snapshot, reduceTransparency = false) {
  const harness = createHookHarness();
  const openedPlayers: string[] = [];
  const openedGames: string[] = [];
  const Component = compileCommonJs<{ default: (props: any) => unknown }>(
    new URL('../../src/screens/TeamScreen/TeamPublicPage.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        Image: 'Image', ImageBackground: 'ImageBackground', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: { position: 'absolute', inset: 0 } },
        useWindowDimensions: () => ({ width, height: 844, fontScale: 1 }),
      },
      '@expo/vector-icons': { Ionicons: 'Ionicon', MaterialCommunityIcons: 'MaterialCommunityIcon' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      '../../components/Avatar': (props: any) => createElement('Avatar', props),
      '../../components/LeagueLeadersPresentation': LeagueLeadersPresentationMock,
      '../../components/ScheduleMatchupCard': ScheduleMatchupCardMock,
      '../../components/TeamLogo': (props: any) => createElement('TeamLogo', props),
      '../../theme/colors': { __esModule: true, default: { primary: '#8B5CF6', primaryLight: '#A78BFA', bgBase: '#03070D', textPrimary: '#F7FBFF', textSecondary: '#A8B4C8', borderCard: 'rgba(255,255,255,.12)', glassStrokeStrong: 'rgba(255,255,255,.2)', bgInteractive: '#111927', accentGreen: '#22C55E' } },
      '../../theme/ui': { ui: { minTouchTarget: 44 } },
      '../../assets/team-page/weekly-games-bg.jpg': 1,
      '../../assets/team-page/trophy.png': 2,
      '../../assets/team-page/jersey-back-bad-bunny.png': 6,
      '../../assets/team-page/jersey-back-first-general-london.png': 7,
      '../../assets/team-page/jersey-back-liuna.png': 8,
      '../../assets/team-page/jersey-back-fitzrays.png': 9,
      '../../assets/team-page/jersey-back-fallback.png': 10,
    },
  ).default;
  harness.mount(() => Component({ snapshot: sourceSnapshot, reduceTransparency, onOpenPlayer: (id: string) => openedPlayers.push(id), onOpenGame: (id: string) => openedGames.push(id) }));
  return { harness, openedPlayers, openedGames };
}

function findNodes(root: unknown, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(root)) return root.flatMap((child) => findNodes(child, predicate));
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as any;
  return [...(predicate(node) ? [node] : []), ...findNodes(node.props.children, predicate)];
}

function renderedStyle(node: any) {
  const style = typeof node?.props.style === 'function' ? node.props.style({ pressed: false, focused: false }) : node?.props.style;
  return flattenStyle(style);
}

describe('native Team public composition', () => {
  it('leaves the normal page composition transparent so the route atmosphere remains visible', () => {
    const normal = findNode(runtime(390).harness.output, (node) => node.props.testID === 'team-public-composition');
    assert.equal(flattenStyle(normal?.props.style).backgroundColor, 'transparent');

    const opaqueHarness = createHookHarness();
    const Component = compileCommonJs<{ default: (props: any) => unknown }>(
      new URL('../../src/screens/TeamScreen/TeamPublicPage.tsx', import.meta.url),
      {
        react: opaqueHarness.react,
        'react-native': {
          Image: 'Image', ImageBackground: 'ImageBackground', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
          StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: { position: 'absolute', inset: 0 } },
          useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
        },
        '@expo/vector-icons': { Ionicons: 'Ionicon', MaterialCommunityIcons: 'MaterialCommunityIcon' },
        'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
        '../../components/Avatar': (props: any) => createElement('Avatar', props),
        '../../components/LeagueLeadersPresentation': LeagueLeadersPresentationMock,
        '../../components/ScheduleMatchupCard': ScheduleMatchupCardMock,
        '../../components/TeamLogo': (props: any) => createElement('TeamLogo', props),
        '../../theme/colors': { __esModule: true, default: { primary: '#8B5CF6', primaryLight: '#A78BFA', bgBase: '#03070D', textPrimary: '#F7FBFF', textSecondary: '#A8B4C8', borderCard: 'rgba(255,255,255,.12)', glassStrokeStrong: 'rgba(255,255,255,.2)', bgInteractive: '#111927', accentGreen: '#22C55E' } },
        '../../theme/ui': { ui: { minTouchTarget: 44 } },
        '../../assets/team-page/weekly-games-bg.jpg': 1,
        '../../assets/team-page/trophy.png': 2,
        '../../assets/team-page/jersey-back-bad-bunny.png': 6,
        '../../assets/team-page/jersey-back-first-general-london.png': 7,
        '../../assets/team-page/jersey-back-liuna.png': 8,
        '../../assets/team-page/jersey-back-fitzrays.png': 9,
        '../../assets/team-page/jersey-back-fallback.png': 10,
      },
    ).default;
    opaqueHarness.mount(() => Component({ snapshot, reduceTransparency: true, onOpenPlayer: () => undefined, onOpenGame: () => undefined }));
    const opaque = findNode(opaqueHarness.output, (node) => node.props.testID === 'team-public-composition');
    assert.equal(flattenStyle(opaque?.props.style).backgroundColor, '#03070D');
  });

  it('uses opaque broadcast surfaces when reduced transparency is enabled', () => {
    const output = runtime(390, snapshot, true).harness.output;
    const championships = findNode(output, (node) => node.props.testID === 'team-broadcast-championships');
    const bridge = findNode(output, (node) => node.props.testID === 'team-next-game-bridge');

    assert.equal(flattenStyle(championships?.props.style).backgroundColor, '#05080F');
    assert.deepEqual(bridge?.props.colors, ['#07111F', '#241644', '#03070D']);
  });

  it('renders all five roster statistics with honest zero and unknown values and player navigation', () => {
    const source = { ...snapshot, roster: [roster[0],
      { ...roster[1], gamesPlayed: 0, goals: 0, assists: 0, points: 0, penaltyMinutes: 0 },
      { ...roster[2], gamesPlayed: null, goals: null, assists: null, points: null, penaltyMinutes: null },
    ] };
    const run = runtime(320, source);
    findNode(run.harness.output, (node) => node.props.testID === 'team-roster-list-toggle')?.props.onPress();
    const output = run.harness.render();
    const list = findNode(output, (node) => node.props.testID === 'team-roster-list');
    assert.ok(list);
    const labels = ['GP', 'G', 'A', 'PTS', 'PIM'];
    const keys = ['gamesPlayed', 'goals', 'assists', 'points', 'penaltyMinutes'];
    for (const [playerId, values] of [['p1', ['~11', '12', '13', '25', '4']], ['p2', ['~0', '0', '0', '0', '0']], ['p3', ['—', '—', '—', '—', '—']]] as const) {
      for (let i = 0; i < keys.length; i++) {
        const cell = findNode(list, (node) => node.props.testID === `team-roster-stat-${playerId}-${keys[i]}`);
        assert.equal(nodeText(cell), `${labels[i]}${values[i]}`);
      }
    }
    const current = findNode(list, (node) => node.props.testID === 'team-roster-player-p1');
    assert.match(current?.props.accessibilityLabel, /Matt Grossi.*11 games played.*12 goals.*13 assists.*25 points.*4 penalty minutes/i);
    assert.doesNotMatch(nodeText(run.harness.output), /~GP is estimated.*Needs review/i);
    current?.props.onPress();
    assert.deepEqual(run.openedPlayers, ['p1']);
  });

  it('renders conflicted, estimated, unknown, and verified-zero v2 metrics literally', () => {
    const m = (value: number | null, state: string, sources: string[]) => ({ value, state, sources });
    const sourcePlayer = { ...roster[0], gamesPlayed: null, penaltyMinutes: null, publicMetrics: {
      gamesPlayed: m(null, 'conflicted', ['attendance']), goals: m(15, 'recorded', ['skater_stats']),
      assists: m(10, 'reported', ['imported']), points: m(25, 'recorded', ['skater_stats']), penaltyMinutes: m(null, 'unknown', []),
    } };
    const verifiedZero = { ...roster[1], gamesPlayed: 11, penaltyMinutes: 0, publicMetrics: {
      gamesPlayed: m(11, 'estimated', ['roster_window']), goals: m(0, 'recorded', ['skater_stats']),
      assists: m(0, 'recorded', ['skater_stats']), points: m(0, 'recorded', ['skater_stats']), penaltyMinutes: m(0, 'verified', ['capture_confirmation']),
    } };
    const run = runtime(320, { ...snapshot, roster: [sourcePlayer, verifiedZero] });
    findNode(run.harness.output, (node) => node.props.testID === 'team-roster-list-toggle')?.props.onPress();
    const output = run.harness.render();
    assert.equal(nodeText(findNode(output, (node) => node.props.testID === 'team-roster-stat-p1-gamesPlayed')), 'GPNeeds review');
    assert.equal(nodeText(findNode(output, (node) => node.props.testID === 'team-roster-stat-p1-penaltyMinutes')), 'PIM—');
    assert.equal(nodeText(findNode(output, (node) => node.props.testID === 'team-roster-stat-p2-gamesPlayed')), 'GP~11');
    assert.equal(nodeText(findNode(output, (node) => node.props.testID === 'team-roster-stat-p2-penaltyMinutes')), 'PIM0');
    assert.match(findNode(output, (node) => node.props.testID === 'team-roster-player-p1')?.props.accessibilityLabel, /Needs review.*Conflicting records need review.*Not recorded/i);
    const reviewCell = findNode(output, (node) => node.props.testID === 'team-roster-stat-p1-gamesPlayed');
    assert.equal(flattenStyle(reviewCell?.props.style).flexBasis, '100%', 'full conflict status needs a readable row');
  });

  it('exposes fact-bearing game/player labels and authoritative live/final scores without inventing jersey zero', () => {
    const statuses = ['in_progress', 'completed'];
    for (const status of statuses) {
      const game = { ...games[3], status, homeScore: 4, awayScore: 2 };
      const run = runtime(320, { ...snapshot, nextGame: game, games: [game], collapsedSchedule: [game], roster: [{ ...roster[0], jerseyNumber: null }] });
      const output = run.harness.output;
      const next = findNode(output, (node) => node.props.testID === 'team-next-game-card');
      assert.match(next?.props.accessibilityLabel, /First General London.*London Eco Metal.*Mar.*4.*3:00.*Next One/i);
      const row = findNode(output, (node) => node.props.testID === 'schedule-matchup-card-g3');
      assert.match(row?.props.accessibilityLabel, /First General London.*London Eco Metal.*First General London 2, London Eco Metal 4/i);
      assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'schedule-compact-score')), '2–4');
      const player = findNode(output, (node) => node.props.testID === 'team-leader-row-p1');
      assert.match(player?.props.accessibilityLabel, /Matt Grossi.*25 points/i);
      const jersey = findNode(output, (node) => node.props.testID === 'team-roster-player-p1');
      assert.match(jersey?.props.accessibilityLabel, /jersey number unknown/i);
      assert.doesNotMatch(jersey?.props.accessibilityLabel, /#0|number 0/);
      next?.props.onPress(); row?.props.onPress(); player?.props.onPress();
      assert.deepEqual(run.openedGames, ['g3', 'g3']); assert.deepEqual(run.openedPlayers, ['p1']);
    }
  });

  it('retains both teams strengths and weaknesses plus goalie GP/GAA units', () => {
    const output = runtime(320, { ...snapshot, rivals: [{ ...snapshot.rivals[0],
      team: { ...viewedSide, strength: 'team strength', weakness: 'team weakness', tendy: { name: 'Home Goalie', gamesPlayed: 11, gamesPlayedProvenance: 'estimated', goalsAgainstAverage: 4.09, goalsAgainstAverageProvenance: 'estimated' } },
      rival: { ...snapshot.rivals[0].rival, strength: 'rival strength', weakness: 'rival weakness', tendy: { name: 'Away Goalie', gamesPlayed: 9, gamesPlayedProvenance: 'estimated', goalsAgainstAverage: 4.91, goalsAgainstAverageProvenance: 'estimated' } },
    }] }).harness.output;
    const text = nodeText(findNode(output, (node) => node.props.testID === 'team-rivals-section'));
    for (const trait of ['TEAM STRENGTH', 'TEAM WEAKNESS', 'RIVAL STRENGTH', 'RIVAL WEAKNESS']) assert.ok(text.includes(trait), trait);
    assert.match(text, /Home Goalie~11 GP • ~4.09 GAA/);
    assert.match(text, /Away Goalie~9 GP • ~4.91 GAA/);
    assert.match(text, /~Goalie GP\/GAA is derived.*may be incomplete/i);
  });

  it('renders the approved C broadcast hierarchy from dynamic team facts with a complete crest at phone widths', () => {
    const source = {
      ...snapshot,
      team: { ...snapshot.team, id: 'aurora', name: 'Aurora Wolves', logoUrl: 'canonical-aurora.webp', primaryColor: '#6046A8' },
      rank: 4,
      record: '3-4-1',
      streak: 'T2',
      hero: { winPercentage: 3 / 8 },
      standing: { ...snapshot.standing, teamId: 'aurora', teamName: 'Aurora Wolves', logoUrl: 'canonical-aurora.webp', goalsFor: 17, goalsAgainst: 21, goalDifferential: -4 },
      championships: { count: 2, latestTitleSeasonName: 'Summer 2026', latestTitleLabel: '2026', titleSeasonIds: ['summer-2026', 'winter-2024'] },
    };

    for (const width of [390, 320]) {
      const output = runtime(width, source).harness.output;
      const hero = findNode(output, (node) => node.props.testID === 'team-public-hero');
      assert.ok(hero);
      assert.equal(findNode(hero, (node) => node.props.testID === 'team-broadcast-name-primary'), undefined);
      assert.equal(findNode(hero, (node) => node.props.testID === 'team-broadcast-name-secondary'), undefined);
      assert.equal(nodeText(findNode(hero, (node) => node.props.testID === 'team-hero-record')), '3-4-1');
      assert.match(nodeText(findNode(hero, (node) => node.props.testID === 'team-broadcast-callouts')), /RANK#4STREAKT2WIN PERCENTAGE38%/);
      const ticker = findNode(hero, (node) => node.props.testID === 'team-broadcast-ticker');
      assert.equal(ticker?.type, 'LinearGradient');
      assert.deepEqual(ticker?.props.colors, ['#6046A8', '#D9B64C']);
      assert.match(nodeText(ticker), /GF17GA21DIFF-4WIN38%/);
      assert.ok(findNode(hero, (node) => node.props.testID === 'team-broadcast-subject-frame'));
      assert.ok(findNode(hero, (node) => node.props.testID === 'team-hero-transition'));
      const logoStage = findNode(hero, (node) => node.props.testID === 'team-broadcast-logo-stage');
      const logo = findNode(logoStage, (node) => node.type === 'TeamLogo');
      assert.deepEqual(
        [logo?.props.teamId, logo?.props.logoUrl, logo?.props.teamName, logo?.props.transparentBacking],
        ['aurora', 'canonical-aurora.webp', 'Aurora Wolves', true],
      );
      assert.equal(logo?.props.size, width === 320 ? 184 : 230);
      assert.equal(flattenStyle(logoStage?.props.style).overflow, 'visible');
      const trophy = findNode(hero, (node) => node.props.testID === 'team-broadcast-championships');
      assert.equal(trophy?.props.accessibilityLabel, '2 championships');
      assert.ok(findNode(trophy, (node) => node.type === 'Image' && node.props.source === 2 && node.props.resizeMode === 'contain'));
      assert.match(nodeText(trophy), /x2CHAMPIONSHIPS/);
      assert.match(nodeText(hero), /LATEST CHAMPIONSHIPSummer 2026 \(2026\)/);
      assert.match(hero?.props.accessibilityLabel, /Aurora Wolves.*record 3-4-1.*rank 4.*2 championships/i);
      assert.equal(findNodes(hero, (node) => node.props.testID === 'team-hero-pill').length, 0);

      assert.ok(findNode(output, (node) => node.props.testID === 'team-league-leaders'));
      const rosterSection = findNode(output, (node) => node.props.testID === 'team-roster-section');
      const heading = findNode(rosterSection, (node) => node.type === 'Text' && nodeText(node) === 'Next Game Roster');
      assert.equal(flattenStyle(heading?.props.style).flexShrink, 1);
      for (const id of ['team-roster-jersey-toggle', 'team-roster-list-toggle']) {
        const style = renderedStyle(findNode(output, (node) => node.props.testID === id));
        assert.ok((style.width ?? style.minWidth) >= 44); assert.ok((style.height ?? style.minHeight) >= 44);
      }
    }
  });

  it('preserves unknown broadcast facts as dashes and omits unavailable latest-title copy', () => {
    const output = runtime(320, {
      ...snapshot,
      standing: null,
      rank: null,
      record: null,
      streak: null,
      hero: { winPercentage: null },
      championships: { count: null, latestTitleSeasonName: null, latestTitleLabel: null, titleSeasonIds: [] },
    }).harness.output;
    const hero = findNode(output, (node) => node.props.testID === 'team-public-hero');

    assert.equal(nodeText(findNode(hero, (node) => node.props.testID === 'team-hero-record')), '—');
    assert.match(nodeText(findNode(hero, (node) => node.props.testID === 'team-broadcast-callouts')), /RANK—STREAK—WIN PERCENTAGE—/);
    assert.match(nodeText(findNode(hero, (node) => node.props.testID === 'team-broadcast-ticker')), /GF—GA—DIFF—WIN—/);
    const championships = findNode(hero, (node) => node.props.testID === 'team-broadcast-championships');
    assert.equal(championships?.props.accessibilityLabel, 'Championship count unavailable');
    assert.match(nodeText(championships), /x—CHAMPIONSHIPS/);
    assert.equal(findNode(hero, (node) => node.props.testID === 'team-broadcast-latest-championship'), undefined);
    assert.match(hero?.props.accessibilityLabel, /record unavailable.*rank unavailable.*championship count unavailable/i);
  });

  it('uses the shared League Leaders defaults without league-wide navigation', () => {
    const output = runtime(390, { ...snapshot, team: { ...snapshot.team, primaryColor: '#6046A8' }, league: { ...snapshot.league, primaryColor: '#1F6A44' } }).harness.output;
    const leaders = findNode(output, (node) => node.props.testID === 'team-league-leaders');
    assert.equal(leaders?.props.metric, 'points');
    assert.equal(leaders?.props.testIDPrefix, 'team');
    assert.equal(leaders?.props.showAllStats, false);
  });

  it('uses the Hockey Life fallback when team and league accents are invalid without tinting fact text', () => {
    const output = runtime(390, {
      ...snapshot,
      team: { ...snapshot.team, primaryColor: 'purple' },
      league: { ...snapshot.league, primaryColor: null },
    }).harness.output;
    const hero = findNode(output, (node) => node.props.testID === 'team-public-hero');
    const accentBlade = findNode(hero, (node) => node.props.testID === 'team-broadcast-accent');
    assert.equal(flattenStyle(accentBlade?.props.style).backgroundColor, '#03299B');
    for (const value of findNodes(hero, (node) => node.props.testID === 'team-broadcast-fact-value')) {
      assert.equal(flattenStyle(value.props.style).color, '#F8FBFF');
    }
  });

  it('keeps the shared League Leaders contract independent of malformed Team accent fallbacks', () => {
    const output = runtime(390, { ...snapshot, team: { ...snapshot.team, primaryColor: 'purple' }, league: { ...snapshot.league, primaryColor: '#1F6A44' } }).harness.output;
    const leaders = findNode(output, (node) => node.props.testID === 'team-league-leaders');
    assert.equal(leaders?.props.metric, 'points');
    assert.deepEqual(leaders?.props.leaders.map((row: any) => row.team_id), ['team-a', 'team-a', 'team-a']);
  });

  it('treats jersey lettering as fixed artwork while the button exposes the complete identity', () => {
    const output = runtime(320).harness.output;
    const jersey = findNode(output, (node) => node.props.testID === 'team-roster-player-p1');
    assert.match(jersey?.props.accessibilityLabel, /Matt Grossi.*jersey number 96/);
    for (const text of findNodes(jersey, (node) => node.type === 'Text')) assert.equal(text.props.allowFontScaling, false);
  });

  it('selects the approved static jersey by canonical team ID and optically centers dynamic lettering', () => {
    const source = {
      ...snapshot,
      team: { ...snapshot.team, id: '093f611c-0cdc-4509-afde-9c661b5833c9', name: 'Renamed Club', slug: 'renamed-club' },
      roster: [{ ...roster[0], name: 'Alex Longsurnamerson', jerseyNumber: 123 }],
    };
    const output = runtime(320, source).harness.output;
    const jersey = findNode(output, (node) => node.props.testID === 'team-roster-player-p1');
    const art = findNode(jersey, (node) => node.props.testID === 'team-roster-art-p1');
    const name = findNode(jersey, (node) => node.props.testID === 'team-roster-name-p1');
    const number = findNode(jersey, (node) => node.props.testID === 'team-roster-number-p1');

    assert.ok(art, 'the fitted Variation A jersey is rendered as one static native image');
    assert.equal(art?.props.source, 6, 'canonical team ID wins over changed display text');
    assert.equal(findNodes(jersey, (node) => node.type === 'Image').length, 1);
    assert.equal(nodeText(name), 'LONGSURNAMERSON', 'the complete surname is rendered rather than truncated');
    assert.equal(nodeText(number), '123');
    const nameStyle = renderedStyle(name);
    assert.ok(nameStyle.fontSize >= 5, 'long surname remains legible at compact width');
    assert.deepEqual(nameStyle.transform, [{ scaleX: 0.72 }], 'compact long surname uses an explicit visual fit instead of browser-unsupported adjustsFontSizeToFit');
    assert.deepEqual([nameStyle.left, nameStyle.right], ['25%', '25%'], 'long-name layout provides enough pre-transform width to avoid ellipsis');
    assert.equal(name?.props.numberOfLines, 1, 'surname remains a single raised-nameplate line');
    assert.equal(name?.props.adjustsFontSizeToFit, true, 'native text fitting preserves surnames longer than the visual fixture');
    assert.equal(name?.props.minimumFontScale, 0.5);
    assert.ok(renderedStyle(jersey).minHeight >= 44, 'player navigation remains a 44-point Pressable');
    const numberStyle = renderedStyle(number);
    assert.deepEqual([numberStyle.left, numberStyle.right, numberStyle.textAlign], [0, 0, 'center']);
    assert.deepEqual(numberStyle.transform, [{ translateX: -1.5 }], 'italic numeral receives the approved left optical correction');
  });

  it('resolves every live team ID, canonical identity, and legacy alias to one jersey variant with a safe fallback', () => {
    const identities = [
      ['bad-bunny', '093f611c-0cdc-4509-afde-9c661b5833c9', 'Bad Bunny', 'bad-bunny', 'London Eco Metal', 'london-eco-metal'],
      ['first-general-london', '453d62d9-80b4-4f26-a2ee-861f0c063402', 'First General London', 'first-general-london', null, null],
      ['liuna', '346833e0-2780-492d-86db-94df0b0cb3e1', 'Liuna', 'liuna', 'FitzRays Premier', 'fitzrays-premier'],
      ['fitzrays', 'e4be829d-952c-4531-8376-215907fab3b7', 'Fitzrays', 'fitzrays', 'FitzRays Flyers', 'fitzrays-flyers'],
    ] as const;
    const expectedSources = { 'bad-bunny': 6, 'first-general-london': 7, liuna: 8, fitzrays: 9 } as const;

    for (const [variant, id, name, slug, legacyName, legacySlug] of identities) {
      assert.equal(resolveTeamRosterJerseyVariant({ id, name: 'Renamed Club', slug: 'renamed-club' }), variant, `${variant} ID`);
      assert.equal(resolveTeamRosterJerseyVariant({ id: 'unknown', name, slug: null }), variant, `${variant} canonical name`);
      assert.equal(resolveTeamRosterJerseyVariant({ id: 'unknown', name: 'Renamed Club', slug }), variant, `${variant} canonical slug`);
      if (legacyName) assert.equal(resolveTeamRosterJerseyVariant({ id: 'unknown', name: legacyName, slug: null }), variant, `${variant} legacy name`);
      if (legacySlug) assert.equal(resolveTeamRosterJerseyVariant({ id: 'unknown', name: 'Renamed Club', slug: legacySlug }), variant, `${variant} legacy slug`);

      const output = runtime(390, { ...snapshot, team: { ...snapshot.team, id, name: 'Renamed Club', slug: 'renamed-club' } }).harness.output;
      assert.equal(findNode(output, (node) => node.props.testID === 'team-roster-art-p1')?.props.source, expectedSources[variant]);
    }

    assert.equal(resolveTeamRosterJerseyVariant({ id: 'unknown', name: 'Unknown Club', slug: 'unknown-club' }), 'fallback');
    const fallback = runtime(390, { ...snapshot, team: { ...snapshot.team, id: 'unknown', name: 'Unknown Club', slug: 'unknown-club' } }).harness.output;
    assert.equal(findNode(fallback, (node) => node.props.testID === 'team-roster-art-p1')?.props.source, 10);
  });

  it('dissolves the broadcast atmosphere into the preserved Next Game section instead of a hard cutoff', () => {
    const output = runtime(390).harness.output;
    const heroTransition = findNode(output, (node) => node.props.testID === 'team-hero-transition');
    const nextSection = findNode(output, (node) => node.props.testID === 'team-next-game-section');
    const nextBridge = findNode(nextSection, (node) => node.props.testID === 'team-next-game-bridge');

    assert.ok(heroTransition);
    assert.ok(nextBridge);
    assert.ok(flattenStyle(nextSection?.props.style).marginTop < 0);
    assert.ok(flattenStyle(nextSection?.props.style).paddingTop >= 48);
    assert.deepEqual(nextBridge?.props.colors, ['rgba(7,17,31,0)', 'rgba(72,34,126,.22)', 'rgba(7,17,31,0)']);
    const pageText = nodeText(output);
    assert.ok(pageText.indexOf('LATEST CHAMPIONSHIP') < pageText.indexOf('Next Game'));
  });

  it('renders the approved section order and public hero hierarchy', () => {
    const output = runtime().harness.output;
    const text = nodeText(output);
    const order = ['7-2-2', 'Next Game', 'League Leaders', 'Schedule', 'Next Game Roster', 'Rivals', 'Captain Contact'].map((label) => text.indexOf(label));
    assert.ok(order.every((index) => index >= 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(findNode(output, (node) => node.props.testID === 'team-public-hero'));
    assert.match(text, /RANK#2STREAKW1WIN PERCENTAGE64%x1CHAMPIONSHIPSGF34GA22DIFF\+12WIN64%/);
    assert.match(text, /LATEST CHAMPIONSHIPFall 2025 \(2025\)/);
    assert.doesNotMatch(text, /FEATURED PARTNERS|Rink Shop/);
    assert.equal(findNode(output, (node) => node.props.testID === 'team-partners'), undefined);
  });

  it('switches the shared League Leaders metrics and preserves Team player navigation', () => {
    const run = runtime();
    assert.equal(findNode(run.harness.output, (node) => node.props.testID === 'team-leaders-tab-points')?.props.accessibilityRole, 'tab');
    assert.deepEqual(findNode(run.harness.output, (node) => node.props.testID === 'team-leaders-tab-points')?.props.accessibilityState, { selected: true, disabled: false });
    assert.deepEqual(findNode(run.harness.output, (node) => node.props.testID === 'team-leaders-tab-gaa')?.props.accessibilityState, { selected: false, disabled: false });
    findNode(run.harness.output, (node) => node.props.testID === 'team-leaders-tab-goals')?.props.onPress();
    const output = run.harness.render();
    assert.deepEqual(findNode(output, (node) => node.props.testID === 'team-leaders-tab-points')?.props.accessibilityState, { selected: false, disabled: false });
    assert.deepEqual(findNode(output, (node) => node.props.testID === 'team-leaders-tab-goals')?.props.accessibilityState, { selected: true, disabled: false });
    const row = findNode(output, (node) => node.props.testID === 'team-leader-row-p1');
    assert.match(row?.props.accessibilityLabel, /Matt Grossi.*12 goals/i);
    row?.props.onPress();
    assert.deepEqual(run.openedPlayers, ['p1']);
  });

  it('caps the canonical schedule at two results plus the next game and preserves roster/game navigation', () => {
    const run = runtime(320);
    let output = run.harness.output;
    const schedule = findNode(output, (node) => node.props.testID === 'team-schedule-section');
    assert.deepEqual(findNodes(schedule, (node) => /^schedule-matchup-card-g\d$/.test(node.props.testID ?? '')).map((node) => node.props.testID), [
      'schedule-matchup-card-g1', 'schedule-matchup-card-g2', 'schedule-matchup-card-g3',
    ]);
    assert.equal(findNode(output, (node) => node.props.testID === 'team-schedule-toggle'), undefined);
    findNode(output, (node) => node.props.testID === 'team-roster-list-toggle')?.props.onPress();
    output = run.harness.render();
    assert.ok(findNode(output, (node) => node.props.testID === 'team-roster-list'));
    findNode(output, (node) => node.props.testID === 'team-roster-player-p1')?.props.onPress();
    findNode(output, (node) => node.props.testID === 'schedule-matchup-card-g3')?.props.onPress();
    assert.deepEqual(run.openedPlayers, ['p1']);
    assert.deepEqual(run.openedGames, ['g3']);
  });

  it('cycles the full rivals carousel and leaves unknown goalie data unknown', () => {
    const run = runtime();
    assert.match(nodeText(findNode(run.harness.output, (node) => node.props.testID === 'team-rivals-section')), /First General London.*TENDYNo data—/);
    findNode(run.harness.output, (node) => node.props.testID === 'team-rival-next')?.props.onPress();
    const output = run.harness.render();
    assert.match(nodeText(findNode(output, (node) => node.props.testID === 'team-rivals-section')), /Purple Cobras/);
    assert.equal(findNode(output, (node) => node.props.testID === 'team-rival-position')?.props.accessibilityValue.text, '2 of 2');
  });

  it('formats matchup and schedule facts in the public league timezone even when the device is UTC', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const torontoGame = { ...games[3], scheduledAt: '2026-09-17T14:30:00Z' };
      const output = runtime(390, {
        ...snapshot,
        games: [torontoGame],
        collapsedSchedule: [torontoGame],
        nextGame: torontoGame,
      }).harness.output;
      const nextGameText = nodeText(findNode(output, (node) => node.props.testID === 'team-next-game-section'));
      const scheduleText = nodeText(findNode(output, (node) => node.props.testID === 'team-schedule-section'));
      assert.match(nextGameText, /10:30/);
      assert.match(scheduleText, /10:30/);
      assert.doesNotMatch(`${nextGameText}${scheduleText}`, /2:30/);
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it('keeps spares out of fallback jersey slots while preserving every current member in list view', () => {
    const makePlayer = (playerId: string, position: string, playerType: string, isGoalie = false) => ({
      ...roster[0], rosterId: `r-${playerId}`, playerId, name: playerId, jerseyNumber: null, position, playerType, isGoalie, leadershipRole: null,
    });
    const regulars = [
      ...Array.from({ length: 6 }, (_, index) => makePlayer(`forward-${index}`, 'forward', 'regular')),
      ...Array.from({ length: 4 }, (_, index) => makePlayer(`defence-${index}`, 'defense', 'regular')),
      makePlayer('goalie-0', 'Goalie', 'regular', true),
    ];
    const spares = [makePlayer('spare-forward', 'forward', 'sub'), makePlayer('spare-defence', 'defense', 'part_time')];
    const run = runtime(390, { ...snapshot, roster: [...regulars, ...spares], publishedLineup: null, acceptedSubstitutions: [] });
    const jerseys = findNode(run.harness.output, (node) => node.props.testID === 'team-roster-jerseys');
    const jerseyPlayers = findNodes(jerseys, (node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('team-roster-player-'));
    assert.equal(jerseyPlayers.length, 11);
    assert.equal(jerseyPlayers.some((node) => /spare-/.test(node.props.testID)), false);

    findNode(run.harness.output, (node) => node.props.testID === 'team-roster-list-toggle')?.props.onPress();
    const list = findNode(run.harness.render(), (node) => node.props.testID === 'team-roster-list');
    assert.equal(findNodes(list, (node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('team-roster-player-')).length, 13);
  });

  it('filters published placements to current members or accepted replacements and preserves null jersey numbers', () => {
    const source = {
      ...snapshot,
      roster: [roster[0]],
      acceptedSubstitutions: [{ id: 'invite-1', subPlayerId: 'accepted-sub', subPlayerName: 'Accepted Baker', replacedPlayerId: 'p1', replacedPlayerName: 'Matt Grossi' }],
      publishedLineup: {
        status: 'published', game_id: games[3].id, team_id: 'team-a',
        layout_json: {
          roster: [
            { playerId: 'p1', fullName: 'Stale Matt', jerseyNumber: null, position: 'C' },
            { playerId: 'accepted-sub', fullName: 'Accepted Baker', jerseyNumber: null, position: 'C', isSub: true },
            { playerId: 'ended-player', fullName: 'Ended Player', jerseyNumber: 8, position: 'D' },
            { playerId: 'rogue-player', fullName: 'Rogue Player', jerseyNumber: 9, position: 'G' },
          ],
          placedPlayers: [
            { playerId: 'p1', x: 30, y: 22 },
            { playerId: 'accepted-sub', x: 70, y: 22 },
            { playerId: 'ended-player', x: 35, y: 58 },
            { playerId: 'rogue-player', x: 50, y: 90 },
          ],
        },
      },
    };
    const output = runtime(390, source).harness.output;
    const jerseys = findNode(output, (node) => node.props.testID === 'team-roster-jerseys');
    const ids = findNodes(jerseys, (node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('team-roster-player-')).map((node) => node.props.testID);
    assert.deepEqual(ids, ['team-roster-player-p1', 'team-roster-player-accepted-sub']);
    const sectionText = nodeText(findNode(output, (node) => node.props.testID === 'team-roster-section'));
    const substitutions = findNode(output, (node) => node.props.testID === 'team-substitution-notes');
    assert.match(nodeText(substitutions), /Accepted Baker subbing in for Matt Grossi/);
    assert.ok(sectionText.indexOf('Accepted Baker subbing in') > sectionText.indexOf('GROSSI'), 'accepted subs follow the jersey board');
    assert.ok(findNode(substitutions, (node) => node.type === 'MaterialCommunityIcon' && node.props.name === 'submarine'));
    assert.doesNotMatch(nodeText(substitutions), /🥖/);
    const jerseyText = nodeText(jerseys);
    assert.match(jerseyText, /96/);
    assert.match(jerseyText, /00/);
    assert.doesNotMatch(jerseyText, /(^|\D)0(\D|$)/);
    assert.equal(findNodes(jerseys, (node) => /^team-lineup-forward-slot-\d+$/.test(node.props.testID ?? '')).length, 6);
    assert.equal(findNodes(jerseys, (node) => /^team-lineup-defence-slot-\d+$/.test(node.props.testID ?? '')).length, 4);
    assert.equal(findNodes(jerseys, (node) => node.props.testID === 'team-lineup-goalie-slot-0').length, 1);
    assert.equal(findNode(jerseys, (node) => node.props.testID === 'team-lineup-forward-slot-1')?.props.accessibilityLabel, 'Empty forward slot 2');
  });

  it('keeps a valid published empty lineup empty and renders the full 6F/4D/1G board', () => {
    const output = runtime(390, { ...snapshot, publishedLineup: { status: 'published', layout_json: { roster: [], placedPlayers: [] } } }).harness.output;
    const section = findNode(output, (node) => node.props.testID === 'team-roster-section');
    assert.doesNotMatch(nodeText(section), /Published next-game lineup|~ indicates an estimate|Needs review.*conflicting records/i);
    assert.doesNotMatch(nodeText(section), /GROSSI|MOORE|KOWLES/);
    assert.equal(findNodes(section, (node) => /^team-lineup-forward-slot-\d+$/.test(node.props.testID ?? '')).length, 6);
    assert.equal(findNodes(section, (node) => /^team-lineup-defence-slot-\d+$/.test(node.props.testID ?? '')).length, 4);
    assert.equal(findNodes(section, (node) => node.props.testID === 'team-lineup-goalie-slot-0').length, 1);
  });

  it('gives the jersey board breathing room at 320 and 390 widths without hiding truthful facts', () => {
    for (const width of [320, 390]) {
      const output = runtime(width).harness.output;
      const board = findNode(output, (node) => node.props.testID === 'team-roster-jerseys');
      const style = flattenStyle(board?.props.style);
      assert.ok(style.paddingHorizontal >= 8);
      assert.ok(style.paddingVertical >= 12);
      assert.doesNotMatch(nodeText(findNode(output, (node) => node.props.testID === 'team-leaders-section')), /~GP is estimated/);
    }
  });

  it('passes the Team-only compact card presentation, removes date headers and visible names/venues, and omits an empty Schedule section', () => {
    const output = runtime(390).harness.output;
    const schedule = findNode(output, (node) => node.props.testID === 'team-schedule-section');
    const row = findNode(schedule, (node) => node.props.testID === 'schedule-matchup-card-g3');
    assert.equal(row?.props.compact, true);
    assert.equal(findNodes(schedule, (node) => node.props.accessibilityRole === 'header').length, 0);
    assert.doesNotMatch(nodeText(row), /First General London|London Eco Metal|Next One/i);
    assert.match(row?.props.accessibilityLabel, /First General London.*London Eco Metal.*Next One/i);
    const rowLogos = findNodes(row, (node) => node.type === 'TeamLogo');
    assert.deepEqual(rowLogos.map((node) => node.props.teamId), ['team-b', 'team-a']);
    assert.ok(rowLogos.every((node) => node.props.transparentBacking === true));
    assert.equal(findNodes(findNode(row, (node) => node.props.testID === 'schedule-compact-matchup-row'), (node) => node.type === 'TeamLogo').length, 2);
    const empty = runtime(390, { ...snapshot, games: [], collapsedSchedule: [], nextGame: null }).harness.output;
    assert.equal(findNode(empty, (node) => node.props.testID === 'team-schedule-section'), undefined);
  });

  it('uses role-specific goalie columns and preserves full metric state text', () => {
    const metric = (value: number | null, state: string) => ({ value, state, sources: state === 'unknown' ? [] : ['goalie_stats'] });
    const goalie = { ...roster[0], playerId: 'goalie', name: 'Goalie One', position: 'G', isGoalie: true, publicGoalieMetrics: {
      gamesPlayed: metric(4, 'recorded'), wins: metric(2, 'recorded'), losses: metric(1, 'recorded'), saves: metric(80, 'recorded'),
      goalsAgainst: metric(10, 'recorded'), savePercentage: metric(.123, 'conflicted'), goalsAgainstAverage: metric(null, 'conflicted'), shutouts: metric(null, 'unknown'),
    } };
    const run = runtime(390, { ...snapshot, roster: [goalie] });
    findNode(run.harness.output, (node) => node.props.testID === 'team-roster-list-toggle')?.props.onPress();
    const row = findNode(run.harness.render(), (node) => node.props.testID === 'team-roster-player-goalie');
    assert.match(nodeText(row), /GP4W2L1GAANeeds reviewSV%Needs reviewSO—/);
    assert.match(row?.props.accessibilityLabel, /goals against average Needs review.*Conflicting records need review.*shutouts —.*Not recorded/i);
    assert.doesNotMatch(nodeText(row), /PTS|PIM/);
    const saveCell = findNode(row, (node) => node.props.testID === 'team-roster-stat-goalie-savePercentage');
    assert.equal(flattenStyle(saveCell?.props.style).flexBasis, '100%');
  });

  it('uses goalie role for six truthful columns even when canonical goalie metrics are absent', () => {
    const goalie = { ...roster[0], playerId: 'unknown-goalie', name: 'Unknown Goalie', position: 'G', isGoalie: true, publicGoalieMetrics: null };
    const run = runtime(320, { ...snapshot, roster: [goalie] });
    findNode(run.harness.output, (node) => node.props.testID === 'team-roster-list-toggle')?.props.onPress();
    const row = findNode(run.harness.render(), (node) => node.props.testID === 'team-roster-player-unknown-goalie');
    assert.match(nodeText(row), /GP—W—L—GAA—SV%—SO—/);
    assert.doesNotMatch(nodeText(row), /PTS|PIM/);
    const ordinaryCell = findNode(row, (node) => node.props.testID === 'team-roster-stat-unknown-goalie-savePercentage');
    assert.equal(flattenStyle(ordinaryCell?.props.style).flexBasis, '30%');
  });

  it('always renders trophy artwork and the exact championship count including zero', () => {
    const output = runtime(390, { ...snapshot, championships: { count: 0, latestTitleSeasonName: null, latestTitleLabel: null, titleSeasonIds: [] } }).harness.output;
    const hero = findNode(output, (node) => node.props.testID === 'team-public-hero');
    assert.ok(findNode(hero, (node) => node.type === 'Image' && node.props.source === 2));
    assert.match(nodeText(hero), /x0/);
  });

  it('uses tab semantics for the mutually exclusive roster views and keeps the compact canonical matchup visible', () => {
    const run = runtime(320);
    const jerseyToggle = findNode(run.harness.output, (node) => node.props.testID === 'team-roster-jersey-toggle');
    const statsToggle = findNode(run.harness.output, (node) => node.props.testID === 'team-roster-list-toggle');
    assert.equal(jerseyToggle?.props.accessibilityRole, 'tab');
    assert.equal(statsToggle?.props.accessibilityRole, 'tab');
    assert.deepEqual(jerseyToggle?.props.accessibilityState, { selected: true, disabled: false });
    assert.deepEqual(statsToggle?.props.accessibilityState, { selected: false, disabled: false });
    statsToggle?.props.onPress();
    const changed = run.harness.render();
    assert.deepEqual(findNode(changed, (node) => node.props.testID === 'team-roster-jersey-toggle')?.props.accessibilityState, { selected: false, disabled: false });
    assert.deepEqual(findNode(changed, (node) => node.props.testID === 'team-roster-list-toggle')?.props.accessibilityState, { selected: true, disabled: false });
    const schedule = findNode(changed, (node) => node.props.testID === 'schedule-matchup-card-g3');
    assert.equal(schedule?.props.compact, true);
    assert.equal(findNodes(schedule, (node) => node.type === 'TeamLogo').length, 2);
  });

  it('emits explicit true and false selection state for roster tabs', () => {
    const run = runtime(320);
    const state = (testID: string) => findNode(run.harness.output, (candidate) => candidate.props.testID === testID)?.props.accessibilityState;
    assert.deepEqual(state('team-roster-jersey-toggle'), { selected: true, disabled: false });
    assert.deepEqual(state('team-roster-list-toggle'), { selected: false, disabled: false });

    findNode(run.harness.output, (node) => node.props.testID === 'team-roster-list-toggle')?.props.onPress();
    run.harness.render();
    assert.deepEqual(state('team-roster-jersey-toggle'), { selected: false, disabled: false });
    assert.deepEqual(state('team-roster-list-toggle'), { selected: true, disabled: false });
  });
});
