/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness';
import * as leagueContentModel from '../../src/lib/leagueContentModel.ts';
import * as leaguePagesModel from '../../src/lib/leaguePagesModel.ts';

const colors = { __esModule: true, default: { primary: '#0ff', bgBase: '#000', bgSurface: '#111', bgInteractive: '#222', bgElevated: '#112', textPrimary: '#fff', textSecondary: '#aaa', textOnPrimary: '#001', textInteractive: '#6ef', glassStroke: '#333' } };
const native = { FlatList: ({ data = [], renderItem, ListHeaderComponent, ListEmptyComponent, ...props }: Record<string, any>) => createElement('FlatList', { ...props, data, renderItem }, ListHeaderComponent, ...(data.length ? data.map((item: unknown, index: number) => renderItem({ item, index })) : [ListEmptyComponent])), Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (value: any) => value } };

function findNodes(root: unknown, predicate: (node: TestNode) => boolean): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(child => findNodes(child, predicate));
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [...(predicate(node) ? [node] : []), ...findNodes(node.props.children, predicate)];
}

describe('mounted native content navigation', () => {
  it('renders the actual News feed composition and navigates a real article identity in-stack', () => {
    const harness = createHookHarness(); const calls: unknown[][] = [];
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsFeedScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': native,
      '@expo/vector-icons': { Ionicons: 'Icon' },
      '../../lib/leagueContentModel': leagueContentModel,
      '../../theme/colors': colors,
      './LeaguePageCommon': {
        useLeaguePageScope: (scope: unknown) => scope,
        LeaguePageFrame: (props: any) => createElement('LeaguePageFrame', props, props.children),
        PageHeader: (props: any) => createElement('PageHeader', props, props.title, props.detail),
        PageLoadState: (props: any) => createElement('PageLoadState', props),
      },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: {
        schemaVersion: 1, view: 'news', league: { id: 'league-1', slug: 'hockey-life', name: 'Synthetic League', logoUrl: null }, total: 1,
        articles: [{ id: 'article-id', slug: 'synthetic-story', title: 'Mounted synthetic story', excerpt: 'Synthetic excerpt.', imageUrl: null, type: 'weekly_wrap', publishedAt: '2026-01-01T00:00:00Z', authorName: null, authorId: null }],
      } }) },
    }).default;
    const route = { params: { leagueId: 'league-1', leagueSlug: 'hockey-life' } };
    const output = harness.mount(() => Screen({ route, navigation: { navigate: (...args: unknown[]) => calls.push(args) } }));
    assert.match(nodeText(output), /All 1Recaps 1News 0/);
    assert.match(nodeText(output), /Mounted synthetic story/);
    assert.equal(findNode(output, node => node.type === 'FlatList')?.props.testID, 'news-feed-list');
    const story = findNode(output, node => node.props.accessibilityLabel === 'Mounted synthetic story, Read story');
    assert.ok(story);
    story.props.onPress();
    assert.deepEqual(calls, [['NewsArticle', { leagueId: 'league-1', leagueSlug: 'hockey-life', articleSlug: 'synthetic-story' }]]);
  });

  it('guards league identity before effects and rejects stale out-of-order content', async () => {
    const harness = createHookHarness();
    let releaseA!: (value: any) => void; let releaseB!: (value: any) => void;
    const pendingA = new Promise(resolve => { releaseA = resolve; });
    const pendingB = new Promise(resolve => { releaseB = resolve; });
    const contentHooks = compileCommonJs<any>(new URL('../../src/screens/league-pages/ContentPageCommon.tsx', import.meta.url), {
      react: harness.react,
      '../../lib/leaguePagesModel': leaguePagesModel,
      '../../lib/leagueContent': { getLeagueContent: (slug: string) => slug === 'league-a' ? pendingA : pendingB },
    });
    let scope = { leagueId: 'league-a-id', leagueSlug: 'league-a' };
    harness.mount(() => contentHooks.useLeagueContent(scope, { view: 'news' }));
    scope = { leagueId: 'league-b-id', leagueSlug: 'league-b' };
    harness.render();
    assert.equal((harness.output as any).data, null);
    releaseB({ schemaVersion: 1, view: 'news', league: { id: 'league-b-id' }, articles: [], total: 0 });
    await new Promise<void>(resolve => setImmediate(resolve)); harness.render();
    assert.equal((harness.output as any).data.league.id, 'league-b-id');
    releaseA({ schemaVersion: 1, view: 'news', league: { id: 'league-a-id' }, articles: [{ title: 'STALE' }], total: 1 });
    await new Promise<void>(resolve => setImmediate(resolve)); harness.render();
    assert.equal((harness.output as any).data.league.id, 'league-b-id');
  });

  it('renders the complete article readably and keeps inline links and mentions native', () => {
    const harness = createHookHarness(); const calls: unknown[][] = []; const browserCalls: string[] = [];
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { ...native, Linking: { openURL: (url: string) => { browserCalls.push(url); return Promise.resolve(); } } },
      '../../components/Avatar': { __esModule: true, default: (props: any) => createElement('Avatar', props) },
      '../../components/TeamLogo': { __esModule: true, default: (props: any) => createElement('TeamLogo', props) },
      '../../lib/leagueContentModel': leagueContentModel,
      '../../theme/colors': colors,
      './LeaguePageCommon': {
        useLeaguePageScope: (scope: unknown) => scope,
        LeaguePageFrame: (props: any) => createElement('LeaguePageFrame', props, props.children),
        PageLoadState: (props: any) => createElement('PageLoadState', props),
        commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} },
      },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: {
        schemaVersion: 1, view: 'article', league: { id: 'league-1', slug: 'hockey-life', name: 'Synthetic League', logoUrl: null },
        article: {
          id: 'article-id', slug: 'synthetic-story', title: 'Complete story', excerpt: null, imageUrl: null, type: 'news', publishedAt: '2026-01-01T00:00:00Z', authorName: null, authorId: null,
          content: '## Recorded Result\n\nEvery **published** sentence survives with [the team](/teams/id/22222222-2222-4222-8222-222222222222).\n\n- Final source line',
          mentions: [{ text: 'Recorded game', kind: 'game', id: '33333333-3333-4333-8333-333333333333' }], taggedPlayers: [], relatedGame: null,
        },
      } }) },
    }).default;
    const navigation = { goBack() {}, navigate: (...args: unknown[]) => calls.push(args), push: (...args: unknown[]) => calls.push(args) };
    const output = harness.mount(() => Screen({ route: { params: { leagueId: 'league-1', leagueSlug: 'hockey-life', articleSlug: 'synthetic-story' } }, navigation }));
    const text = nodeText(output);
    assert.match(text, /Recorded Result/);
    assert.match(text, /Every published sentence survives with the team\./);
    assert.match(text, /Final source line/);
    assert.doesNotMatch(text, /##|\*\*/);
    findNode(output, node => node.props.accessibilityRole === 'link' && nodeText(node) === 'the team')!.props.onPress();
    findNode(output, node => node.props.accessibilityLabel === 'View Recorded game')!.props.onPress();
    assert.deepEqual(calls, [
      ['LeagueTeamDetail', { teamId: '22222222-2222-4222-8222-222222222222', leagueId: 'league-1' }],
      ['LeagueGamePreview', { gameId: '33333333-3333-4333-8333-333333333333' }],
    ]);
    assert.deepEqual(browserCalls, []);
  });

  it('labels a standings fallback honestly and opens standings for its actual season', () => {
    const harness = createHookHarness();
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/LeagueHistoryScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': native,
      '../../components/TeamLogo': { __esModule: true, default: (props: any) => createElement('TeamLogo', props) },
      '../../theme/colors': colors,
      './LeaguePageCommon': {
        useLeaguePageScope: (scope: unknown) => scope,
        LeaguePageFrame: (props: any) => createElement('LeaguePageFrame', props, props.children),
        PageHeader: (props: any) => createElement('PageHeader', props, props.title, props.detail),
        PageLoadState: (props: any) => createElement('PageLoadState', props),
        commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} },
      },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: {
        schemaVersion: 1, view: 'history', league: { id: 'league-1', slug: 'hockey-life', name: 'Synthetic League', logoUrl: null }, foundingYear: null,
        seasons: [{ id: 'spring-id', name: 'Spring 2026', startDate: '2026-04-02', endDate: '2026-06-26', status: 'completed' }],
        champions: [{ id: 'fallback', source: 'standings_leader', year: '2026', seasonId: 'spring-id', seasonName: 'Spring 2026', teamId: null, teamName: 'Table Leader', teamLogoUrl: null, photoUrl: null, record: null, roster: [], finalGame: null, summary: null, caption: null }],
        seasonStandings: [{ seasonId: 'spring-id', rows: [{ teamId: 'team-id', teamName: 'Actual Season Team', teamLogoUrl: null, gamesPlayed: 10, wins: 8, losses: 2, ties: 0, points: 16 }] }],
        dynasties: [], boards: [], awards: [], stats: { totalSeasons: 1, totalGames: 10, totalTeams: 1, uniqueChampions: 0 },
      } }) },
    }).default;
    let output = harness.mount(() => Screen({ route: { params: { leagueId: 'league-1', leagueSlug: 'hockey-life' } }, navigation: { navigate() {} } }));
    assert.match(nodeText(output), /Standings Leader — not a confirmed champion/);
    const openStandings = findNode(output, node => node.type === 'Pressable' && /View Spring 2026 standings/.test(nodeText(node)));
    assert.ok(openStandings);
    openStandings.props.onPress();
    output = harness.render();
    assert.match(nodeText(output), /Spring 2026 StandingsSeason-scoped historical standings/);
    assert.match(nodeText(output), /Actual Season Team/);
  });

  it('opens a proven championship final with exact native route identity and leaves a null-id final noninteractive', () => {
    const finalGame = { id: '33333333-3333-4333-8333-333333333333', homeTeamId: null, homeTeamName: 'North Stars', homeTeamLogoUrl: null, awayTeamId: null, awayTeamName: 'Red Rockets', awayTeamLogoUrl: null, homeScore: 5, awayScore: 3, scheduledAt: '2025-12-01T20:00:00Z', status: 'completed' };
    const history = (id: string | null) => ({
      schemaVersion: 1, view: 'history', league: { id: 'league-1', slug: 'hockey-life', name: 'Synthetic League', logoUrl: null }, foundingYear: null,
      seasons: [], champions: [{ id: 'champion', source: 'official', year: '2025', seasonId: null, seasonName: 'Autumn 2025', teamId: null, teamName: 'North Stars', teamLogoUrl: null, photoUrl: null, record: null, roster: [], finalGame: { ...finalGame, id }, summary: null, caption: null }],
      seasonStandings: [], dynasties: [], boards: [], awards: [], stats: { totalSeasons: 1, totalGames: 1, totalTeams: 2, uniqueChampions: 1 },
    });
    const mountHistory = (data: ReturnType<typeof history>) => {
      const harness = createHookHarness(); const calls: unknown[][] = [];
      const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/LeagueHistoryScreen.tsx', import.meta.url), {
        react: harness.react, 'react-native': native,
        '../../components/TeamLogo': { __esModule: true, default: (props: any) => createElement('TeamLogo', props) }, '../../theme/colors': colors,
        './LeaguePageCommon': { useLeaguePageScope: (scope: unknown) => scope, LeaguePageFrame: (props: any) => createElement('LeaguePageFrame', props, props.children), PageHeader: (props: any) => createElement('PageHeader', props, props.title, props.detail), PageLoadState: (props: any) => createElement('PageLoadState', props), commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: { minHeight: 48 }, secondaryButtonText: {} } },
        './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data }) },
      }).default;
      const output = harness.mount(() => Screen({ route: { params: { leagueId: 'league-1', leagueSlug: 'hockey-life' } }, navigation: { navigate: (...args: unknown[]) => calls.push(args) } }));
      return { output, calls };
    };

    const linked = mountHistory(history(finalGame.id));
    const action = findNode(linked.output, node => node.props.accessibilityLabel === 'View championship final game');
    assert.ok(action);
    assert.equal(action.props.accessibilityRole, 'button');
    assert.ok(flattenStyle(action.props.style).minHeight >= 44);
    action.props.onPress();
    assert.deepEqual(linked.calls, [['LeagueGamePreview', { gameId: finalGame.id, leagueId: 'league-1' }]]);

    const disclosed = mountHistory(history(null));
    assert.match(nodeText(disclosed.output), /Championship final: Red Rockets 3 · North Stars 5/);
    assert.equal(findNode(disclosed.output, node => node.props.accessibilityLabel === 'View championship final game'), undefined);
    assert.equal(findNodes(disclosed.output, node => node.type === 'Pressable' && /Championship final/.test(nodeText(node))).length, 0);
  });

  it('gives each valid History board identity its own 44px semantic target while nullable identities stay text-only', () => {
    const harness = createHookHarness();
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/LeagueHistoryScreen.tsx', import.meta.url), {
      react: harness.react, 'react-native': native,
      '../../components/TeamLogo': { __esModule: true, default: (props: any) => createElement('TeamLogo', props) }, '../../theme/colors': colors,
      './LeaguePageCommon': { useLeaguePageScope: (scope: unknown) => scope, LeaguePageFrame: (props: any) => createElement('LeaguePageFrame', props, props.children), PageHeader: (props: any) => createElement('PageHeader', props, props.title, props.detail), PageLoadState: (props: any) => createElement('PageLoadState', props), commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} } },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: {
        schemaVersion: 1, view: 'history', league: { id: 'league-1', slug: 'hockey-life', name: 'Synthetic League', logoUrl: null }, foundingYear: null, seasons: [], champions: [], seasonStandings: [], dynasties: [], awards: [], stats: { totalSeasons: 0, totalGames: 0, totalTeams: 0, uniqueChampions: 0 },
        boards: [{ metric: 'points', title: 'Points', limit: 25, entries: [
          { id: 'linked', playerId: '11111111-1111-4111-8111-111111111111', name: 'A Very Long Player Name That Wraps', teamId: '22222222-2222-4222-8222-222222222222', teamName: 'North Stars', value: 100, savePercentage: null, goalsAgainstAverage: null, provenance: 'Published record' },
          { id: 'unlinked', playerId: null, name: 'Legacy Player', teamId: null, teamName: 'Legacy Team', value: null, savePercentage: null, goalsAgainstAverage: null, provenance: null },
        ] }],
      } }) },
    }).default;
    const output = harness.mount(() => Screen({ route: { params: { leagueId: 'league-1', leagueSlug: 'hockey-life' } }, navigation: { navigate() {} } }));
    const player = findNode(output, node => node.props.accessibilityLabel === 'View player A Very Long Player Name That Wraps');
    const team = findNode(output, node => node.props.accessibilityLabel === 'View team North Stars');
    assert.ok(player); assert.ok(team); assert.notEqual(player, team);
    assert.equal(player.props.accessibilityRole, 'button'); assert.equal(team.props.accessibilityRole, 'button');
    assert.ok(flattenStyle(player.props.style).minHeight >= 44); assert.ok(flattenStyle(team.props.style).minHeight >= 44);
    assert.equal(findNodes(output, node => node.type === 'Pressable' && /Legacy Player|Legacy Team/.test(nodeText(node))).length, 0);
    assert.match(nodeText(output), /Legacy PlayerLegacy Team—/);
  });
});
