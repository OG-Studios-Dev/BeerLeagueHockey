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
  goalieLeaders: { status: 'ready', data: [{ player_id: 'goalie-leader', player_name: 'Steven Wild', avatar_url: null, team_id: 'wolves', team_name: 'Harbour Wolves', display_team_name: 'Harbour Wolves', display_team_logo_url: null, position: 'Goalie', goals: null, assists: null, points: null, gaa: 3, is_goalie: true, estimated: true }] },
  standings: { status: 'ready', data: [{ team_id: 'wolves', team_name: 'Harbour Wolves', logo_url: null, primary_color: '#34D399', division_id: null, division_name: null, team_type: null, games_played: 10, wins: 7, losses: 3, ties: 0, goals_for: 40, goals_against: 25, points: 14 }] },
  photos: { status: 'ready', data: [{ id: 'photo-1', url: 'https://images.test/photo.jpg', caption: 'Rink', gallery_id: 'album-1' }] },
  albums: { status: 'ready', data: [] },
  community: { status: 'ready', data: [{ key: 'socialInstagram', label: 'Instagram', url: 'https://instagram.com/harbour' }] },
  sponsors: { status: 'ready', data: [{ id: 'sponsor-1', name: 'Rink Shop', logo_url: 'https://images.test/sponsor.png', website_url: 'https://rinkshop.test/', tier: 'gold', display_order: 1 }] },
} as any;

function createRuntime({
  guest = false,
  reduceMotion = false,
  width = 320,
  fontScale = 1,
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
  const animationCalls: unknown[] = [];
  const scrollCalls: Array<{ x: number; animated: boolean }> = [];
  const leaderRenders: Array<{ leagueId: string; leaders: any[]; metric: string; status: string }> = [];
  let viewportWidth = width;
  let viewportFontScale = fontScale;
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
      ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable', RefreshControl: 'RefreshControl',
      ScrollView: ({ ref, children, ...props }: Record<string, any>) => {
        if (ref && typeof ref === 'object') ref.current = { scrollTo: (value: { x: number; animated: boolean }) => scrollCalls.push(value) };
        return createElement('ScrollView', props, children);
      },
      Text: 'Text', View: 'View',
      StyleSheet: { create: <T>(value: T) => value, absoluteFill: {}, absoluteFillObject: { position: 'absolute', inset: 0 }, hairlineWidth: 1 },
      LayoutAnimation: { Presets: { easeInEaseOut: 'ease' }, configureNext: (preset: unknown) => animationCalls.push(preset) },
      useWindowDimensions: () => ({ width: viewportWidth, height: 700, fontScale: viewportFontScale }),
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { Ionicons: 'Ionicon' },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'expo-haptics': { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync: () => undefined },
    'expo-linking': { openURL: async (url: string) => { linkCalls.push(url); } },
    '../../assets/blh-logo.png': 'blh-logo.png',
    '../../assets/hockey-life-logo.png': 'hockey-life-logo.png',
    '../components/GuestBanner': () => createElement('GuestBanner', null),
    '../components/HomeLeagueHero': ({ updatesAction, ...props }: Record<string, any>) => createElement('HomeLeagueHero', props, updatesAction),
    '../components/HomeLeagueLeaders': ({ leaders, status, errorMessage, onOpenPlayer, metric, onMetricChange, ...props }: Record<string, any>) => {
      leaderRenders.push({ leagueId: props.leagueId, leaders, metric, status });
      return createElement(
        'HomeLeagueLeaders', { ...props, leaders, status, errorMessage, metric },
        [
          createElement('Pressable', { testID: 'home-leaders-tab-points', onPress: () => onMetricChange('points') }, createElement('Text', null, 'Points')),
          createElement('Pressable', { testID: 'home-leaders-tab-gaa', onPress: () => onMetricChange('gaa') }, createElement('Text', null, 'GAA')),
          status === 'error' && leaders.length === 0
            ? createElement('Text', null, errorMessage)
            : [
              ...leaders.map((leader: Record<string, any>) => createElement(
                'Pressable',
                { accessibilityRole: 'button', onPress: () => onOpenPlayer(leader.player_id) },
                createElement('Text', null, leader.player_name),
              )),
              status === 'error' ? createElement('Text', null, errorMessage) : null,
            ],
        ],
      );
    },
    '../components/HomeMatchupCarousel': ({ games, onOpenGame, ...props }: Record<string, any>) => createElement(
      'HomeMatchupCarousel', props,
      games.map((game: Record<string, any>) => createElement('Pressable', {
        accessibilityRole: 'button',
        accessibilityLabel: `${game.status === 'completed' ? 'Final' : 'Scheduled'}. ${game.away_team.name} ${game.away_score ?? 'score unavailable'}. ${game.home_team.name} ${game.home_score ?? 'score unavailable'}. Sep 18 at 8:30 PM. ${game.location}`,
        onPress: () => onOpenGame(game.id),
      }, createElement('Text', null, game.status === 'completed' ? 'Final' : 'Scheduled'))),
    ),
    '../components/LeagueMarketplace': (props: Record<string, unknown>) => createElement('LeagueMarketplace', props),
    '../components/RevealView': ({ children, ...props }: Record<string, unknown>) => createElement('RevealView', props, children),
    '../components/SectionHeader': { SECTION_HEADING_TEXT_STYLE: { fontSize: 22, lineHeight: 28, fontWeight: '800', fontStyle: 'normal' } },
    '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false, reduceMotion }) },
    '../context/AuthContext': { useAuth: () => ({ user: currentUser, isGuest: guest }) },
    '../context/LeagueContext': { useLeague: () => ({ activeLeague: currentLeague, activeTheme: { primaryColor: '#34D399' }, isGuestLeague: guest }) },
    '../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#1F6A44' }) },
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
    harness, navigationCalls, linkCalls, playerCalls, checkinCalls, queryCalls, animationCalls, scrollCalls, leaderRenders,
    resize: (nextWidth: number) => { viewportWidth = nextWidth; harness.render(); },
    setFontScale: (nextFontScale: number) => { viewportFontScale = nextFontScale; harness.render(); },
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
  const headingActions = [
    { headingText: 'This Week’s GamesFull schedule', title: 'This Week’s Games', actionText: 'Full schedule' },
    { headingText: 'StandingsAll standings', title: 'Standings', actionText: 'All standings' },
    { headingText: 'League PhotosGallery', title: 'League Photos', actionText: 'Gallery' },
  ];

  function findHeading(output: unknown, text: string) {
    return findNode(output, (node) => node.type === 'View'
      && nodeText(node) === text
      && flattenStyle(node.props.style).marginBottom === 9);
  }

  function findHeadingAction(heading: TestNode, actionText: string) {
    return findNode(heading, (node) => node.type === 'Pressable' && nodeText(node) === actionText);
  }

  it('keeps every title and intrinsic 44dp action on the approved same row at normal text size', async () => {
    const output = await settle(createRuntime({ fontScale: 1 }));
    for (const contract of headingActions) {
      const heading = findHeading(output, contract.headingText);
      assert.ok(heading, `Missing ${contract.title} heading`);
      assert.equal(flattenStyle(heading.props.style).flexDirection, 'row');
      const title = findNode(heading, (node) => node.props.accessibilityRole === 'header');
      assert.equal(nodeText(title), contract.title);
      const action = findHeadingAction(heading, contract.actionText);
      assert.ok(action, `Missing complete ${contract.actionText} action`);
      const actionStyle = flattenStyle(action.props.style);
      assert.equal(actionStyle.minHeight, 44);
      assert.equal(actionStyle.width, undefined, 'normal text actions must remain intrinsic on the same row');
      const label = findNode(action, (node) => node.type === 'Text' && nodeText(node) === contract.actionText);
      assert.deepEqual(
        { fontSize: flattenStyle(label?.props.style).fontSize, lineHeight: flattenStyle(label?.props.style).lineHeight },
        { fontSize: 12, lineHeight: 18 },
        'normal-scale action typography must remain unchanged',
      );
    }
    const weeklyTitle = findNode(findHeading(output, headingActions[0].headingText), (node) => node.props.accessibilityRole === 'header');
    assert.deepEqual(
      { fontSize: flattenStyle(weeklyTitle?.props.style).fontSize, lineHeight: flattenStyle(weeklyTitle?.props.style).lineHeight },
      { fontSize: 22, lineHeight: 28 },
    );
  });

  it('gives every stacked accessibility-large action full width and scale-derived intrinsic-safe height', async () => {
    const fontScale = 1.8;
    const output = await settle(createRuntime({ fontScale }));
    const scaledActionMinHeight = Math.max(44, Math.ceil(18 * fontScale) + 16);
    const scaledTextLineHeight = Math.ceil(18 * fontScale);
    for (const contract of headingActions) {
      const heading = findHeading(output, contract.headingText);
      assert.ok(heading, `Missing ${contract.title} heading`);
      const headingStyle = flattenStyle(heading.props.style);
      assert.equal(headingStyle.flexDirection, 'column');
      assert.equal(headingStyle.height, undefined);
      assert.equal(headingStyle.minHeight, 44);
      const title = findNode(heading, (node) => node.props.accessibilityRole === 'header');
      assert.equal(nodeText(title), contract.title);
      assert.equal(flattenStyle(title?.props.style).width, '100%');

      const action = findHeadingAction(heading, contract.actionText);
      assert.ok(action, `Missing complete ${contract.actionText} action`);
      const actionStyle = flattenStyle(action.props.style);
      assert.equal(actionStyle.width, '100%');
      assert.equal(actionStyle.alignSelf, 'stretch');
      assert.equal(actionStyle.height, undefined);
      assert.equal(actionStyle.minHeight, scaledActionMinHeight);
      assert.ok(
        actionStyle.width === '100%' && actionStyle.minHeight > 44,
        'negative control: the first-fix 44dp intrinsic action would retain the confirmed native clipping defect',
      );
      const label = findNode(action, (node) => node.type === 'Text' && nodeText(node) === contract.actionText);
      assert.equal(label?.props.allowFontScaling, true);
      assert.equal(label?.props.numberOfLines, undefined);
      assert.equal(label?.props.maxFontSizeMultiplier, undefined);
      assert.equal(flattenStyle(label?.props.style).lineHeight, scaledTextLineHeight);
    }
    const fullSchedule = findHeadingAction(findHeading(output, headingActions[0].headingText)!, 'Full schedule');
    assert.ok(findNode(fullSchedule, (node) => node.type === 'Ionicon' && node.props.name === 'arrow-forward'));
  });

  it('proves the mounted fix-2 container-only baseline leaves the action Text line box inadequate', async () => {
    const fontScale = 1.8;
    const output = await settle(createRuntime({ fontScale }));
    const action = findHeadingAction(findHeading(output, headingActions[0].headingText)!, 'Full schedule')!;
    const label = findNode(action, (node) => node.type === 'Text' && nodeText(node) === 'Full schedule')!;
    const fix2PressableStyle = flattenStyle(action.props.style);
    const fix2TextStyle = { ...flattenStyle(label.props.style), lineHeight: 18 };
    const requiredTextLineHeight = Math.ceil(18 * fontScale);

    assert.equal(fix2PressableStyle.width, '100%');
    assert.ok(fix2PressableStyle.minHeight > 44);
    assert.ok(
      fix2TextStyle.lineHeight < requiredTextLineHeight,
      'a full-width, taller Pressable does not enlarge its child Text line box',
    );
    assert.equal(flattenStyle(label.props.style).lineHeight, requiredTextLineHeight);
  });

  it('rejects the collision-prone accessibility-large row while leaving actionless headings unchanged', async () => {
    const output = await settle(createRuntime({ fontScale: 1.8 }));
    const weeklyHeading = findHeading(output, 'This Week’s GamesFull schedule');
    assert.ok(weeklyHeading);
    assert.notEqual(
      flattenStyle(weeklyHeading.props.style).flexDirection,
      'row',
      'the previous always-row layout is the confirmed native collision negative control',
    );
    const newsHeading = findHeading(output, 'News');
    assert.ok(newsHeading);
    assert.equal(flattenStyle(newsHeading.props.style).flexDirection, 'row');
    assert.equal(nodeText(findNode(newsHeading, (node) => node.props.accessibilityRole === 'header')), 'News');
  });

  it('renders factual sections in web order and keeps compact content wrappable', async () => {
    const runtime = createRuntime();
    const output = await settle(runtime);
    const nodes = allNodes(output);
    const ids = ['home-news-section', 'home-weekly-games-section', 'home-leaders-section', 'home-standings-section', 'home-photos-section', 'home-community-section'];
    const indexes = ids.map((id) => nodes.findIndex((node) => node.props.testID === id));
    assert.ok(indexes.every((index) => index >= 0));
    assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
    assert.match(nodeText(output), /Opening night/);
    assert.match(nodeText(output), /This Week’s Games/);
    assert.match(nodeText(output), /Final/);
    assert.match(nodeText(output), /Alex Ace/);
    assert.doesNotMatch(nodeText(output), /Rink Shop|Featured Sponsors|Premier Partners|Powered by/);
    assert.equal(findNode(output, (node) => node.props.testID === 'home-sponsors-section'), undefined);
    assert.equal(findNode(output, (node) => /^home-personal-(loading|error|section)$/.test(String(node.props.testID))), undefined);
    assert.equal(runtime.queryCalls.length, 0);
  });

  it('uses the installed shell viewer-team accent after removing the personal Home loader', async () => {
    const output = await settle(createRuntime());
    const story = findNode(output, (node) => node.props.testID === 'focus-card-home:story:story-1');
    assert.equal(story?.props.accentColor, '#1F6A44');
  });

  it('preserves article, game, player, schedule, and notification routes', async () => {
    const runtime = createRuntime();
    const output = await settle(runtime);
    findNode(output, (node) => node.props.accessibilityLabel === 'Read Opening night')?.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Final. River Otters 4. Harbour Wolves 5. Sep 18 at 8:30 PM. North Forum')?.props.onPress();
    findNode(output, (node) => node.props.accessibilityRole === 'button' && nodeText(node).includes('Alex Ace'))?.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Open full schedule')?.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Updates')?.props.onPress();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(runtime.playerCalls, [{ playerId: 'player-leader', leagueId: 'league-1' }]);
    assert.deepEqual(runtime.navigationCalls, [
      ['LeaguePages', { screen: 'NewsArticle', params: { leagueId: 'league-1', leagueSlug: 'harbour-hockey', articleSlug: 'opening-night' } }],
      ['Schedule', { screen: 'GamePreview', initial: false, params: { gameId: 'week-final' } }], ['Schedule'], ['Profile', { screen: 'NotificationsFeed' }],
    ]);
    assert.deepEqual(runtime.linkCalls, []);
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

  it('isolates a goalie-feed error to GAA while Goals, Assists, and Points retain skater leaders', async () => {
    const goalieUnavailable = {
      ...snapshot,
      goalieLeaders: { status: 'error', data: [], message: 'Current-season goalie GAA is temporarily unavailable.' },
    };
    const runtime = createRuntime({ publicData: goalieUnavailable });
    await settle(runtime);

    let leaders = findNode(runtime.harness.output, (node) => node.type === 'HomeLeagueLeaders')!;
    assert.equal(leaders.props.status, 'ready');
    assert.match(nodeText(leaders), /Alex Ace/);
    findNode(leaders, (node) => node.props.testID === 'home-leaders-tab-gaa')!.props.onPress();
    runtime.harness.render();

    leaders = findNode(runtime.harness.output, (node) => node.type === 'HomeLeagueLeaders')!;
    assert.equal(leaders.props.status, 'error');
    assert.match(nodeText(leaders), /goalie GAA is temporarily unavailable/i);
    assert.doesNotMatch(nodeText(leaders), /Alex Ace/);

    findNode(leaders, (node) => node.props.testID === 'home-leaders-tab-points')!.props.onPress();
    runtime.harness.render();
    leaders = findNode(runtime.harness.output, (node) => node.type === 'HomeLeagueLeaders')!;
    assert.equal(leaders.props.status, 'ready');
    assert.match(nodeText(leaders), /Alex Ace/);
  });

  it('never renders old-league GAA rows under the new league identity during a league switch', async () => {
    const leagueBGoalie = {
      ...snapshot.goalieLeaders.data[0],
      player_id: 'goalie-league-2',
      player_name: 'Lakeside Goalie',
      team_id: 'falcons',
      team_name: 'Lakeside Falcons',
      display_team_name: 'Lakeside Falcons',
      gaa: 2,
    };
    const leagueBSnapshot = {
      ...snapshot,
      leagueId: leagueB.id,
      leagueSlug: leagueB.slug,
      presentationSeason: { ...snapshot.presentationSeason, id: 'season-2', league_id: leagueB.id },
      goalieLeaders: { status: 'ready', data: [leagueBGoalie] },
    };
    const runtime = createRuntime({ publicResults: [snapshot, leagueBSnapshot] });
    await settle(runtime);
    findNode(runtime.harness.output, (node) => node.props.testID === 'home-leaders-tab-gaa')!.props.onPress();
    runtime.harness.render();
    assert.match(nodeText(findNode(runtime.harness.output, (node) => node.type === 'HomeLeagueLeaders')), /Steven Wild/);

    runtime.leaderRenders.length = 0;
    runtime.switchIdentity();

    const switchRenders = runtime.leaderRenders.filter((render) => render.leagueId === leagueB.id && render.metric === 'gaa');
    assert.ok(switchRenders.length > 0, 'the mounted switch must exercise the GAA render boundary');
    assert.equal(
      switchRenders.some((render) => render.leaders.some((row) => row.player_id === 'goalie-leader')),
      false,
      'a snapshot from league 1 must never render with league 2 navigation and focus identity',
    );

    await settle(runtime);
    const settled = findNode(runtime.harness.output, (node) => node.type === 'HomeLeagueLeaders')!;
    assert.equal(settled.props.leagueId, leagueB.id);
    assert.match(nodeText(settled), /Lakeside Goalie/);
    assert.doesNotMatch(nodeText(settled), /Steven Wild/);
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
    const pager = findNode(runtime.harness.output, (node) => node.props.testID === 'home-news-pager');
    assert.ok(pager);
    assert.equal(pager.props.horizontal, true);
    assert.equal(pager.props.pagingEnabled, true);
    assert.equal(pager.props.directionalLockEnabled, true);
    assert.ok(findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Read Opening night'));
    assert.ok(findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Read Championship recap'));
    pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 320 }, layoutMeasurement: { width: 320 } } });
    runtime.harness.render();
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-indicator')?.props.accessibilityValue.now, 2);
    pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 }, layoutMeasurement: { width: 320 } } });
    runtime.harness.render();
    const next = findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Next story');
    assert.ok(next);
    assert.ok((flattenStyle(next.props.style).minHeight ?? flattenStyle(next.props.style).height) >= 44);
    next.props.onPress();
    runtime.harness.render();
    assert.match(nodeText(runtime.harness.output), /Championship recap/);
    findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Read Championship recap')?.props.onPress();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(runtime.navigationCalls.at(-1), ['LeaguePages', { screen: 'NewsArticle', params: { leagueId: 'league-1', leagueSlug: 'harbour-hockey', articleSlug: 'championship-recap' } }]);
    assert.deepEqual(runtime.linkCalls, []);

    await refresh(runtime);
    assert.match(nodeText(runtime.harness.output), /Opening night/);
    assert.doesNotMatch(nodeText(runtime.harness.output), /Championship recap/);
  });

  it('does not animate Latest News position changes when Reduced Motion is enabled', async () => {
    const secondStory = { ...snapshot.articles.data[0], id: 'story-2', title: 'Second story', slug: 'second-story' };
    const runtime = createRuntime({ reduceMotion: true, publicData: { ...snapshot, articles: { status: 'ready', data: [snapshot.articles.data[0], secondStory] } } });
    await settle(runtime);
    findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Next story')?.props.onPress();
    runtime.harness.render();
    assert.equal(runtime.animationCalls.length, 0);
  });

  it('preserves selected story identity, physical offset, and announced position across width and refreshed arrays', async () => {
    const stories = ['One', 'Two', 'Three'].map((title, index) => ({
      ...snapshot.articles.data[0], id: `story-${index + 1}`, slug: title.toLowerCase(), title,
    }));
    const initial = { ...snapshot, articles: { status: 'ready', data: stories } };
    const reordered = { ...snapshot, articles: { status: 'ready', data: [stories[1], stories[0], stories[2]] } };
    const removed = { ...snapshot, articles: { status: 'ready', data: [stories[0], stories[2]] } };
    const runtime = createRuntime({ reduceMotion: true, publicResults: [initial, reordered, removed] });
    await settle(runtime);
    findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Next story')?.props.onPress();
    runtime.harness.render();
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-indicator')?.props.accessibilityValue.text, '2 of 3');

    runtime.resize(400);
    assert.deepEqual(runtime.scrollCalls.at(-1), { x: 368, animated: false });
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-indicator')?.props.accessibilityValue.text, '2 of 3');

    await refresh(runtime);
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-indicator')?.props.accessibilityValue.text, '1 of 3');
    assert.deepEqual(runtime.scrollCalls.at(-1), { x: 0, animated: false });

    await refresh(runtime);
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-indicator')?.props.accessibilityValue.text, '1 of 2');
    assert.equal(runtime.animationCalls.length, 0);
  });

  it('renders only the first four sorted stories with matching controls and bounded images', async () => {
    const stories = Array.from({ length: 6 }, (_, index) => ({
      ...snapshot.articles.data[0], id: `story-${index}`, title: `Latest ${index + 1}`, slug: `latest-${index + 1}`, image_url: `https://images.test/${index}.jpg`,
    }));
    const runtime = createRuntime({ publicData: { ...snapshot, articles: { status: 'ready', data: stories } } });
    await settle(runtime);
    const pager = findNode(runtime.harness.output, (node) => node.props.testID === 'home-news-pager');
    assert.equal(Array.isArray(pager?.props.children) ? pager.props.children.length : 0, 4);
    assert.ok(allNodes(pager).filter((node) => node.type === 'Image' && typeof node.props.source?.uri === 'string').length <= 3);
    assert.ok(findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Read Latest 1'));
    assert.equal(findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Read Latest 5'), undefined);
    const indicator = findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-indicator');
    assert.equal(indicator?.props.accessibilityValue.max, 4);
    assert.equal(nodeText(findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-count')), '1 / 4');
    assert.equal(allNodes(indicator).filter((node) => flattenStyle(node.props.style).width === 6).length, 0);
    for (const label of ['Previous story', 'Next story']) {
      const button = findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === label);
      const style = flattenStyle(button?.props.style);
      assert.deepEqual([style.width, style.height, style.flexShrink], [44, 44, 0]);
    }
    for (let index = 0; index < 3; index += 1) {
      findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Next story')!.props.onPress();
      runtime.harness.render();
    }
    assert.match(nodeText(runtime.harness.output), /Latest 4/);
    assert.doesNotMatch(nodeText(runtime.harness.output), /Latest 5|Latest 6/);
    runtime.resize(320);
    assert.equal(nodeText(findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-count')), '4 / 4');
    runtime.resize(390);
    assert.equal(nodeText(findNode(runtime.harness.output, (node) => node.props.testID === 'home-story-count')), '4 / 4');
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
    for (const fact of ['Opening night', 'Alex Ace', 'News refresh failed.', 'Games refresh failed.', 'Leaders refresh failed.', 'Standings refresh failed.', 'Photos refresh failed.', 'Albums refresh failed.']) {
      assert.match(text, new RegExp(fact.replace(/[.]/g, '\\.')));
    }
    assert.doesNotMatch(text, /Rink Shop|Sponsors refresh failed|Featured Sponsors|Premier Partners|Powered by/);
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

  it('contains an unexpected public loader rejection without restoring removed personal content', async () => {
    const runtime = createRuntime({ publicData: new Error('unexpected loader failure') });
    const output = await settle(runtime);
    assert.match(nodeText(output), /News is temporarily unavailable/);
    assert.equal(findNode(output, (node) => /^home-personal-/.test(String(node.props.testID))), undefined);
  });
});
