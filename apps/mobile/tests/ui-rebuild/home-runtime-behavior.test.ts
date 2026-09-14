/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic component harness */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness.ts';

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

const league = { id: 'league-1', name: 'Harbour Hockey', slug: 'harbour-hockey' };
const assignment = { team_id: 'wolves', team_name: 'Harbour Wolves', logo_url: null, primary_color: '#34D399', leadership_role: null };
const nextGame = {
  id: 'next-1', league_id: league.id, season_id: 'season-1', scheduled_at: '2026-09-18T20:30:00-04:00', location: 'North Forum', status: 'scheduled',
  home_team_id: 'wolves', away_team_id: 'otters',
  home_team: { id: 'wolves', name: 'Harbour Wolves', logo_url: null, primary_color: '#34D399' },
  away_team: { id: 'otters', name: 'River Otters', logo_url: null, primary_color: null },
};
const leagueB = { id: 'league-2', name: 'Lakeside Hockey', slug: 'lakeside-hockey' };
const assignmentB = { ...assignment, team_id: 'falcons', team_name: 'Lakeside Falcons', primary_color: '#60A5FA' };
const nextGameB = {
  ...nextGame, id: 'next-2', league_id: leagueB.id, season_id: 'season-2', home_team_id: 'falcons',
  home_team: { id: 'falcons', name: 'Lakeside Falcons', logo_url: null, primary_color: '#60A5FA' },
};

const snapshot = {
  leagueId: league.id,
  leagueSlug: league.slug,
  presentationSeason: { id: 'season-1', league_id: league.id, name: '2026', status: 'active', start_date: '2026-01-01', end_date: null, created_at: null },
  timezone: 'America/Toronto',
  weekKey: '2026-09-07:2026-09-13',
  divisions: [],
  articles: { status: 'ready', data: [{ id: 'story-1', season_id: 'season-1', title: 'Opening night', content: 'Real story copy', excerpt: 'Real story copy', image_url: null, slug: 'opening-night', published_at: '2026-09-10', created_at: '2026-09-10', type: 'news' }] },
  weeklyGames: { status: 'ready', data: [{ ...nextGame, id: 'week-final', status: 'completed', home_score: 5, away_score: 4 }] },
  leaders: { status: 'ready', data: [{ player_id: 'player-leader', player_name: 'Alex Ace', avatar_url: null, team_id: 'wolves', team_name: 'Harbour Wolves', display_team_name: 'Harbour Wolves', display_team_logo_url: null, position: 'C', goals: 7, assists: 5, points: 12 }] },
  standings: { status: 'ready', data: [{ team_id: 'wolves', team_name: 'Harbour Wolves', logo_url: null, primary_color: '#34D399', division_id: null, division_name: null, team_type: null, games_played: 10, wins: 7, losses: 3, ties: 0, goals_for: 40, goals_against: 25, points: 14 }] },
  photos: { status: 'ready', data: [{ id: 'photo-1', url: 'https://images.test/photo.jpg', caption: 'Rink', gallery_id: 'album-1' }] },
  albums: { status: 'ready', data: [] },
  community: { status: 'ready', data: [{ key: 'socialInstagram', label: 'Instagram', url: 'https://instagram.com/harbour' }] },
  sponsors: { status: 'ready', data: [{ id: 'sponsor-1', name: 'Rink Shop', logo_url: 'https://images.test/sponsor.png', website_url: 'https://rinkshop.test/', tier: 'gold', display_order: 1 }] },
} as any;

function createRuntime({
  guest = false,
  updateResults = [] as Array<{ success: boolean }>,
  publicData = snapshot as any,
  publicResults = [] as any[],
  updateCheckinImpl = undefined as undefined | ((...args: unknown[]) => Promise<{ success: boolean }>),
} = {}) {
  const harness = createHookHarness();
  let currentLeague = league;
  let currentUser = { id: 'player-1' };
  let replacementGame: any = null;
  let replacementTeam: any = null;
  const navigationCalls: unknown[][] = [];
  const linkCalls: string[] = [];
  const playerCalls: unknown[] = [];
  const checkinCalls: unknown[][] = [];
  const queryCalls: Array<[string, unknown[]]> = [];
  const chain: Record<string, any> = {};
  for (const method of ['select', 'eq', 'gte', 'or', 'order', 'limit']) chain[method] = (...args: unknown[]) => { queryCalls.push([method, args]); return chain; };
  chain.maybeSingle = async () => ({ data: replacementGame ?? (currentLeague.id === leagueB.id ? nextGameB : nextGame), error: null });
  const colors = {
    primary: '#22D3EE', bgBase: '#07111F', bgSurface: 'rgba(12,27,49,.72)', bgInteractive: 'rgba(28,42,66,.84)',
    textPrimary: '#F8FBFF', textSecondary: '#A9B8CC', glassStroke: 'rgba(255,255,255,.12)', glassStrokeStrong: '#41607F',
    accentGreen: '#22C55E', accentRed: '#EF4444',
  };
  const HomeScreen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(new URL('../../src/screens/HomeScreen.tsx', import.meta.url), {
    react: harness.react,
    'react-native': {
      ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable', RefreshControl: 'RefreshControl', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: <T>(value: T) => value, absoluteFill: {}, absoluteFillObject: { position: 'absolute', inset: 0 }, hairlineWidth: 1 },
      useWindowDimensions: () => ({ width: 320, height: 700 }),
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { Ionicons: 'Ionicon' },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'expo-haptics': { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync: () => undefined },
    'expo-linking': { openURL: async (url: string) => { linkCalls.push(url); } },
    '../../assets/blh-logo.png': 'blh-logo.png',
    '../../assets/hockey-life-logo.png': 'hockey-life-logo.png',
    '../components/GuestBanner': () => createElement('GuestBanner', null),
    '../components/LeagueMarketplace': (props: Record<string, unknown>) => createElement('LeagueMarketplace', props),
    '../components/RevealView': ({ children, ...props }: Record<string, unknown>) => createElement('RevealView', props, children),
    '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false, reduceMotion: false }) },
    '../context/AuthContext': { useAuth: () => ({ user: currentUser, isGuest: guest }) },
    '../context/LeagueContext': { useLeague: () => ({ activeLeague: currentLeague, activeTheme: { primaryColor: '#34D399' }, isGuestLeague: guest }) },
    '../navigation/playerCard': { navigateToPlayerCard: (_navigation: unknown, params: unknown) => playerCalls.push(params) },
    '../lib/supabase/checkins': {
      getGameCheckinSummary: async (_gameId: string, teamId: string) => teamId === assignmentB.team_id
        ? { confirmed: Array.from({ length: 3 }), tentative: Array.from({ length: 1 }), out: Array.from({ length: 2 }) }
        : { confirmed: Array.from({ length: 11 }), tentative: Array.from({ length: 2 }), out: [] },
      getMyCheckins: async (teamId: string) => teamId === assignmentB.team_id ? { [nextGameB.id]: 'tentative' } : {},
      updateCheckin: async (...args: unknown[]) => {
        checkinCalls.push(args);
        return updateCheckinImpl ? updateCheckinImpl(...args) : updateResults.shift() ?? { success: true };
      },
    },
    '../lib/supabase/client': { supabase: { from: () => chain } },
    '../lib/supabase/home': {
      loadHomePublicSnapshot: async (leagueId: string, leagueSlug: string) => {
        const next = publicResults.length > 0 ? publicResults.shift() : publicData;
        if (next instanceof Error) throw next;
        if (leagueId === league.id) return next;
        return {
          ...next, leagueId, leagueSlug,
          presentationSeason: next.presentationSeason ? { ...next.presentationSeason, id: 'season-2', league_id: leagueId } : null,
        };
      },
      normalizeHomeGameStatus: (status: string) => status === 'completed' ? 'Final' : status === 'in_progress' ? 'Live' : 'Scheduled',
      toSafeWebUrl: (url: string) => /^https?:/.test(url) ? url : null,
    },
    '../lib/supabase/team': {
      getTeamActiveSeason: async (leagueId: string) => ({ season: { id: leagueId === leagueB.id ? 'season-2' : 'season-1' }, error: null }),
      getActiveSeasonTeamForUser: async (_userId: string, leagueId: string) => replacementTeam ?? (leagueId === leagueB.id ? assignmentB : assignment),
    },
    '../theme/colors': { default: colors },
  }).default;
  harness.mount(() => HomeScreen({ navigation: { navigate: (...args: unknown[]) => navigationCalls.push(args) } }));
  return {
    harness, navigationCalls, linkCalls, playerCalls, checkinCalls, queryCalls,
    changeGame: (kind: 'game' | 'team') => {
      if (kind === 'team') {
        replacementTeam = assignmentB;
        replacementGame = { ...nextGame, home_team_id: assignmentB.team_id, home_team: nextGameB.home_team };
      } else replacementGame = { ...nextGame, id: 'replacement-game' };
    },
    switchIdentity: () => {
      currentLeague = leagueB;
      currentUser = { id: 'player-2' };
      harness.render();
    },
  };
}

async function settle(runtime: ReturnType<typeof createRuntime>) {
  for (let attempt = 0; attempt < 10; attempt += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); runtime.harness.render(); }
  return runtime.harness.output;
}

async function refresh(runtime: ReturnType<typeof createRuntime>) {
  const scroll = findNode(runtime.harness.output, (node) => node.type === 'ScrollView' && node.props.refreshControl);
  assert.ok(scroll);
  await scroll.props.refreshControl.props.onRefresh();
  runtime.harness.render();
}

describe('Home web-structure runtime', () => {
  it('renders factual sections in web order and keeps compact content wrappable', async () => {
    const runtime = createRuntime();
    const output = await settle(runtime);
    const nodes = allNodes(output);
    const ids = ['home-news-section', 'home-personal-section', 'home-weekly-games-section', 'home-leaders-section', 'home-standings-section', 'home-photos-section', 'home-community-section', 'home-sponsors-section'];
    const indexes = ids.map((id) => nodes.findIndex((node) => node.props.testID === id));
    assert.ok(indexes.every((index) => index >= 0));
    assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
    assert.match(nodeText(output), /Opening night/);
    assert.match(nodeText(output), /This Week’s Games/);
    assert.match(nodeText(output), /Final/);
    assert.match(nodeText(output), /Alex Ace/);
    assert.match(nodeText(output), /Rink Shop/);
    assert.equal(flattenStyle(findNode(output, (node) => node.props.testID === 'home-matchup-teams')?.props.style).flexDirection, 'column');
    assert.ok(runtime.queryCalls.some(([method, args]) => method === 'eq' && args[0] === 'season_id' && args[1] === 'season-1'));
    assert.ok(runtime.queryCalls.some(([method, args]) => method === 'eq' && args[0] === 'status' && args[1] === 'scheduled'));
    assert.ok(runtime.queryCalls.some(([method, args]) => method === 'gte' && args[0] === 'scheduled_at'));
  });

  it('preserves article, game, player, schedule, notifications, and sponsor routes', async () => {
    const runtime = createRuntime();
    const output = await settle(runtime);
    findNode(output, (node) => node.props.accessibilityLabel === 'Read Opening night')?.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Final. River Otters 4. Harbour Wolves 5. Sep 18 at 8:30 PM. North Forum')?.props.onPress();
    findNode(output, (node) => node.props.accessibilityRole === 'button' && nodeText(node).includes('Alex Ace'))?.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Open full schedule')?.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Updates')?.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Open Rink Shop')?.props.onPress();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(runtime.playerCalls, [{ playerId: 'player-leader', leagueId: 'league-1' }]);
    assert.deepEqual(runtime.navigationCalls, [
      ['Schedule', { screen: 'GamePreview', initial: false, params: { gameId: 'week-final' } }], ['Schedule'], ['Profile', { screen: 'NotificationsFeed' }],
    ]);
    assert.deepEqual(runtime.linkCalls, ['https://harbour-hockey.beerleaguehockey.ca/news/opening-night', 'https://rinkshop.test/']);
  });

  it('commits check-ins and restores the prior facts after a failed write', async () => {
    const runtime = createRuntime({ updateResults: [{ success: true }, { success: false }] });
    await settle(runtime);
    const press = async (label: string) => { await findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === label)?.props.onPress(); runtime.harness.render(); };
    await press('Check in for next game');
    assert.match(nodeText(runtime.harness.output), /12 In · 2 Maybe · 0 Out/);
    await press('Mark next game as maybe');
    assert.match(nodeText(runtime.harness.output), /12 In · 2 Maybe · 0 Out/);
    assert.equal(findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Check in for next game')?.props.accessibilityState.selected, true);
    assert.deepEqual(runtime.checkinCalls, [['next-1', 'wolves', 'confirmed'], ['next-1', 'wolves', 'tentative']]);
  });

  it('shows public sections to guests while omitting membership and check-in controls', async () => {
    const runtime = createRuntime({ guest: true });
    const output = await settle(runtime);
    assert.ok(findNode(output, (node) => node.props.testID === 'home-news-section'));
    assert.ok(findNode(output, (node) => node.props.testID === 'home-weekly-games-section'));
    assert.equal(findNode(output, (node) => node.props.testID === 'home-personal-section'), undefined);
    assert.equal(findNode(output, (node) => node.props.accessibilityLabel === 'Check in for next game'), undefined);
  });

  it('keeps leaders honestly unavailable instead of substituting career totals', async () => {
    const unavailable = { ...snapshot, leaders: { status: 'error', data: [], message: 'Current-season leaders require the league public Home feed.' } };
    const output = await settle(createRuntime({ publicData: unavailable }));
    const section = findNode(output, (node) => node.props.testID === 'home-leaders-section');
    assert.match(nodeText(section), /Current-season leaders require the league public Home feed/);
    assert.doesNotMatch(nodeText(section), /Alex Ace/);
  });

  it('uses canonical server division order for multi-division chips and the default table', async () => {
    const multiDivision = {
      ...snapshot,
      divisions: [{ id: 'division-b', name: 'B', sort_order: 1 }, { id: 'division-a', name: 'A', sort_order: 2 }],
      standings: {
        status: 'ready',
        data: [
          { ...snapshot.standings.data[0], team_id: 'team-b', team_name: 'Server First Bears', division_id: 'division-b', division_name: 'B' },
          { ...snapshot.standings.data[0], team_id: 'team-a', team_name: 'Server Second Aces', division_id: 'division-a', division_name: 'A' },
        ],
      },
    };
    const runtime = createRuntime({ publicData: multiDivision });
    const output = await settle(runtime);
    const standingsSection = findNode(output, (node) => node.props.testID === 'home-standings-section');
    assert.match(nodeText(standingsSection), /Server First Bears/);
    assert.doesNotMatch(nodeText(standingsSection), /Server Second Aces/);
    const chips = allNodes(standingsSection).filter((node) => node.props.accessibilityState?.selected !== undefined);
    assert.deepEqual(chips.map((node) => nodeText(node)), ['B', 'A']);
    chips[1].props.onPress();
    runtime.harness.render();
    assert.match(nodeText(findNode(runtime.harness.output, (node) => node.props.testID === 'home-standings-section')), /Server Second Aces/);
  });

  it('makes every loaded story reachable with its own destination and resets safely when the story identity shrinks', async () => {
    const secondStory = {
      ...snapshot.articles.data[0], id: 'story-2', title: 'Championship recap', slug: 'championship-recap', type: 'game_recap',
    };
    const oneStory = { ...snapshot, articles: { status: 'ready', data: [snapshot.articles.data[0]] } };
    const runtime = createRuntime({
      publicData: oneStory,
      publicResults: [{ ...snapshot, articles: { status: 'ready', data: [snapshot.articles.data[0], secondStory] } }, oneStory],
    });
    await settle(runtime);
    const next = findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Next story');
    assert.ok(next);
    assert.ok((flattenStyle(next.props.style).minHeight ?? flattenStyle(next.props.style).height) >= 44);
    next.props.onPress();
    runtime.harness.render();
    assert.match(nodeText(runtime.harness.output), /Championship recap/);
    findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Read Championship recap')?.props.onPress();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(runtime.linkCalls.at(-1), 'https://harbour-hockey.beerleaguehockey.ca/news/championship-recap');

    await refresh(runtime);
    assert.match(nodeText(runtime.harness.output), /Opening night/);
    assert.doesNotMatch(nodeText(runtime.harness.output), /Championship recap/);
  });

  it('retains same-period facts with visible stale notes, including an independent photo reel when albums fail', async () => {
    const refreshError = {
      ...snapshot,
      articles: { status: 'error', data: [], message: 'News refresh failed.' },
      weeklyGames: { status: 'error', data: [], message: 'Games refresh failed.' },
      leaders: { status: 'error', data: [], message: 'Leaders refresh failed.' },
      standings: { status: 'error', data: [], message: 'Standings refresh failed.' },
      photos: { status: 'error', data: [], message: 'Photos refresh failed.' },
      albums: { status: 'error', data: [], message: 'Albums refresh failed.' },
    };
    const runtime = createRuntime({ publicResults: [snapshot, refreshError] });
    await settle(runtime);
    await refresh(runtime);
    const text = nodeText(runtime.harness.output);
    for (const fact of ['Opening night', 'Alex Ace', 'Rink Shop', 'News refresh failed.', 'Games refresh failed.', 'Leaders refresh failed.', 'Standings refresh failed.', 'Photos refresh failed.', 'Albums refresh failed.']) {
      assert.match(text, new RegExp(fact.replace(/[.]/g, '\\.')));
    }
    assert.ok(findNode(runtime.harness.output, (node) => node.props.testID === 'home-photos-section'));
  });

  it('retains the validated division scope with stale standings after a same-period endpoint failure', async () => {
    const multi = { ...snapshot, divisions: [{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }],
      standings: { status: 'ready', data: [
        { ...snapshot.standings.data[0], division_id: 'a', team_name: 'First Division Team' },
        { ...snapshot.standings.data[0], team_id: 'other', division_id: 'b', team_name: 'Second Division Team' },
      ] } };
    const runtime = createRuntime({ publicResults: [multi, { ...multi, divisions: [], standings: { status: 'error', data: [], message: 'Feed unavailable.' } }] });
    await settle(runtime);
    await refresh(runtime);
    const section = findNode(runtime.harness.output, (node) => node.props.testID === 'home-standings-section');
    assert.match(nodeText(section), /First Division Team/);
    assert.doesNotMatch(nodeText(section), /Second Division Team/);
    assert.match(nodeText(section), /Feed unavailable/);
  });

  it('does not retain old-season facts beneath a new period after refresh failure', async () => {
    const changedPeriod = {
      ...snapshot,
      presentationSeason: { ...snapshot.presentationSeason, id: 'season-2', name: 'Winter 2027' },
      weekKey: '2027-01-04:2027-01-10',
      articles: { status: 'error', data: [], message: 'New season news unavailable.' },
      weeklyGames: { status: 'error', data: [], message: 'New week unavailable.' },
      leaders: { status: 'error', data: [], message: 'New season leaders unavailable.' },
      standings: { status: 'error', data: [], message: 'New season standings unavailable.' },
      albums: { status: 'error', data: [], message: 'New season albums unavailable.' },
    };
    const runtime = createRuntime({ publicResults: [snapshot, changedPeriod] });
    await settle(runtime);
    await refresh(runtime);
    const text = nodeText(runtime.harness.output);
    assert.doesNotMatch(text, /Opening night|Alex Ace/);
    assert.match(text, /New season news unavailable|New season leaders unavailable/);
  });

  it('does not describe retained facts as current when a rejected refresh cannot verify the period', async () => {
    const runtime = createRuntime({ publicResults: [snapshot, new Error('unverified new week or season')] });
    await settle(runtime);
    await refresh(runtime);
    for (const id of ['home-news-section', 'home-weekly-games-section', 'home-leaders-section', 'home-standings-section']) {
      const text = nodeText(findNode(runtime.harness.output, (node) => node.props.testID === id));
      assert.doesNotMatch(text, /Opening night|Alex Ace|Harbour Wolves|River Otters/);
      assert.match(text, /unavailable|failed/i);
    }
    assert.ok(findNode(runtime.harness.output, (node) => node.props.testID === 'home-photos-section'));
  });

  it('prefers a current-season covered album for the empty-news hero', async () => {
    const data = { ...snapshot, articles: { status: 'ready', data: [] }, albums: { status: 'ready', data: [
      { id: 'no-cover', title: 'No cover', cover_photo_url: null },
      { id: 'covered', title: 'Covered album', cover_photo_url: 'https://images.test/cover.jpg' },
    ] } };
    const runtime = createRuntime({ publicData: data });
    await settle(runtime);
    const hero = findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-detail')!;
    assert.equal(hero.props.accessibilityLabel, 'Open Covered album gallery');
    hero.props.onPress();
    assert.deepEqual(runtime.linkCalls, ['https://harbour-hockey.beerleaguehockey.ca/gallery/covered']);
  });

  it('contains an unexpected public loader rejection and still settles personal content', async () => {
    const runtime = createRuntime({ publicData: new Error('unexpected loader failure') });
    const output = await settle(runtime);
    assert.match(nodeText(output), /News is temporarily unavailable/);
    assert.ok(findNode(output, (node) => node.props.testID === 'home-personal-section'));
  });

  for (const kind of ['game', 'team'] as const) for (const success of [false, true]) {
  it(`pins pending check-in ${success ? 'success' : 'failure'} when the same account refreshes to a different ${kind}`, async () => {
    let settleA: ((value: { success: boolean }) => void) | undefined;
    const runtime = createRuntime({ updateCheckinImpl: () => new Promise((resolve) => { settleA = resolve; }) });
    await settle(runtime);
    const pending = findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Check in for next game')!.props.onPress();
    runtime.harness.render();
    runtime.changeGame(kind);
    await refresh(runtime);
    const button = findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Check in for next game')!;
    assert.equal(button.props.disabled, false, 'a new target must not inherit the old pending spinner');
    const before = nodeText(findNode(runtime.harness.output, (node) => node.props.testID === 'home-personal-section'));
    settleA?.({ success });
    await pending;
    runtime.harness.render();
    assert.equal(nodeText(findNode(runtime.harness.output, (node) => node.props.testID === 'home-personal-section')), before);
    assert.deepEqual(runtime.checkinCalls, [['next-1', 'wolves', 'confirmed']]);
  });

  }
  for (const lateResult of [{ success: false }, { success: true }]) {
    it(`does not let a late league-A check-in ${lateResult.success ? 'success' : 'failure'} alter league B`, async () => {
      let settleA: ((result: { success: boolean }) => void) | undefined;
      const runtime = createRuntime({
        updateCheckinImpl: () => new Promise<{ success: boolean }>((resolve) => { settleA = resolve; }),
      });
      await settle(runtime);
      const firstPress = findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Check in for next game')!;
      const pendingA = firstPress.props.onPress();
      firstPress.props.onPress();
      runtime.harness.render();
      assert.equal(runtime.checkinCalls.length, 1, 'an immediate double tap must not issue a second write');

      runtime.switchIdentity();
      await settle(runtime);
      const before = nodeText(findNode(runtime.harness.output, (node) => node.props.testID === 'home-personal-section'));
      assert.match(before, /3 In · 1 Maybe · 2 Out/);
      assert.equal(findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Mark next game as maybe')?.props.accessibilityState.selected, true);

      settleA?.(lateResult);
      await pendingA;
      await settle(runtime);
      const after = nodeText(findNode(runtime.harness.output, (node) => node.props.testID === 'home-personal-section'));
      assert.equal(after, before);
      assert.equal(findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Mark next game as maybe')?.props.accessibilityState.selected, true);
      assert.deepEqual(runtime.checkinCalls, [['next-1', 'wolves', 'confirmed']]);
    });
  }
});
