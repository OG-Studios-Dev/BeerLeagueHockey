import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutAnimation,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import hockeyLifeLogo from '../../assets/hockey-life-logo.png';
import GuestBanner from '../components/GuestBanner';
import { FocusCard, FocusScrollView } from '../components/CardFocus';
import HomeLeagueHero from '../components/HomeLeagueHero';
import HomeLeagueLeaders from '../components/HomeLeagueLeaders';
import RevealView from '../components/RevealView';
import TeamLogo from '../components/TeamLogo';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useLeague } from '../context/LeagueContext';
import { navigateToPlayerCard } from '../navigation/playerCard';
import { useMobileShellData } from '../navigation/MobileShellDataContext';
import {
  type HomeArticle,
  type HomePublicSnapshot,
  type HomeSection,
  type HomeStanding,
  type HomeWeeklyGame,
  loadHomePublicSnapshot,
  normalizeHomeGameStatus,
  toSafeWebUrl,
} from '../lib/supabase/home';
import type { HomeLeaderMetric } from '../lib/homeLeagueLeaders';
import colors from '../theme/colors';
import { getHomeVisualPreferences, HOME_VISUAL_TOKENS as homeTokens } from '../theme/home';

type HomeNavigation = {
  navigate?: (...args: unknown[]) => void;
  getState?: () => { routeNames?: string[] };
};
type HomeScreenProps = { navigation?: HomeNavigation };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function articleExcerpt(article: HomeArticle) {
  const raw = article.excerpt || (typeof article.content === 'string' ? article.content : '');
  const plain = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 140 ? `${plain.slice(0, 137).trimEnd()}…` : plain;
}

function articleLabel(type: string | null) {
  if (type === 'game_recap') return 'GAME RECAP';
  if (type === 'weekly_wrap') return 'WEEKLY WRAP';
  return 'LEAGUE STORY';
}


function weeklyGameAccessibilityLabel(game: HomeWeeklyGame) {
  const away = game.away_team?.name ?? game.away_team_id;
  const home = game.home_team?.name ?? game.home_team_id;
  const status = normalizeHomeGameStatus(game.status);
  const when = `${formatDate(game.scheduled_at)} at ${formatTime(game.scheduled_at)}`;
  const location = game.location || 'Location unavailable';
  if (status === 'Final' || status === 'Live') {
    const awayScore = game.away_score ?? 'score unavailable';
    const homeScore = game.home_score ?? 'score unavailable';
    return `${status}. ${away} ${awayScore}. ${home} ${homeScore}. ${when}. ${location}`;
  }
  return `${status}. ${away} at ${home}. ${when}. ${location}`;
}

function mergeSection<T>(previous: HomeSection<T>, next: HomeSection<T>, hasFacts: (value: T) => boolean) {
  if (next.status === 'error' && hasFacts(previous.data)) return { ...next, data: previous.data };
  return next;
}

function mergeRefresh(previous: HomePublicSnapshot | null, next: HomePublicSnapshot) {
  if (!previous) return next;
  if (previous.leagueId !== next.leagueId || previous.leagueSlug !== next.leagueSlug) return next;
  const hasArrayFacts = (value: unknown[]) => value.length > 0;
  const samePeriod = previous.presentationSeason?.id === next.presentationSeason?.id;
  const sameWeek = samePeriod && previous.weekKey === next.weekKey;
  return {
    ...next,
    articles: samePeriod ? mergeSection(previous.articles, next.articles, hasArrayFacts) : next.articles,
    weeklyGames: sameWeek ? mergeSection(previous.weeklyGames, next.weeklyGames, hasArrayFacts) : next.weeklyGames,
    leaders: samePeriod ? mergeSection(previous.leaders, next.leaders, hasArrayFacts) : next.leaders,
    standings: samePeriod ? mergeSection(previous.standings, next.standings, hasArrayFacts) : next.standings,
    divisions: samePeriod && next.standings.status === 'error' ? previous.divisions : next.divisions,
    photos: mergeSection(previous.photos, next.photos, hasArrayFacts),
    albums: samePeriod ? mergeSection(previous.albums, next.albums, hasArrayFacts) : next.albums,
    community: mergeSection(previous.community, next.community, hasArrayFacts),
    sponsors: mergeSection(previous.sponsors, next.sponsors, hasArrayFacts),
  };
}

function failedPublicSnapshot(leagueId: string, leagueSlug: string): HomePublicSnapshot {
  const error = <T,>(data: T, message: string): HomeSection<T> => ({ status: 'error', data, message });
  return {
    leagueId, leagueSlug, presentationSeason: null, timezone: null, weekKey: null, divisions: [],
    articles: error([], 'News is temporarily unavailable.'),
    weeklyGames: error([], 'This week’s games are temporarily unavailable.'),
    leaders: error([], 'Current-season leaders are temporarily unavailable.'),
    standings: error([], 'Standings are temporarily unavailable.'),
    photos: error([], 'League photos are temporarily unavailable.'),
    albums: error([], 'League albums are temporarily unavailable.'),
    community: error([], 'Community links are temporarily unavailable.'),
    sponsors: error([], 'Sponsors are temporarily unavailable.'),
  };
}

function markSnapshotFailed(snapshot: HomePublicSnapshot): HomePublicSnapshot {
  const stale = <T,>(section: HomeSection<T>, message: string): HomeSection<T> => ({
    status: 'error', data: section.data, message,
  });
  return {
    ...snapshot,
    // A rejected load cannot establish which season/week is current. Only the
    // intentionally all-season reel and non-period community/partner facts survive.
    presentationSeason: null, weekKey: null, divisions: [],
    articles: stale({ ...snapshot.articles, data: [] }, 'News refresh failed. Current season unavailable.'),
    weeklyGames: stale({ ...snapshot.weeklyGames, data: [] }, 'Games refresh failed. Current week unavailable.'),
    leaders: stale({ ...snapshot.leaders, data: [] }, 'Leaders refresh failed. Current season unavailable.'),
    standings: stale({ ...snapshot.standings, data: [] }, 'Standings refresh failed. Current season unavailable.'),
    photos: stale(snapshot.photos, 'Photos refresh failed. Showing the last loaded reel.'),
    albums: stale({ ...snapshot.albums, data: [] }, 'Albums refresh failed. Current season unavailable.'),
    community: stale(snapshot.community, 'Community refresh failed. Showing the last loaded links.'),
    sponsors: stale(snapshot.sponsors, 'Sponsor refresh failed. Showing the last loaded partners.'),
  };
}

function HomeArenaBackdrop({ accentColor, showAtmosphericGlow }: { accentColor: string; showAtmosphericGlow: boolean }) {
  return (
    <View testID="home-arena-backdrop" pointerEvents="none" style={styles.arenaBackdrop}>
      <LinearGradient colors={[homeTokens.canvas, homeTokens.navy, homeTokens.ink]} start={{ x: 0, y: 0 }} end={{ x: 0.85, y: 1 }} style={StyleSheet.absoluteFill} />
      {showAtmosphericGlow ? (
        <LinearGradient testID="home-atmospheric-glow" colors={[`${accentColor}24`, 'rgba(255,255,255,0.03)', 'transparent']} start={{ x: 0.05, y: 0 }} end={{ x: 0.9, y: 0.62 }} style={styles.arenaGlow} />
      ) : null}
      <View testID="home-rink-lines" style={styles.arenaRink}><View style={styles.arenaCenterLine} /><View style={styles.arenaCenterCircle} /></View>
    </View>
  );
}

function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionHeadingCopy}><Text style={styles.sectionEyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View>
      {action}
    </View>
  );
}

function SectionState({ loading, message, onRetry }: { loading?: boolean; message?: string; onRetry: () => void }) {
  return (
    <View style={styles.sectionState} accessibilityLiveRegion="polite">
      {loading ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="cloud-offline-outline" size={20} color={colors.textSecondary} />}
      <Text style={styles.sectionStateText}>{loading ? 'Loading' : message}</Text>
      {!loading ? <Pressable accessibilityRole="button" accessibilityLabel="Retry league home" style={styles.retryButton} onPress={onRetry}><Text style={styles.retryText}>Retry</Text></Pressable> : null}
    </View>
  );
}

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const { activeLeague, activeTheme } = useLeague();
  const { focusAccent } = useMobileShellData();
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();
  const { width, height, fontScale } = useWindowDimensions();
  const visuals = getHomeVisualPreferences(reduceTransparency, reduceMotion);
  const requestGeneration = React.useRef(0);
  const [publicHome, setPublicHome] = React.useState<HomePublicSnapshot | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [leaderMetric, setLeaderMetric] = React.useState<HomeLeaderMetric>('points');
  const [divisionId, setDivisionId] = React.useState<string | null>(null);
  const [storyIndex, setStoryIndex] = React.useState(0);
  const storyPager = React.useRef<ScrollView>(null);
  const selectedStoryId = React.useRef<string | null>(null);
  const storyScope = React.useRef<string | null>(null);

  const load = React.useCallback(async (preserve: boolean) => {
    if (!activeLeague) return;
    const generation = ++requestGeneration.current;
    if (!preserve) {
      setPublicHome(null);
      setDivisionId(null);
      setStoryIndex(0);
    }

    const publicResult = await loadHomePublicSnapshot(activeLeague.id, activeLeague.slug)
      .then((data) => ({ data, error: false as const }))
      .catch(() => ({ data: null, error: true as const }));
    if (generation !== requestGeneration.current) return;
    if (publicResult.error) {
      setPublicHome((current) => preserve && current?.leagueId === activeLeague.id && current.leagueSlug === activeLeague.slug
        ? markSnapshotFailed(current)
        : failedPublicSnapshot(activeLeague.id, activeLeague.slug));
    } else {
      setPublicHome((current) => preserve ? mergeRefresh(current, publicResult.data) : publicResult.data);
    }
  }, [activeLeague]);

  React.useEffect(() => {
    if (!activeLeague) {
      requestGeneration.current += 1;
      setPublicHome(null);
      return;
    }
    void load(false);
    return () => { requestGeneration.current += 1; };
  }, [activeLeague, load]);

  const retry = React.useCallback(() => { void load(true); }, [load]);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await load(true); } finally { setRefreshing(false); }
  }, [load]);
  const stories = (publicHome?.articles.data ?? []).slice(0, 4);
  const storyIds = stories.map((story) => story.id).join('|');
  const storyPageWidth = Math.max(1, width - homeTokens.contentPadding * 2);
  React.useEffect(() => {
    const scope = `${activeLeague?.id ?? ''}:${publicHome?.presentationSeason?.id ?? ''}`;
    const scopeChanged = storyScope.current !== scope;
    const retained = scopeChanged || !selectedStoryId.current
      ? -1
      : stories.findIndex((story) => story.id === selectedStoryId.current);
    const nextIndex = scopeChanged ? 0 : retained >= 0 ? retained : Math.min(storyIndex, Math.max(0, stories.length - 1));
    storyScope.current = scope;
    selectedStoryId.current = stories[nextIndex]?.id ?? null;
    setStoryIndex(nextIndex);
    storyPager.current?.scrollTo({ x: nextIndex * storyPageWidth, animated: false });
  // storyIndex is intentionally sampled only when the selected identity disappeared.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague?.id, publicHome?.presentationSeason?.id, storyIds, storyPageWidth]);

  if (!activeLeague) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: visuals.canvas }]} edges={['top', 'left', 'right']}>
        <View style={styles.accessState}>
          <Image source={hockeyLifeLogo} style={styles.accessStateLogo} resizeMode="contain" alt="Hockey Life" />
          <Text style={styles.accessStateTitle}>Hockey Life access required</Text>
          <Text style={styles.accessStateCopy}>This account does not have an accessible Hockey Life membership.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const accent = focusAccent;
  const article = stories[storyIndex] ?? stories[0] ?? null;
  const heroAlbum = !article ? publicHome?.albums.data.find((album) => album.cover_photo_url) ?? publicHome?.albums.data[0] ?? null : null;
  const standings = publicHome?.standings.data ?? [];
  const divisions = publicHome?.divisions ?? [];
  const selectedDivision = divisions.length > 1
    ? (divisions.some((division) => division.id === divisionId) ? divisionId : divisions[0]?.id ?? null)
    : null;
  const shownStandings = standings.filter((row) => !selectedDivision || row.division_id === selectedDivision).slice(0, 5);
  const openExternal = (url: string | null | undefined) => {
    const safe = toSafeWebUrl(url);
    if (safe) void Linking.openURL(safe).catch(() => {});
  };
  const origin = `https://${activeLeague.slug}.beerleaguehockey.ca`;
  const navigateToGame = (gameId: string) => navigation?.navigate?.('Schedule', { screen: 'GamePreview', initial: false, params: { gameId } });
  const selectStory = (nextIndex: number, scroll = true) => {
    if (!stories.length) return;
    const normalized = (nextIndex + stories.length) % stories.length;
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    selectedStoryId.current = stories[normalized]?.id ?? null;
    setStoryIndex(normalized);
    if (scroll) storyPager.current?.scrollTo({ x: normalized * storyPageWidth, animated: !reduceMotion });
  };
  const handleStorySwipe = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pageWidth = event.nativeEvent.layoutMeasurement.width || storyPageWidth;
    const nextIndex = Math.max(0, Math.min(stories.length - 1, Math.round(event.nativeEvent.contentOffset.x / pageWidth)));
    if (nextIndex !== storyIndex) selectStory(nextIndex, false);
  };

  const sectionCard = [styles.card, { backgroundColor: visuals.surface, borderColor: visuals.stroke }];
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: visuals.canvas }]} edges={['top', 'left', 'right']}>
      <HomeArenaBackdrop accentColor={accent} showAtmosphericGlow={visuals.showAtmosphericGlow} />
      <GuestBanner />
      <FocusScrollView accentColor={accent} focusScopeKey={`home:${activeLeague.id}`} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />} showsVerticalScrollIndicator={false}>
        <HomeLeagueHero
          leagueId={activeLeague.id}
          leagueName={activeLeague.name}
          logoUrl={activeLeague.logoUrl}
          primaryColor={activeTheme.primaryColor}
          secondaryColor={activeTheme.secondaryColor}
          reduceMotion={reduceMotion}
          reduceTransparency={reduceTransparency}
          width={width}
          height={height}
          updatesAction={
            <RevealView delay={20} duration={visuals.revealDuration}>
              <Pressable accessibilityRole="button" accessibilityLabel="Updates" style={[styles.iconButton, { backgroundColor: visuals.surface, borderColor: visuals.stroke }]} onPress={() => navigation?.navigate?.('Profile', { screen: 'NotificationsFeed' })}><Ionicons name="notifications-outline" size={20} color={homeTokens.text} /></Pressable>
            </RevealView>
          }
        />

        <View testID="home-news-section">
          <SectionHeading eyebrow="LATEST" title="News" />
          {!publicHome ? <SectionState loading onRetry={retry} /> : publicHome.articles.status === 'error' && !article ? <SectionState message={publicHome.articles.message} onRetry={retry} /> : stories.length > 0 ? (
            <ScrollView
              ref={storyPager}
              testID="home-news-pager"
              horizontal
              pagingEnabled
              directionalLockEnabled
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              onMomentumScrollEnd={handleStorySwipe}
              style={styles.newsPager}
            >
              {stories.map((story, index) => {
                const mounted = Math.abs(index - storyIndex) <= 1;
                return <View key={story.id} style={{ width: storyPageWidth }}>
                  {mounted ? <FocusCard focusId={`home:story:${story.id}`} accentColor={accent}>
                    <Pressable accessibilityRole="link" accessibilityLabel={`Read ${story.title}`} style={[sectionCard, styles.hero]} onPress={() => navigation?.navigate?.('LeaguePages', { screen: 'NewsArticle', params: { leagueId: activeLeague.id, leagueSlug: activeLeague.slug, articleSlug: story.slug || story.id } })}>
                      {story.image_url ? <Image source={{ uri: story.image_url }} style={styles.heroImage} alt={story.title} /> : <View style={styles.heroMark}><Image source={hockeyLifeLogo} style={styles.heroLogo} alt="" /></View>}
                      <LinearGradient colors={['transparent', 'rgba(3,8,16,0.96)']} style={styles.heroShade} />
                      <View style={styles.heroCopy}><Text style={[styles.heroEyebrow, { color: accent }]}>{articleLabel(story.type)}</Text><Text style={styles.heroTitle}>{story.title}</Text>{articleExcerpt(story) ? <Text style={styles.heroExcerpt}>{articleExcerpt(story)}</Text> : null}</View>
                    </Pressable>
                  </FocusCard> : <View accessible={false} style={styles.hero} />}
                </View>;
              })}
            </ScrollView>
          ) : (
            <FocusCard focusId={`home:story:${heroAlbum?.id ?? activeLeague.id}`} accentColor={accent}>
              <Pressable testID="home-story-detail" accessibilityRole="link" accessibilityLabel={heroAlbum ? `Open ${heroAlbum.title} gallery` : `Open ${activeLeague.name} schedule`} style={[sectionCard, styles.hero]} onPress={() => openExternal(heroAlbum ? `${origin}/gallery/${heroAlbum.id}` : `${origin}/schedule`)}>
                {heroAlbum?.cover_photo_url ? <Image source={{ uri: heroAlbum.cover_photo_url }} style={styles.heroImage} alt={heroAlbum.title} /> : <View style={styles.heroMark}><Image source={hockeyLifeLogo} style={styles.heroLogo} alt="" /></View>}
                <LinearGradient colors={['transparent', 'rgba(3,8,16,0.96)']} style={styles.heroShade} />
                <View style={styles.heroCopy}><Text style={[styles.heroEyebrow, { color: accent }]}>{heroAlbum ? 'FROM THE GALLERY' : 'LEAGUE CENTRAL'}</Text><Text style={styles.heroTitle}>{heroAlbum?.title ?? activeLeague.name}</Text><Text style={styles.heroExcerpt}>{heroAlbum ? 'Open the latest league album.' : 'Scores, stories, and the full league schedule.'}</Text></View>
              </Pressable>
            </FocusCard>
          )}
          {stories.length > 1 ? <View testID="home-story-navigation" style={styles.storyNavigation}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous story" style={styles.storyNavigationButton} onPress={() => selectStory(storyIndex - 1)}><Ionicons name="chevron-back" size={18} color={homeTokens.text} /></Pressable>
            <View testID="home-story-indicator" accessible accessibilityRole="adjustable" accessibilityLabel="Latest News position" accessibilityValue={{ min: 1, max: stories.length, now: storyIndex + 1, text: `${storyIndex + 1} of ${stories.length}` }} style={styles.storyDots}><Text testID="home-story-count" style={[styles.storyCount, { color: accent }]}>{storyIndex + 1} / {stories.length}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Next story" style={styles.storyNavigationButton} onPress={() => selectStory(storyIndex + 1)}><Ionicons name="chevron-forward" size={18} color={homeTokens.text} /></Pressable>
          </View> : null}
          {publicHome?.articles.status === 'error' && article ? <Text style={styles.staleNote}>{publicHome.articles.message} Showing the last loaded story.</Text> : null}
        </View>

        <View testID="home-weekly-games-section">
          <SectionHeading eyebrow="AROUND THE LEAGUE" title="This Week’s Games" action={<Pressable accessibilityRole="button" accessibilityLabel="Open full schedule" onPress={() => navigation?.navigate?.('Schedule')}><Text style={[styles.textLink, { color: accent }]}>Full schedule</Text></Pressable>} />
          {!publicHome ? <SectionState loading onRetry={retry} /> : publicHome.weeklyGames.status === 'error' && publicHome.weeklyGames.data.length === 0 ? <SectionState message={publicHome.weeklyGames.message} onRetry={retry} /> : publicHome.weeklyGames.data.length === 0 ? <View style={[sectionCard, styles.emptyCard]}><Text style={styles.emptyTitle}>No games scheduled this week</Text><Text style={styles.emptyCopy}>Check the full schedule for the next slate and recent scores.</Text></View> : publicHome.weeklyGames.data.map((game: HomeWeeklyGame) => {
            const status = normalizeHomeGameStatus(game.status); const showScore = status === 'Final' || status === 'Live';
            return <FocusCard key={game.id} focusId={`home:weekly-game:${game.id}`} accentColor={accent}><Pressable accessibilityRole="button" accessibilityLabel={weeklyGameAccessibilityLabel(game)} style={[sectionCard, styles.gameRow]} onPress={() => navigateToGame(game.id)}><View style={styles.gameWhen}><Text style={styles.gameDate}>{formatDate(game.scheduled_at)}</Text><Text style={styles.gameTime}>{formatTime(game.scheduled_at)}</Text></View><View style={styles.gameBody}><View style={styles.gameStatusRow}><Text style={[styles.status, status === 'Live' && styles.statusLive]}>{status}</Text><Text style={styles.gameLocation}>{game.location ?? ''}</Text></View><View style={styles.scoreRow}><Text style={styles.gameTeams}>{game.away_team?.name ?? game.away_team_id}{'\n'}{game.home_team?.name ?? game.home_team_id}</Text>{showScore ? <Text style={styles.scores}>{game.away_score ?? '—'}{'\n'}{game.home_score ?? '—'}</Text> : null}</View></View></Pressable></FocusCard>;
          })}
          {publicHome?.weeklyGames.status === 'error' && publicHome.weeklyGames.data.length > 0 ? <Text style={styles.staleNote}>{publicHome.weeklyGames.message}</Text> : null}
        </View>

        <View testID="home-leaders-section">
          <HomeLeagueLeaders
            leagueId={activeLeague.id}
            seasonName={publicHome?.presentationSeason?.name ?? null}
            metric={leaderMetric}
            leaders={publicHome?.leaders.data ?? []}
            status={!publicHome ? 'loading' : publicHome.leaders.status === 'error' ? 'error' : 'ready'}
            errorMessage={publicHome?.leaders.message}
            width={width}
            fontScale={fontScale}
            reduceTransparency={reduceTransparency}
            manifestRefreshKey={publicHome}
            onMetricChange={setLeaderMetric}
            onRetry={retry}
            onOpenPlayer={(playerId) => navigateToPlayerCard(navigation, { playerId, leagueId: activeLeague.id })}
            onOpenAllStats={() => navigation?.navigate?.('Stats', { screen: 'Leaderboards' })}
          />
        </View>

        <View testID="home-standings-section">
          <SectionHeading eyebrow="TABLE" title="Standings" action={<Pressable accessibilityRole="button" accessibilityLabel="Open standings" onPress={() => navigation?.navigate?.('Standings')}><Text style={[styles.textLink, { color: accent }]}>All standings</Text></Pressable>} />
          {divisions.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.divisionTabs}>{divisions.map((division) => <Pressable key={division.id} accessibilityRole="button" accessibilityState={{ selected: division.id === selectedDivision }} style={[styles.divisionTab, division.id === selectedDivision && styles.metricTabActive]} onPress={() => setDivisionId(division.id)}><Text style={styles.metricTabText}>{division.name}</Text></Pressable>)}</ScrollView> : null}
          {!publicHome ? <SectionState loading onRetry={retry} /> : publicHome.standings.status === 'error' && shownStandings.length === 0 ? <SectionState message={publicHome.standings.message} onRetry={retry} /> : shownStandings.length === 0 ? <View style={[sectionCard, styles.emptyCard]}><Text style={styles.emptyTitle}>No standings available yet</Text></View> : <FocusCard focusId={`home:standings:${selectedDivision ?? 'all'}`} accentColor={accent} style={[sectionCard, styles.table]}><View style={styles.tableHeader}><Text style={[styles.tableTeam, styles.tableHeaderText]}>TEAM</Text><Text style={styles.tableStat}>GP</Text><Text style={styles.tableStat}>W</Text><Text style={styles.tableStat}>L</Text><Text style={styles.tableStat}>PTS</Text></View>{shownStandings.map((row: HomeStanding) => <Pressable key={row.team_id} accessibilityRole="button" style={styles.tableRow} onPress={() => navigation?.navigate?.('Team', { screen: 'TeamDetail', params: { teamId: row.team_id, leagueId: activeLeague.id } })}><View style={styles.tableTeam}><TeamLogo teamId={row.team_id} logoUrl={row.logo_url} teamName={row.team_name} primaryColor={row.primary_color} size={28} /><Text style={styles.tableTeamName}>{row.team_name}</Text></View><Text style={styles.tableStat}>{row.games_played}</Text><Text style={styles.tableStat}>{row.wins}</Text><Text style={styles.tableStat}>{row.losses}</Text><Text style={[styles.tableStat, { color: accent, fontWeight: '900' }]}>{row.points}</Text></Pressable>)}</FocusCard>}
          {publicHome?.standings.status === 'error' && shownStandings.length > 0 ? <Text style={styles.staleNote}>{publicHome.standings.message}</Text> : null}
        </View>

        {!publicHome ? <View testID="home-photos-loading"><SectionHeading eyebrow="FROM THE RINK" title="League Photos" /><SectionState loading onRetry={retry} /></View> : publicHome.photos.data.length > 0 || publicHome.albums.data.length > 0 ? <View testID="home-photos-section"><SectionHeading eyebrow="FROM THE RINK" title="League Photos" action={<Pressable accessibilityRole="link" onPress={() => openExternal(`${origin}/gallery`)}><Text style={[styles.textLink, { color: accent }]}>Gallery</Text></Pressable>} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRail}>{publicHome.photos.data.length > 0 ? publicHome.photos.data.map((photo) => <Pressable key={photo.id} accessibilityRole="link" onPress={() => openExternal(`${origin}/gallery/${photo.gallery_id}`)}><Image source={{ uri: photo.url }} style={styles.photo} alt={photo.caption ?? ''} /></Pressable>) : publicHome.albums.data.map((album) => <Pressable key={album.id} accessibilityRole="link" style={[sectionCard, styles.album]} onPress={() => openExternal(`${origin}/gallery/${album.id}`)}>{album.cover_photo_url ? <Image source={{ uri: album.cover_photo_url }} style={styles.albumImage} alt={album.title} /> : null}<Text style={styles.albumTitle}>{album.title}</Text></Pressable>)}</ScrollView>{publicHome.photos.status === 'error' ? <Text style={styles.staleNote}>{publicHome.photos.message}</Text> : null}{publicHome.albums.status === 'error' ? <Text style={styles.staleNote}>{publicHome.albums.message}</Text> : null}</View> : publicHome.photos.status === 'error' || publicHome.albums.status === 'error' ? <View testID="home-photos-error"><SectionHeading eyebrow="FROM THE RINK" title="League Photos" /><SectionState message="League photos are temporarily unavailable." onRetry={retry} /></View> : null}

        {!publicHome ? <View testID="home-community-loading"><SectionHeading eyebrow="CONNECT" title="Community" /><SectionState loading onRetry={retry} /></View> : publicHome.community.status === 'error' && publicHome.community.data.length === 0 ? <View testID="home-community-error"><SectionHeading eyebrow="CONNECT" title="Community" /><SectionState message={publicHome.community.message} onRetry={retry} /></View> : publicHome.community.data.length > 0 ? <View testID="home-community-section"><SectionHeading eyebrow="CONNECT" title="Community" /><View style={styles.communityGrid}>{publicHome.community.data.map((social) => <Pressable key={social.key} accessibilityRole="link" style={[sectionCard, styles.communityLink]} onPress={() => openExternal(social.url)}><Text style={styles.communityText}>{social.label}</Text><Ionicons name="open-outline" size={15} color={accent} /></Pressable>)}</View>{publicHome.community.status === 'error' ? <Text style={styles.staleNote}>{publicHome.community.message}</Text> : null}</View> : null}

      </FocusScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  accessState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  accessStateLogo: { width: 92, height: 92 },
  accessStateTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  accessStateCopy: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
  arenaBackdrop: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  arenaGlow: { position: 'absolute', top: -80, left: -60, right: -80, height: 360, borderRadius: 180 },
  arenaRink: { position: 'absolute', width: 250, height: 470, right: -120, top: 120, borderWidth: 1, borderColor: homeTokens.rinkLine, borderRadius: 125, transform: [{ rotate: '-10deg' }] },
  arenaCenterLine: { position: 'absolute', top: '50%', right: 0, left: 0, height: 1, backgroundColor: homeTokens.rinkLine },
  arenaCenterCircle: { position: 'absolute', top: 191, left: 81, width: 86, height: 86, borderWidth: 1, borderColor: homeTokens.rinkLine, borderRadius: 43 },
  content: { paddingHorizontal: homeTokens.contentPadding, paddingTop: 6, paddingBottom: 34, gap: 20 },
  iconButton: { width: 44, height: 44, minHeight: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sectionHeading: { minHeight: 44, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 9 },
  sectionHeadingCopy: { flex: 1 },
  sectionEyebrow: { color: homeTokens.textSecondary, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  sectionTitle: { color: homeTokens.text, fontSize: 21, lineHeight: 25, fontWeight: '900', marginTop: 2 },
  card: { borderWidth: 1, borderRadius: homeTokens.cardRadius, overflow: 'hidden' },
  sectionState: { minHeight: 104, borderWidth: 1, borderColor: homeTokens.strokeOpaque, borderRadius: homeTokens.cardRadius, backgroundColor: homeTokens.surfaceOpaque, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 8 },
  sectionStateText: { color: homeTokens.textSecondary, textAlign: 'center', fontSize: 12, lineHeight: 17 },
  retryButton: { minWidth: 72, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.glassStrokeStrong, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: colors.textPrimary, fontWeight: '800', fontSize: 12 },
  staleNote: { color: homeTokens.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 6 },
  hero: { minHeight: 250, justifyContent: 'flex-end', backgroundColor: '#091426' },
  heroImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%', resizeMode: 'cover' },
  heroMark: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heroLogo: { width: 96, height: 96, resizeMode: 'contain', opacity: 0.72 },
  heroShade: { ...StyleSheet.absoluteFillObject },
  heroCopy: { padding: 18, paddingTop: 74 },
  heroEyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  heroTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 28, fontWeight: '900', marginTop: 4 },
  heroExcerpt: { color: '#CCD6E5', fontSize: 13, lineHeight: 19, marginTop: 7 },
  newsPager: { width: '100%' },
  storyNavigation: { width: '100%', minHeight: 44, marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  storyNavigationButton: { width: 44, height: 44, flexShrink: 0, borderRadius: 14, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, alignItems: 'center', justifyContent: 'center' },
  storyDots: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  storyCount: { fontSize: 12, lineHeight: 18, fontWeight: '900', letterSpacing: 1 },
  emptyCard: { minHeight: 104, alignItems: 'center', justifyContent: 'center', padding: 18 },
  emptyTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  emptyCopy: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 5 },
  textLink: { minHeight: 44, paddingTop: 16, fontSize: 11, fontWeight: '900' },
  gameRow: { minHeight: 104, flexDirection: 'row', marginBottom: 8 },
  gameWhen: { width: 66, padding: 9, alignItems: 'center', justifyContent: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.glassStroke },
  gameDate: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  gameTime: { color: colors.textSecondary, fontSize: 10, marginTop: 4 },
  gameBody: { flex: 1, padding: 11 },
  gameStatusRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  status: { color: colors.textSecondary, fontSize: 10, fontWeight: '900' },
  statusLive: { color: '#FB7185' },
  gameLocation: { flex: 1, color: colors.textSecondary, fontSize: 10, textAlign: 'right' },
  scoreRow: { flexDirection: 'row', marginTop: 8 },
  gameTeams: { flex: 1, color: colors.textPrimary, fontSize: 13, lineHeight: 20, fontWeight: '800' },
  scores: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '900', textAlign: 'right' },
  metricTabActive: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: colors.glassStrokeStrong },
  metricTabText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  divisionTabs: { gap: 7, paddingBottom: 8 },
  divisionTab: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.glassStroke, alignItems: 'center', justifyContent: 'center' },
  table: { padding: 8 },
  tableHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  tableHeaderText: { color: colors.textSecondary, fontSize: 9, fontWeight: '900' },
  tableRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassStroke, paddingHorizontal: 6 },
  tableTeam: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  tableTeamName: { flex: 1, color: colors.textPrimary, fontSize: 11, fontWeight: '800' },
  tableStat: { width: 30, color: colors.textSecondary, fontSize: 11, textAlign: 'center' },
  photoRail: { gap: 10 },
  photo: { width: 150, height: 110, borderRadius: 16, backgroundColor: colors.bgSurface },
  album: { width: 158, minHeight: 130 },
  albumImage: { width: '100%', height: 94, resizeMode: 'cover' },
  albumTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '800', padding: 9 },
  communityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  communityLink: { minWidth: '47%', flex: 1, minHeight: 50, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  communityText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
});
