/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { inflateSync } from 'node:zlib';

function pngPixels(layer: string) {
  const bytes = readFileSync(new NodeURL(`../../src/assets/team-page/jersey-${layer}.png`, import.meta.url));
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 6, '8-bit RGBA tint mask');
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
  return { width, height, alpha: (x: number, y: number) => pixels[(y * width + x) * 4 + 3], pixels };
}

it('ships transparent jersey silhouette, stripe and detail masks, not opaque rectangles', () => {
  for (const layer of ['primary', 'secondary', 'detail']) {
    const image = pngPixels(layer);
    assert.deepEqual([image.width, image.height], [560, 480]);
    assert.equal(image.alpha(0, 0), 0, `${layer}: transparent corner`);
    assert.equal(image.alpha(559, 479), 0);
    const alpha = [...image.pixels].filter((_, index) => index % 4 === 3);
    assert.ok(alpha.some((value) => value === 255), `${layer}: visible paint`);
    assert.ok(alpha.filter((value) => value > 0).length < alpha.length * .65);
  }
  assert.equal(pngPixels('primary').alpha(280, 240), 255, 'solid torso');
  assert.equal(pngPixels('secondary').alpha(280, 240), 0, 'stripe leaves torso open');
  for (const [x, y] of [[80, 348], [480, 348], [280, 440], [280, 126]]) {
    assert.equal(pngPixels('secondary').alpha(x, y), 255, `stripe at ${x},${y}`);
  }
  assert.equal(pngPixels('detail').alpha(280, 240), 0, 'detail cannot cover tint');
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
  games, collapsedSchedule: [games[1], games[2], games[3], games[4]], nextGame: games[3],
  championships: { count: 1, latestTitleSeasonName: 'Fall 2025', latestTitleLabel: '2025', titleSeasonIds: ['old'] }, captain: roster[0], publishedLineup: null, acceptedSubstitutions: [], sponsors: [],
  rivals: [
    { team: viewedSide, rival: { ...viewedSide, ...team('team-b', 'First General London', '#2454A3'), overallRecord: '6-4-1', goalsFor: 30, goalsAgainst: 28, goalDifferential: 2, sniper: { name: 'Rival Sniper', goals: 9 }, playmaker: { name: 'Rival Passer', assists: 10 } }, h2hRecord: '2-1', h2hRecordRival: '1-2', gamesPlayed: 3 },
    { team: viewedSide, rival: { ...viewedSide, ...team('team-c', 'Purple Cobras', '#7C3AED'), overallRecord: '5-5-1', goalsFor: 26, goalsAgainst: 26, goalDifferential: 0 }, h2hRecord: '1-1', h2hRecordRival: '1-1', gamesPlayed: 2 },
  ],
};

function runtime(width = 390, sourceSnapshot: any = snapshot) {
  const harness = createHookHarness();
  const openedPlayers: string[] = [];
  const openedGames: string[] = [];
  const Component = compileCommonJs<{ default: (props: any) => unknown }>(
    new URL('../../src/screens/TeamScreen/TeamPublicPage.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        Image: 'Image', ImageBackground: 'ImageBackground', Pressable: 'Pressable', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: { position: 'absolute', inset: 0 } },
        useWindowDimensions: () => ({ width, height: 844 }),
      },
      '@expo/vector-icons': { Ionicons: 'Ionicon' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      '../../components/Avatar': (props: any) => createElement('Avatar', props),
      '../../components/TeamLogo': (props: any) => createElement('TeamLogo', props),
      '../../theme/colors': { __esModule: true, default: { primary: '#22D3EE', bgBase: '#03070D', textPrimary: '#F7FBFF', textSecondary: '#A8B4C8', borderCard: 'rgba(255,255,255,.12)', bgInteractive: '#111927', accentGreen: '#22C55E' } },
      '../../theme/ui': { ui: { minTouchTarget: 44 } },
      '../../assets/team-page/weekly-games-bg.jpg': 1,
      '../../assets/team-page/trophy.png': 2,
      '../../assets/team-page/jersey-primary.png': 3,
      '../../assets/team-page/jersey-secondary.png': 4,
      '../../assets/team-page/jersey-detail.png': 5,
    },
  ).default;
  harness.mount(() => Component({ snapshot: sourceSnapshot, reduceTransparency: false, onOpenPlayer: (id: string) => openedPlayers.push(id), onOpenGame: (id: string) => openedGames.push(id) }));
  return { harness, openedPlayers, openedGames };
}

function findNodes(root: unknown, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(root)) return root.flatMap((child) => findNodes(child, predicate));
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as any;
  return [...(predicate(node) ? [node] : []), ...findNodes(node.props.children, predicate)];
}

describe('native Team public composition', () => {
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
    assert.match(nodeText(run.harness.output), /~GP is an estimate.*not attendance/i);
    current?.props.onPress();
    assert.deepEqual(run.openedPlayers, ['p1']);
  });

  it('exposes fact-bearing game/player labels and known live/pending scores without inventing jersey zero', () => {
    const statuses = ['live', 'in_progress', 'pending_verification', 'completed'];
    for (const status of statuses) {
      const game = { ...games[3], status, homeScore: 4, awayScore: 2 };
      const run = runtime(320, { ...snapshot, nextGame: game, games: [game], collapsedSchedule: [game], roster: [{ ...roster[0], jerseyNumber: null }] });
      const output = run.harness.output;
      const next = findNode(output, (node) => node.props.testID === 'team-next-game-card');
      assert.match(next?.props.accessibilityLabel, /First General London.*London Eco Metal.*Mar.*4.*3:00.*Next One/i);
      const row = findNode(output, (node) => node.props.testID === 'team-schedule-game-g3');
      assert.match(row?.props.accessibilityLabel, /First General London.*Mar.*4.*First General London 2, London Eco Metal 4/i);
      assert.match(nodeText(row), /4–2/);
      const player = findNode(output, (node) => node.props.testID === 'team-leader-p1');
      assert.match(player?.props.accessibilityLabel, /Matt Grossi.*25 points.*11 games played/i);
      const jersey = findNode(output, (node) => node.props.testID === 'team-roster-player-p1');
      assert.match(jersey?.props.accessibilityLabel, /jersey number unknown/i);
      assert.doesNotMatch(jersey?.props.accessibilityLabel, /#0|number 0/);
      next?.props.onPress(); row?.props.onPress(); player?.props.onPress();
      assert.deepEqual(run.openedGames, ['g3', 'g3']); assert.deepEqual(run.openedPlayers, ['p1']);
    }
    const run = runtime();
    findNode(run.harness.output, (node) => node.props.testID === 'team-leader-metric-pm')?.props.onPress();
    assert.match(findNode(run.harness.render(), (node) => node.props.testID === 'team-leader-p3')?.props.accessibilityLabel, /20 penalty minutes.*11 games played/i);
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

  it('keeps open crests, reference pill rows and larger podiums while narrow headings can wrap', () => {
    for (const width of [390, 320]) {
      const output = runtime(width).harness.output;
      for (const logo of findNodes(output, (node) => node.type === 'TeamLogo')) assert.equal(logo.props.transparentBacking, true);
      const hero = findNode(output, (node) => node.props.testID === 'team-public-hero');
      assert.equal(findNode(hero, (node) => node.type === 'TeamLogo')?.props.size, 160);
      const pillRows = findNodes(hero, (node) => node.props.testID === 'team-hero-pill-row');
      assert.deepEqual(pillRows.map((row) => findNodes(row, (node) => node.props.testID === 'team-hero-pill').length), width === 390 ? [2, 3, 1] : [2, 2, 2]);
      const podium = findNode(output, (node) => node.props.testID === 'team-leader-podium');
      for (const avatar of findNodes(podium, (node) => node.type === 'Avatar')) assert.ok(avatar.props.size >= (width === 390 ? 70 : 54));
      const rosterSection = findNode(output, (node) => node.props.testID === 'team-roster-section');
      const heading = findNode(rosterSection, (node) => node.type === 'Text' && nodeText(node) === 'Next Game Roster');
      assert.equal(flattenStyle(heading?.props.style).flexShrink, 1);
      for (const id of ['team-roster-jersey-toggle', 'team-roster-list-toggle', 'team-leader-chart-toggle', 'team-leader-metric-p']) {
        const style = flattenStyle(findNode(output, (node) => node.props.testID === id)?.props.style);
        assert.ok((style.width ?? style.minWidth) >= 44); assert.ok((style.height ?? style.minHeight) >= 44);
      }
    }
  });

  it('keeps web cyan controls separate from league and jersey colors', () => {
    const output = runtime(390, { ...snapshot, league: { ...snapshot.league, primaryColor: '#03299B' } }).harness.output;
    assert.equal(flattenStyle(findNode(output, (node) => node.props.testID === 'team-leader-metric-p')?.props.style).backgroundColor, '#22D3EE');
  });

  it('treats jersey lettering as fixed artwork while the button exposes the complete identity', () => {
    const output = runtime(320).harness.output;
    const jersey = findNode(output, (node) => node.props.testID === 'team-roster-player-p1');
    assert.match(jersey?.props.accessibilityLabel, /Matt Grossi.*jersey number 96/);
    for (const text of findNodes(jersey, (node) => node.type === 'Text')) assert.equal(text.props.allowFontScaling, false);
  });

  it('renders the approved section order and public hero hierarchy', () => {
    const output = runtime().harness.output;
    const text = nodeText(output);
    const order = ['7-2-2', 'Next Game', 'Team Leaders', 'Schedule', 'Next Game Roster', 'Rivals', 'Captain Contact'].map((label) => text.indexOf(label));
    assert.ok(order.every((index) => index >= 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(findNode(output, (node) => node.props.testID === 'team-public-hero'));
    assert.match(text, /RANK#2WIN %64%STREAKW1GF34GA22DIFF\+12/);
    assert.match(text, /Latest championship: Fall 2025 \(2025\)/);
  });

  it('switches exact leader metrics and podium/bar views without fake navigation', () => {
    const run = runtime();
    findNode(run.harness.output, (node) => node.props.testID === 'team-leader-metric-pm')?.props.onPress();
    let output = run.harness.render();
    assert.match(nodeText(findNode(output, (node) => node.props.testID === 'team-leader-podium')), /Stefan Kowles20/);
    findNode(output, (node) => node.props.testID === 'team-leader-chart-toggle')?.props.onPress();
    output = run.harness.render();
    assert.ok(findNode(output, (node) => node.props.testID === 'team-leader-bars'));
    assert.ok(!findNode(output, (node) => node.props.testID === 'team-leader-podium'));
  });

  it('expands the schedule, toggles jersey/list roster, and preserves player/game navigation', () => {
    const run = runtime(320);
    let output = run.harness.output;
    assert.doesNotMatch(nodeText(findNode(output, (node) => node.props.testID === 'team-schedule-section')), /Past Three|Next Three/);
    findNode(output, (node) => node.props.testID === 'team-schedule-toggle')?.props.onPress();
    output = run.harness.render();
    assert.match(nodeText(findNode(output, (node) => node.props.testID === 'team-schedule-section')), /Past Three|Next Three/);
    findNode(output, (node) => node.props.testID === 'team-roster-list-toggle')?.props.onPress();
    output = run.harness.render();
    assert.ok(findNode(output, (node) => node.props.testID === 'team-roster-list'));
    findNode(output, (node) => node.props.testID === 'team-roster-player-p1')?.props.onPress();
    findNode(output, (node) => node.props.testID === 'team-schedule-game-g0')?.props.onPress();
    assert.deepEqual(run.openedPlayers, ['p1']);
    assert.deepEqual(run.openedGames, ['g0']);
  });

  it('cycles the full rivals carousel and leaves unknown goalie data unknown', () => {
    const run = runtime();
    assert.match(nodeText(findNode(run.harness.output, (node) => node.props.testID === 'team-rivals-section')), /First General London.*TENDYNo data—/);
    findNode(run.harness.output, (node) => node.props.testID === 'team-rival-next')?.props.onPress();
    const output = run.harness.render();
    assert.match(nodeText(findNode(output, (node) => node.props.testID === 'team-rivals-section')), /Purple Cobras/);
    assert.match(nodeText(findNode(output, (node) => node.props.testID === 'team-rival-dots')), /●○|○●/);
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
    assert.match(nodeText(findNode(output, (node) => node.props.testID === 'team-substitution-notes')), /Accepted Baker subbing in for Matt Grossi/);
    const jerseyText = nodeText(jerseys);
    assert.match(jerseyText, /96/);
    assert.match(jerseyText, /00/);
    assert.doesNotMatch(jerseyText, /(^|\D)0(\D|$)/);
  });
});
