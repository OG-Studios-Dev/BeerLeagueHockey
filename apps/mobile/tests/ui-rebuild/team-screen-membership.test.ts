/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

const leagueA = { id: 'league-a', name: 'Harbour League', slug: 'harbour', city: 'Hamilton' };
const leagueB = { id: 'league-b', name: 'Lakeside League', slug: 'lakeside', city: 'Burlington' };

function createRuntime({
  activeLeague = leagueA as typeof leagueA | null,
  reduceTransparency = false,
  isGuestLeague = false,
  teamApi = {},
}: {
  activeLeague?: typeof leagueA | null;
  reduceTransparency?: boolean;
  isGuestLeague?: boolean;
  teamApi?: Record<string, (...args: any[]) => any>;
} = {}) {
  const harness = createHookHarness();
  const navigationCalls: unknown[][] = [];
  const leagueSelections: unknown[] = [];
  const leagueOptions = [leagueA, leagueB];
  const oldRoster = [{ id: 'old-roster', player_id: 'old-player', team_id: 'old-team', player_name: 'Old Team Player', avatar_url: null, jersey_number: 44, position: 'forward', is_goalie: false }];
  const currentRoster = [{ id: 'current-roster', player_id: 'current-player', team_id: 'current-team', player_name: 'Current Team Player', avatar_url: null, jersey_number: 9, position: 'forward', is_goalie: false }];

  const unscopedGlobalRows = [
    { team_id: 'old-team', league_id: 'league-a', season_id: 'season-old', jersey_number: 44, position: 'forward', team: { id: 'old-team', name: 'Old Wolves', logo_url: null, primary_color: '#999999' }, league: leagueA },
    { team_id: 'current-team', league_id: 'league-a', season_id: 'season-a', jersey_number: 9, position: 'forward', team: { id: 'current-team', name: 'Current Comets', logo_url: null, primary_color: '#22D3EE' }, league: leagueA },
  ];
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: unscopedGlobalRows, error: null }).then(resolve),
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'viewer' } } }) },
    from: () => chain,
  };

  const colors = {
    primary: '#22D3EE', bgBase: '#07111F', bgSurface: 'rgba(12, 27, 49, 0.72)',
    bgInteractive: 'rgba(28, 42, 66, 0.84)', textPrimary: '#F7FBFF', textSecondary: '#A8B4C8',
    borderCard: 'rgba(255, 255, 255, 0.1)',
  };
  const FlatList = ({ data, renderItem, ListHeaderComponent, ...props }: Record<string, any>) =>
    createElement('FlatList', props, ListHeaderComponent, ...(data ?? []).map((item: unknown, index: number) => renderItem({ item, index })));

  const TeamScreen = compileCommonJs<{ default: (props: Record<string, any>) => unknown }>(
    new URL('../../src/screens/TeamScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', FlatList, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles },
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../components/Avatar': (props: Record<string, unknown>) => createElement('Avatar', props),
      '../components/BrandAtmosphere': (props: Record<string, unknown>) => createElement('BrandAtmosphere', props),
      '../components/GuestBanner': () => createElement('GuestBanner', null),
      '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../components/SectionHeader': ({ title }: { title: string }) => createElement('Text', null, title),
      '../context/LeagueContext': {
        useLeague: () => ({
          activeLeague,
          activeTheme: { primaryColor: '#22D3EE', secondaryColor: '#2563EB', backgroundColor: '#07111F', textColor: '#F7FBFF' },
          isGuestLeague,
          availableLeagues: leagueOptions,
          setActiveLeague: async (league: unknown) => { leagueSelections.push(league); },
        }),
      },
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: false, reduceTransparency }) },
      '../lib/supabase/client': { supabase },
      '../lib/supabase/data': {
        getUserTeamInLeague: async () => ({ team_id: 'old-team', team_name: 'Old Wolves', short_name: 'OLD', primary_color: '#999999', logo_url: null }),
        getTeamRoster: async () => oldRoster,
      },
      '../lib/supabase/team': {
        getTeamActiveSeason: async () => ({ season: { id: 'season-a', name: 'Fall 2026', start_date: '2026-09-01', end_date: null, status: 'active' }, error: null }),
        getActiveSeasonTeamForUser: async () => ({ team_id: 'current-team', team_name: 'Current Comets', primary_color: '#22D3EE', logo_url: null }),
        getActiveSeasonRoster: async () => currentRoster,
        getActiveSeasonMembershipsForUser: async () => ({
          data: [{ leagueId: 'league-a', leagueName: leagueA.name, leagueCity: leagueA.city, seasonId: 'season-a', seasonName: 'Fall 2026', teamId: 'current-team', teamName: 'Current Comets', teamLogoUrl: null, teamPrimaryColor: '#22D3EE', jerseyNumber: 9, position: 'forward' }],
          error: null,
        }),
        ...teamApi,
      },
      '../navigation/playerCard': { navigateToPlayerCard: (...args: unknown[]) => navigationCalls.push(args) },
      '../theme/colors': { default: colors },
    },
  ).default;

  harness.mount(() => TeamScreen({ navigation: { navigate: (...args: unknown[]) => navigationCalls.push(args) } }));
  return { harness, leagueSelections, navigationCalls };
}

async function settle(runtime: ReturnType<typeof createRuntime>) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    runtime.harness.render();
  }
  return runtime.harness.output;
}

describe('Team membership selection', () => {
  it('uses the current active-season membership instead of an older active-status row', async () => {
    const text = nodeText(await settle(createRuntime()));
    assert.match(text, /Current Comets/);
    assert.match(text, /Current Team Player/);
    assert.doesNotMatch(text, /Old Wolves|Old Team Player/);
  });

  it('fails closed to Hockey Life when no active Hockey Life membership is available', async () => {
    const text = nodeText(await settle(createRuntime({ activeLeague: null })));
    assert.match(text, /Hockey Life access required/);
    assert.doesNotMatch(text, /Current Comets|Old Wolves/);
  });

  it('renders explicit no-active-season and lookup-error states', async () => {
    const noSeason = await settle(createRuntime({
      teamApi: { getTeamActiveSeason: async () => ({ season: null, error: null }) },
    }));
    assert.match(nodeText(noSeason), /No active season/);

    const error = await settle(createRuntime({
      teamApi: { getTeamActiveSeason: async () => ({ season: null, error: 'Synthetic active season lookup error' }) },
    }));
    assert.match(nodeText(error), /Unable to load team/);
    assert.doesNotMatch(nodeText(error), /No active season/);
  });

  it('uses responsive public Team glass and the opaque accessibility fallback', async () => {
    const glass = await settle(createRuntime());
    const identity = findNode(glass, (node) => node.props.testID === 'team-list-identity-card');
    assert.ok(identity);
    assert.match(nodeText(identity), /Current Comets/);
    assert.match(nodeText(identity), /Fall 2026/);
    assert.equal(flattenStyle(identity.props.style).backgroundColor, 'rgba(10, 22, 40, 0.30)');
    assert.equal(flattenStyle(identity.props.style).borderColor, 'rgba(125, 190, 255, 0.22)');

    const opaque = await settle(createRuntime({ reduceTransparency: true }));
    const opaqueIdentity = findNode(opaque, (node) => node.props.testID === 'team-list-identity-card');
    assert.ok(opaqueIdentity);
    assert.equal(flattenStyle(opaqueIdentity.props.style).backgroundColor, '#0C1B31');
    assert.equal(flattenStyle(opaqueIdentity.props.style).borderColor, '#41607F');
  });
});
