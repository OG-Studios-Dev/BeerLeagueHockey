import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import blhLogo from '../../assets/blh-logo.png';
import GuestBanner from '../components/GuestBanner';
import LeagueMarketplace from '../components/LeagueMarketplace';
import RevealView from '../components/RevealView';
import TeamLogo from '../components/TeamLogo';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../context/LeagueContext';
import { navigateToPlayerCard } from '../navigation/playerCard';
import {
  type CheckinStatus,
  getGameCheckinSummary,
  getMyCheckins,
  updateCheckin,
} from '../lib/supabase/checkins';
import { supabase } from '../lib/supabase/client';
import {
  type HomeArticle,
  type HomeLeader,
  type HomePublicSnapshot,
  type HomeSection,
  type HomeSponsor,
  type HomeStanding,
  type HomeWeeklyGame,
  loadHomePublicSnapshot,
  normalizeHomeGameStatus,
  toSafeWebUrl,
} from '../lib/supabase/home';
import { getActiveSeasonTeamForUser, getTeamActiveSeason } from '../lib/supabase/team';
import colors from '../theme/colors';
import { getHomeVisualPreferences, HOME_VISUAL_TOKENS as homeTokens } from '../theme/home';

type HomeNavigation = {
  navigate?: (...args: unknown[]) => void;
  getState?: () => { routeNames?: string[] };
};
type HomeScreenProps = { navigation?: HomeNavigation };

type UserTeam = {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
};

type NextGame = {
  id: string;
  league_id?: string;
  scheduled_at: string;
  location: string | null;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_team: { id: string; name: string; logo_url: string | null; primary_color: string | null } | null;
  away_team: { id: string; name: string; logo_url: string | null; primary_color: string | null } | null;
};
type CheckinSummary = { confirmed: number; tentative: number; out: number };
type PersonalState = { status: 'loading' | 'ready' | 'error'; team: UserTeam | null; game: NextGame | null; message?: string };
type LeaderMetric = 'goals' | 'assists' | 'points';

const EMPTY_SUMMARY: CheckinSummary = { confirmed: 0, tentative: 0, out: 0 };

function formatGameDate(iso: string) {
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

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

function gameAccessibilityLabel(game: NextGame, summary: CheckinSummary, canCheckIn: boolean, isGuestLeague: boolean) {
  const away = game.away_team?.name ?? game.away_team_id;
  const home = game.home_team?.name ?? game.home_team_id;
  return [
    `My next game, ${away} at ${home}`,
    formatGameDate(game.scheduled_at),
    game.location,
    canCheckIn ? `${summary.confirmed} In · ${summary.tentative} Maybe · ${summary.out} Out` : isGuestLeague ? 'Join this league to check in' : null,
  ].filter(Boolean).join('. ');
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

function normalizeNextGame(value: unknown, leagueId: string, seasonId: string): NextGame | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid next game');
  const row = value as Record<string, unknown>;
  const required = (field: string) => {
    const fieldValue = row[field];
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) throw new TypeError(`Invalid ${field}`);
    return fieldValue;
  };
  if (required('league_id') !== leagueId || required('season_id') !== seasonId) throw new TypeError('Next game scope mismatch');
  const scheduledAt = required('scheduled_at');
  if (!Number.isFinite(new Date(scheduledAt).getTime())) throw new TypeError('Invalid next game date');
  const team = (joined: unknown) => {
    const candidate = Array.isArray(joined) ? joined[0] : joined;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('Invalid next game team');
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name) throw new TypeError('Invalid next game team');
    if (item.logo_url !== null && typeof item.logo_url !== 'string') throw new TypeError('Invalid next game logo');
    if (item.primary_color !== null && typeof item.primary_color !== 'string') throw new TypeError('Invalid next game colour');
    return { id: item.id, name: item.name, logo_url: item.logo_url as string | null, primary_color: item.primary_color as string | null };
  };
  if (row.location !== null && typeof row.location !== 'string') throw new TypeError('Invalid next game location');
  return {
    id: required('id'), league_id: leagueId, scheduled_at: scheduledAt,
    location: row.location as string | null, status: required('status'),
    home_team_id: required('home_team_id'), away_team_id: required('away_team_id'),
    home_team: team(row.home_team), away_team: team(row.away_team),
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

function MetricTabs({ value, onChange }: { value: LeaderMetric; onChange: (value: LeaderMetric) => void }) {
  return (
    <View style={styles.metricTabs}>
      {(['goals', 'assists', 'points'] as const).map((metric) => (
        <Pressable key={metric} accessibilityRole="button" accessibilityState={{ selected: metric === value }} onPress={() => onChange(metric)} style={[styles.metricTab, metric === value && styles.metricTabActive]}>
          <Text style={[styles.metricTabText, metric === value && styles.metricTabTextActive]}>{metric[0].toUpperCase() + metric.slice(1)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const { activeLeague, activeTheme, isGuestLeague } = useLeague();
  const { user, isGuest } = useAuth();
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();
  const { width } = useWindowDimensions();
  const compact = width < homeTokens.compactBreakpoint;
  const visuals = getHomeVisualPreferences(reduceTransparency, reduceMotion);
  const requestGeneration = React.useRef(0);
  const identityKey = `${user?.id ?? 'guest'}:${activeLeague?.id ?? 'none'}`;
  const currentIdentity = React.useRef(identityKey);
  currentIdentity.current = identityKey;
  const checkinOperation = React.useRef<{ id: number; identity: string; gameId: string; teamId: string } | null>(null);
  const nextCheckinOperationId = React.useRef(0);
  const [publicHome, setPublicHome] = React.useState<HomePublicSnapshot | null>(null);
  const [personal, setPersonal] = React.useState<PersonalState>({ status: 'loading', team: null, game: null });
  const [refreshing, setRefreshing] = React.useState(false);
  const [leaderMetric, setLeaderMetric] = React.useState<LeaderMetric>('goals');
  const [divisionId, setDivisionId] = React.useState<string | null>(null);
  const [storyIndex, setStoryIndex] = React.useState(0);
  const [myCheckinStatus, setMyCheckinStatus] = React.useState<CheckinStatus | null>(null);
  const [checkinSummary, setCheckinSummary] = React.useState<CheckinSummary>(EMPTY_SUMMARY);
  const [checkinLoading, setCheckinLoading] = React.useState(false);

  const load = React.useCallback(async (preserve: boolean) => {
    if (!activeLeague) return;
    const generation = ++requestGeneration.current;
    if (!preserve) {
      checkinOperation.current = null;
      setPublicHome(null);
      setPersonal({ status: 'loading', team: null, game: null });
      setDivisionId(null);
      setStoryIndex(0);
      setMyCheckinStatus(null);
      setCheckinSummary(EMPTY_SUMMARY);
      setCheckinLoading(false);
    }

    const publicPromise = loadHomePublicSnapshot(activeLeague.id, activeLeague.slug);
    const personalPromise = (async (): Promise<PersonalState> => {
      if (!user?.id || isGuest) return { status: 'ready', team: null, game: null };
      const activeSeason = await getTeamActiveSeason(activeLeague.id);
      if (activeSeason.error) throw new Error(activeSeason.error);
      if (!activeSeason.season) return { status: 'ready', team: null, game: null };
      const assignment = await getActiveSeasonTeamForUser(user.id, activeLeague.id, activeSeason.season.id);
      if (!assignment) return { status: 'ready', team: null, game: null };
      if (!assignment.team_id?.trim() || !assignment.team_name?.trim()) throw new TypeError('Invalid team assignment');
      const team: UserTeam = { id: assignment.team_id, name: assignment.team_name, logo_url: assignment.logo_url, primary_color: assignment.primary_color };
      const result = await supabase.from('games').select(`id,league_id,season_id,scheduled_at,location,status,home_team_id,away_team_id,
        home_team:teams!games_home_team_id_fkey(id,name,logo_url,primary_color),
        away_team:teams!games_away_team_id_fkey(id,name,logo_url,primary_color)`)
        .eq('league_id', activeLeague.id).eq('season_id', activeSeason.season.id).eq('status', 'scheduled')
        .gte('scheduled_at', new Date().toISOString())
        .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
        .order('scheduled_at', { ascending: true }).limit(1).maybeSingle();
      if (result.error) throw result.error;
      const game = normalizeNextGame(result.data, activeLeague.id, activeSeason.season.id);
      if (generation === requestGeneration.current && checkinOperation.current
        && (checkinOperation.current.gameId !== game?.id || checkinOperation.current.teamId !== team.id)) {
        checkinOperation.current = null;
        setCheckinLoading(false);
      }
      if (game && !isGuestLeague) {
        const [checkins, summary] = await Promise.all([getMyCheckins(team.id), getGameCheckinSummary(game.id, team.id)]);
        if (generation === requestGeneration.current) {
          setMyCheckinStatus(checkins[game.id] ?? null);
          setCheckinSummary({ confirmed: summary.confirmed.length, tentative: summary.tentative.length, out: summary.out.length });
        }
      }
      return { status: 'ready', team, game };
    })().catch(() => ({ status: 'error' as const, team: null, game: null, message: 'Your current-team game is temporarily unavailable.' }));

    const [publicResult, nextPersonal] = await Promise.all([
      publicPromise.then((data) => ({ data, error: false as const })).catch(() => ({ data: null, error: true as const })),
      personalPromise,
    ]);
    if (generation !== requestGeneration.current) return;
    if (publicResult.error) {
      setPublicHome((current) => preserve && current?.leagueId === activeLeague.id && current.leagueSlug === activeLeague.slug
        ? markSnapshotFailed(current)
        : failedPublicSnapshot(activeLeague.id, activeLeague.slug));
    } else {
      setPublicHome((current) => preserve ? mergeRefresh(current, publicResult.data) : publicResult.data);
    }
    if (checkinOperation.current && (checkinOperation.current.gameId !== nextPersonal.game?.id
      || checkinOperation.current.teamId !== nextPersonal.team?.id)) {
      checkinOperation.current = null;
      setCheckinLoading(false);
    }
    setPersonal(nextPersonal);
  }, [activeLeague, isGuest, isGuestLeague, user?.id]);

  React.useEffect(() => {
    if (!activeLeague) {
      requestGeneration.current += 1;
      checkinOperation.current = null;
      setPublicHome(null);
      setCheckinLoading(false);
      return;
    }
    void load(false);
    return () => { requestGeneration.current += 1; checkinOperation.current = null; };
  }, [activeLeague, load]);

  const retry = React.useCallback(() => { void load(true); }, [load]);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await load(true); } finally { setRefreshing(false); }
  }, [load]);
  const storyIds = (publicHome?.articles.data ?? []).map((story) => story.id).join('|');
  React.useEffect(() => { setStoryIndex(0); }, [activeLeague?.id, publicHome?.presentationSeason?.id, storyIds]);

  if (!activeLeague) {
    return <LeagueMarketplace navigation={navigation} title="BLH Overview" subtitle="Nearby leagues, fit, and difficulty across Beer League Hockey." showJoinedLeagues includeTopInset={false} />;
  }

  const canCheckIn = Boolean(user && !isGuest && !isGuestLeague && personal.team && personal.game);
  const accent = personal.team?.primary_color ?? activeTheme.primaryColor ?? colors.primary;
  const stories = publicHome?.articles.data ?? [];
  const article = stories[storyIndex] ?? stories[0] ?? null;
  const heroAlbum = !article ? publicHome?.albums.data.find((album) => album.cover_photo_url) ?? publicHome?.albums.data[0] ?? null : null;
  const standings = publicHome?.standings.data ?? [];
  const divisions = publicHome?.divisions ?? [];
  const selectedDivision = divisions.length > 1
    ? (divisions.some((division) => division.id === divisionId) ? divisionId : divisions[0]?.id ?? null)
    : null;
  const shownStandings = standings.filter((row) => !selectedDivision || row.division_id === selectedDivision).slice(0, 5);
  const leaders = (publicHome?.leaders.data ?? []).filter((row) => row[leaderMetric] > 0)
    .sort((left, right) => right[leaderMetric] - left[leaderMetric] || left.player_name.localeCompare(right.player_name)).slice(0, 5);

  const openExternal = (url: string | null | undefined) => {
    const safe = toSafeWebUrl(url);
    if (safe) void Linking.openURL(safe).catch(() => {});
  };
  const origin = `https://${activeLeague.slug}.beerleaguehockey.ca`;
  const navigateToGame = (gameId: string) => navigation?.navigate?.('Schedule', { screen: 'GamePreview', initial: false, params: { gameId } });

  const handleCheckin = async (status: CheckinStatus) => {
    if (!personal.game || !personal.team || !canCheckIn || checkinOperation.current) return;
    const operation = {
      id: ++nextCheckinOperationId.current,
      identity: identityKey,
      gameId: personal.game.id,
      teamId: personal.team.id,
    };
    checkinOperation.current = operation;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const previous = myCheckinStatus;
    const previousSummary = checkinSummary;
    const nextSummary = { ...checkinSummary };
    if (previous) nextSummary[previous === 'confirmed' ? 'confirmed' : previous === 'tentative' ? 'tentative' : 'out'] = Math.max(0, nextSummary[previous === 'confirmed' ? 'confirmed' : previous === 'tentative' ? 'tentative' : 'out'] - 1);
    nextSummary[status === 'confirmed' ? 'confirmed' : status === 'tentative' ? 'tentative' : 'out'] += 1;
    setMyCheckinStatus(status);
    setCheckinSummary(nextSummary);
    setCheckinLoading(true);
    let success = false;
    try {
      const result = await updateCheckin(operation.gameId, operation.teamId, status);
      success = result.success;
    } catch {
      success = false;
    }
    const stillCurrent = checkinOperation.current?.id === operation.id
      && checkinOperation.current.identity === operation.identity
      && currentIdentity.current === operation.identity;
    if (!stillCurrent) return;
    checkinOperation.current = null;
    setCheckinLoading(false);
    if (!success) { setMyCheckinStatus(previous); setCheckinSummary(previousSummary); }
  };

  const sectionCard = [styles.card, { backgroundColor: visuals.surface, borderColor: visuals.stroke }];
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: visuals.canvas }]} edges={['left', 'right']}>
      <HomeArenaBackdrop accentColor={accent} showAtmosphericGlow={visuals.showAtmosphericGlow} />
      <GuestBanner />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />} showsVerticalScrollIndicator={false}>
        <RevealView delay={20} duration={visuals.revealDuration}>
          <View testID="home-editorial-header" style={styles.headerRow}>
            <View style={styles.brandWrap}><View style={[styles.logoFrame, { borderColor: visuals.stroke }]}><Image source={blhLogo} style={styles.smallLogo} alt="" /></View><View style={styles.brandCopy}><Text style={[styles.homeEyebrow, { color: accent }]}>LEAGUE HOME</Text><Text style={[styles.logo, compact && styles.logoCompact]}>{activeLeague.name}</Text></View></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Updates" style={[styles.iconButton, { backgroundColor: visuals.surface, borderColor: visuals.stroke }]} onPress={() => navigation?.navigate?.('Profile', { screen: 'NotificationsFeed' })}><Ionicons name="notifications-outline" size={20} color={homeTokens.text} /></Pressable>
          </View>
        </RevealView>

        <View testID="home-news-section">
          <SectionHeading eyebrow="LATEST" title="News" />
          {!publicHome ? <SectionState loading onRetry={retry} /> : publicHome.articles.status === 'error' && !article ? <SectionState message={publicHome.articles.message} onRetry={retry} /> : (
            <Pressable testID="home-story-detail" accessibilityRole="link" accessibilityLabel={article ? `Read ${article.title}` : heroAlbum ? `Open ${heroAlbum.title} gallery` : `Open ${activeLeague.name} schedule`} style={[sectionCard, styles.hero]} onPress={() => openExternal(article ? `${origin}/news/${article.slug || article.id}` : heroAlbum ? `${origin}/gallery/${heroAlbum.id}` : `${origin}/schedule`)}>
              {(article?.image_url || heroAlbum?.cover_photo_url) ? <Image source={{ uri: (article?.image_url || heroAlbum?.cover_photo_url)! }} style={styles.heroImage} alt={article?.title ?? heroAlbum?.title ?? ''} /> : <View style={styles.heroMark}><Image source={blhLogo} style={styles.heroLogo} alt="" /></View>}
              <LinearGradient colors={['transparent', 'rgba(3,8,16,0.96)']} style={styles.heroShade} />
              <View style={styles.heroCopy}><Text style={[styles.heroEyebrow, { color: accent }]}>{article ? articleLabel(article.type) : heroAlbum ? 'FROM THE GALLERY' : 'LEAGUE CENTRAL'}</Text><Text style={styles.heroTitle}>{article?.title ?? heroAlbum?.title ?? activeLeague.name}</Text>{article && articleExcerpt(article) ? <Text style={styles.heroExcerpt}>{articleExcerpt(article)}</Text> : <Text style={styles.heroExcerpt}>{heroAlbum ? 'Open the latest league album.' : 'Scores, stories, and the full league schedule.'}</Text>}</View>
            </Pressable>
          )}
          {stories.length > 1 ? <View testID="home-story-navigation" style={styles.storyNavigation}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous story" style={styles.storyNavigationButton} onPress={() => setStoryIndex((current) => (current - 1 + stories.length) % stories.length)}><Ionicons name="chevron-back" size={18} color={homeTokens.text} /></Pressable>
            <Text style={styles.storyPosition}>{storyIndex + 1} of {stories.length}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Next story" style={styles.storyNavigationButton} onPress={() => setStoryIndex((current) => (current + 1) % stories.length)}><Ionicons name="chevron-forward" size={18} color={homeTokens.text} /></Pressable>
          </View> : null}
          {publicHome?.articles.status === 'error' && article ? <Text style={styles.staleNote}>{publicHome.articles.message} Showing the last loaded story.</Text> : null}
        </View>

        {personal.status === 'loading' ? <View testID="home-personal-loading"><SectionHeading eyebrow="FOR YOU" title="My next game" /><SectionState loading onRetry={retry} /></View> : null}
        {personal.status === 'error' ? <View testID="home-personal-error"><SectionHeading eyebrow="FOR YOU" title="My next game" /><SectionState message={personal.message} onRetry={retry} /></View> : null}
        {personal.status === 'ready' && personal.team ? (
          <View testID="home-personal-section">
            <SectionHeading eyebrow="FOR YOU" title="My next game" />
            {personal.game ? (
              <View testID="home-next-game-panel" style={[sectionCard, styles.nextGame]}>
                <LinearGradient testID="home-stage-glass-gradient" colors={[visuals.surfaceTop, visuals.surfaceBottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <Pressable testID="home-next-game-details" accessibilityRole="button" accessibilityLabel={gameAccessibilityLabel(personal.game, checkinSummary, canCheckIn, isGuestLeague)} accessibilityHint="Open next game details" style={styles.nextGameDetails} onPress={() => navigateToGame(personal.game!.id)}>
                  <Text style={[styles.nextDate, { color: accent }]}>{formatGameDate(personal.game.scheduled_at)}</Text>
                  <View testID="home-matchup-teams" style={[styles.matchup, compact && styles.matchupCompact]}>
                    {([personal.game.away_team, personal.game.home_team] as const).map((team, index) => <React.Fragment key={team?.id ?? index}><View style={[styles.matchupTeam, compact && styles.matchupTeamCompact]}><TeamLogo teamId={team?.id} logoUrl={team?.logo_url ?? null} teamName={team?.name ?? '?'} primaryColor={team?.primary_color} size={compact ? 42 : 50} /><Text style={styles.matchupName}>{team?.name ?? '?'}</Text></View>{index === 0 ? <Text style={styles.vs}>VS</Text> : null}</React.Fragment>)}
                  </View>
                  {personal.game.location ? <Text style={styles.location}>{personal.game.location}</Text> : null}
                </Pressable>
                {canCheckIn ? <><View style={styles.checkinRow}>{([['confirmed', 'In'], ['tentative', 'Maybe'], ['out', 'Out']] as const).map(([status, label]) => <Pressable key={status} accessibilityRole="button" accessibilityLabel={status === 'confirmed' ? 'Check in for next game' : status === 'tentative' ? 'Mark next game as maybe' : 'Decline next game'} accessibilityState={{ selected: myCheckinStatus === status, disabled: checkinLoading }} disabled={checkinLoading} style={[styles.checkinButton, myCheckinStatus === status && { backgroundColor: status === 'confirmed' ? colors.accentGreen : status === 'tentative' ? '#F59E0B' : colors.accentRed }]} onPress={() => handleCheckin(status)}><Text style={[styles.checkinText, myCheckinStatus === status && styles.checkinTextSelected]}>{label}</Text></Pressable>)}</View><View style={styles.checkinPendingRow}><Text style={styles.checkinSummary}>{checkinSummary.confirmed} In · {checkinSummary.tentative} Maybe · {checkinSummary.out} Out</Text>{checkinLoading ? <ActivityIndicator size="small" color={accent} /> : null}</View></> : isGuestLeague ? <Text style={styles.checkinSummary}>Join this league to check in</Text> : null}
              </View>
            ) : <View testID="home-empty-game-panel" style={[sectionCard, styles.emptyCard]}><Text style={styles.emptyTitle}>No upcoming games</Text><Text style={styles.emptyCopy}>Your current team does not have a future game scheduled.</Text></View>}
          </View>
        ) : null}

        <View testID="home-weekly-games-section">
          <SectionHeading eyebrow="AROUND THE LEAGUE" title="This Week’s Games" action={<Pressable accessibilityRole="button" accessibilityLabel="Open full schedule" onPress={() => navigation?.navigate?.('Schedule')}><Text style={[styles.textLink, { color: accent }]}>Full schedule</Text></Pressable>} />
          {!publicHome ? <SectionState loading onRetry={retry} /> : publicHome.weeklyGames.status === 'error' && publicHome.weeklyGames.data.length === 0 ? <SectionState message={publicHome.weeklyGames.message} onRetry={retry} /> : publicHome.weeklyGames.data.length === 0 ? <View style={[sectionCard, styles.emptyCard]}><Text style={styles.emptyTitle}>No games scheduled this week</Text><Text style={styles.emptyCopy}>Check the full schedule for the next slate and recent scores.</Text></View> : publicHome.weeklyGames.data.map((game: HomeWeeklyGame) => {
            const status = normalizeHomeGameStatus(game.status); const showScore = status === 'Final' || status === 'Live';
            return <Pressable key={game.id} accessibilityRole="button" accessibilityLabel={weeklyGameAccessibilityLabel(game)} style={[sectionCard, styles.gameRow]} onPress={() => navigateToGame(game.id)}><View style={styles.gameWhen}><Text style={styles.gameDate}>{formatDate(game.scheduled_at)}</Text><Text style={styles.gameTime}>{formatTime(game.scheduled_at)}</Text></View><View style={styles.gameBody}><View style={styles.gameStatusRow}><Text style={[styles.status, status === 'Live' && styles.statusLive]}>{status}</Text><Text style={styles.gameLocation}>{game.location ?? ''}</Text></View><View style={styles.scoreRow}><Text style={styles.gameTeams}>{game.away_team?.name ?? game.away_team_id}{'\n'}{game.home_team?.name ?? game.home_team_id}</Text>{showScore ? <Text style={styles.scores}>{game.away_score ?? '—'}{'\n'}{game.home_score ?? '—'}</Text> : null}</View></View></Pressable>;
          })}
          {publicHome?.weeklyGames.status === 'error' && publicHome.weeklyGames.data.length > 0 ? <Text style={styles.staleNote}>{publicHome.weeklyGames.message}</Text> : null}
        </View>

        <View testID="home-leaders-section">
          <SectionHeading eyebrow="TOP PERFORMERS" title="League Leaders" />
          <MetricTabs value={leaderMetric} onChange={setLeaderMetric} />
          {!publicHome ? <SectionState loading onRetry={retry} /> : publicHome.leaders.status === 'error' && leaders.length === 0 ? <SectionState message={publicHome.leaders.message} onRetry={retry} /> : leaders.length === 0 ? <View style={[sectionCard, styles.emptyCard]}><Text style={styles.emptyTitle}>No {leaderMetric} leaders yet</Text><Text style={styles.emptyCopy}>Current-season skater totals will appear after completed games are published.</Text></View> : leaders.map((leader: HomeLeader, index) => <Pressable key={leader.player_id} accessibilityRole="button" style={[sectionCard, styles.leaderRow]} onPress={() => navigateToPlayerCard(navigation, { playerId: leader.player_id, leagueId: activeLeague.id })}><Text style={styles.rank}>{index + 1}</Text><View style={styles.leaderCopy}><Text style={styles.leaderName}>{leader.player_name}</Text><Text style={styles.leaderTeam}>{leader.display_team_name || leader.team_name || 'Free agent'}</Text></View><Text style={[styles.leaderValue, { color: accent }]}>{leader[leaderMetric]}</Text></Pressable>)}
          {publicHome?.leaders.status === 'error' && leaders.length > 0 ? <Text style={styles.staleNote}>{publicHome.leaders.message}</Text> : null}
        </View>

        <View testID="home-standings-section">
          <SectionHeading eyebrow="TABLE" title="Standings" action={<Pressable accessibilityRole="button" accessibilityLabel="Open standings" onPress={() => navigation?.navigate?.('Standings')}><Text style={[styles.textLink, { color: accent }]}>All standings</Text></Pressable>} />
          {divisions.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.divisionTabs}>{divisions.map((division) => <Pressable key={division.id} accessibilityRole="button" accessibilityState={{ selected: division.id === selectedDivision }} style={[styles.divisionTab, division.id === selectedDivision && styles.metricTabActive]} onPress={() => setDivisionId(division.id)}><Text style={styles.metricTabText}>{division.name}</Text></Pressable>)}</ScrollView> : null}
          {!publicHome ? <SectionState loading onRetry={retry} /> : publicHome.standings.status === 'error' && shownStandings.length === 0 ? <SectionState message={publicHome.standings.message} onRetry={retry} /> : shownStandings.length === 0 ? <View style={[sectionCard, styles.emptyCard]}><Text style={styles.emptyTitle}>No standings available yet</Text></View> : <View style={[sectionCard, styles.table]}><View style={styles.tableHeader}><Text style={[styles.tableTeam, styles.tableHeaderText]}>TEAM</Text><Text style={styles.tableStat}>GP</Text><Text style={styles.tableStat}>W</Text><Text style={styles.tableStat}>L</Text><Text style={styles.tableStat}>PTS</Text></View>{shownStandings.map((row: HomeStanding) => <Pressable key={row.team_id} accessibilityRole="button" style={styles.tableRow} onPress={() => navigation?.navigate?.('Team', { screen: 'TeamDetail', params: { teamId: row.team_id, leagueId: activeLeague.id } })}><View style={styles.tableTeam}><TeamLogo teamId={row.team_id} logoUrl={row.logo_url} teamName={row.team_name} primaryColor={row.primary_color} size={28} /><Text style={styles.tableTeamName}>{row.team_name}</Text></View><Text style={styles.tableStat}>{row.games_played}</Text><Text style={styles.tableStat}>{row.wins}</Text><Text style={styles.tableStat}>{row.losses}</Text><Text style={[styles.tableStat, { color: accent, fontWeight: '900' }]}>{row.points}</Text></Pressable>)}</View>}
          {publicHome?.standings.status === 'error' && shownStandings.length > 0 ? <Text style={styles.staleNote}>{publicHome.standings.message}</Text> : null}
        </View>

        {!publicHome ? <View testID="home-photos-loading"><SectionHeading eyebrow="FROM THE RINK" title="League Photos" /><SectionState loading onRetry={retry} /></View> : publicHome.photos.data.length > 0 || publicHome.albums.data.length > 0 ? <View testID="home-photos-section"><SectionHeading eyebrow="FROM THE RINK" title="League Photos" action={<Pressable accessibilityRole="link" onPress={() => openExternal(`${origin}/gallery`)}><Text style={[styles.textLink, { color: accent }]}>Gallery</Text></Pressable>} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRail}>{publicHome.photos.data.length > 0 ? publicHome.photos.data.map((photo) => <Pressable key={photo.id} accessibilityRole="link" onPress={() => openExternal(`${origin}/gallery/${photo.gallery_id}`)}><Image source={{ uri: photo.url }} style={styles.photo} alt={photo.caption ?? ''} /></Pressable>) : publicHome.albums.data.map((album) => <Pressable key={album.id} accessibilityRole="link" style={[sectionCard, styles.album]} onPress={() => openExternal(`${origin}/gallery/${album.id}`)}>{album.cover_photo_url ? <Image source={{ uri: album.cover_photo_url }} style={styles.albumImage} alt={album.title} /> : null}<Text style={styles.albumTitle}>{album.title}</Text></Pressable>)}</ScrollView>{publicHome.photos.status === 'error' ? <Text style={styles.staleNote}>{publicHome.photos.message}</Text> : null}{publicHome.albums.status === 'error' ? <Text style={styles.staleNote}>{publicHome.albums.message}</Text> : null}</View> : publicHome.photos.status === 'error' || publicHome.albums.status === 'error' ? <View testID="home-photos-error"><SectionHeading eyebrow="FROM THE RINK" title="League Photos" /><SectionState message="League photos are temporarily unavailable." onRetry={retry} /></View> : null}

        {!publicHome ? <View testID="home-community-loading"><SectionHeading eyebrow="CONNECT" title="Community" /><SectionState loading onRetry={retry} /></View> : publicHome.community.status === 'error' && publicHome.community.data.length === 0 ? <View testID="home-community-error"><SectionHeading eyebrow="CONNECT" title="Community" /><SectionState message={publicHome.community.message} onRetry={retry} /></View> : publicHome.community.data.length > 0 ? <View testID="home-community-section"><SectionHeading eyebrow="CONNECT" title="Community" /><View style={styles.communityGrid}>{publicHome.community.data.map((social) => <Pressable key={social.key} accessibilityRole="link" style={[sectionCard, styles.communityLink]} onPress={() => openExternal(social.url)}><Text style={styles.communityText}>{social.label}</Text><Ionicons name="open-outline" size={15} color={accent} /></Pressable>)}</View>{publicHome.community.status === 'error' ? <Text style={styles.staleNote}>{publicHome.community.message}</Text> : null}</View> : null}

        <View testID="home-sponsors-section">
          <SectionHeading eyebrow="PARTNERS" title={publicHome?.sponsors.data.some((row) => row.tier === 'premier') ? 'Premier Partners' : publicHome?.sponsors.data.some((row) => row.tier === 'gold') ? 'Featured Sponsors' : 'Powered by'} />
          {!publicHome ? <SectionState loading onRetry={retry} /> : <><View style={[sectionCard, styles.sponsorStrip]}>{publicHome.sponsors.data.map((sponsor: HomeSponsor) => <Pressable key={sponsor.id} accessibilityRole="link" accessibilityLabel={`Open ${sponsor.name}`} style={styles.sponsor} onPress={() => openExternal(sponsor.website_url)}>{sponsor.logo_url ? <Image source={{ uri: sponsor.logo_url }} style={styles.sponsorLogo} alt={sponsor.name} /> : <Image source={blhLogo} style={styles.sponsorLogo} alt="" />}<Text style={styles.sponsorName}>{sponsor.name}</Text></Pressable>)}</View>{publicHome.sponsors.status === 'error' ? <Text style={styles.staleNote}>{publicHome.sponsors.message}</Text> : null}</>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  arenaBackdrop: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  arenaGlow: { position: 'absolute', top: -80, left: -60, right: -80, height: 360, borderRadius: 180 },
  arenaRink: { position: 'absolute', width: 250, height: 470, right: -120, top: 120, borderWidth: 1, borderColor: homeTokens.rinkLine, borderRadius: 125, transform: [{ rotate: '-10deg' }] },
  arenaCenterLine: { position: 'absolute', top: '50%', right: 0, left: 0, height: 1, backgroundColor: homeTokens.rinkLine },
  arenaCenterCircle: { position: 'absolute', top: 191, left: 81, width: 86, height: 86, borderWidth: 1, borderColor: homeTokens.rinkLine, borderRadius: 43 },
  content: { paddingHorizontal: homeTokens.contentPadding, paddingTop: 6, paddingBottom: 34, gap: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 12 },
  brandWrap: { flex: 1, flexDirection: 'row', gap: 10, marginRight: 10 },
  brandCopy: { flex: 1, minWidth: 0 },
  logoFrame: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, backgroundColor: homeTokens.control, alignItems: 'center', justifyContent: 'center' },
  smallLogo: { width: 30, height: 30, resizeMode: 'contain' },
  homeEyebrow: { fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 1.8 },
  logo: { color: homeTokens.text, fontSize: 24, lineHeight: 28, fontWeight: '900', letterSpacing: -0.5 },
  logoCompact: { fontSize: 19, lineHeight: 23 },
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
  storyNavigation: { minHeight: 44, marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  storyNavigationButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, alignItems: 'center', justifyContent: 'center' },
  storyPosition: { minWidth: 48, color: homeTokens.textSecondary, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  nextGame: { minHeight: 228, padding: 16 },
  nextGameDetails: { minHeight: 132 },
  nextDate: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  matchup: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, gap: 10 },
  matchupCompact: { flexDirection: 'column', alignItems: 'stretch' },
  matchupTeam: { flex: 1, alignItems: 'center', gap: 7 },
  matchupTeamCompact: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', flexDirection: 'row', justifyContent: 'flex-start' },
  matchupName: { color: colors.textPrimary, textAlign: 'center', fontSize: 14, lineHeight: 18, fontWeight: '800' },
  vs: { color: colors.textSecondary, fontSize: 11, fontWeight: '900' },
  location: { color: colors.textSecondary, textAlign: 'center', fontSize: 12, marginTop: 14 },
  checkinRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  checkinButton: { flex: 1, minHeight: 44, borderRadius: 14, backgroundColor: colors.bgInteractive, alignItems: 'center', justifyContent: 'center' },
  checkinText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  checkinTextSelected: { color: '#07111F' },
  checkinSummary: { color: colors.textSecondary, textAlign: 'center', fontSize: 11, marginTop: 9 },
  checkinPendingRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
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
  metricTabs: { flexDirection: 'row', gap: 7, marginBottom: 8 },
  metricTab: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, alignItems: 'center', justifyContent: 'center' },
  metricTabActive: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: colors.glassStrokeStrong },
  metricTabText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  metricTabTextActive: { color: colors.textPrimary },
  leaderRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, marginBottom: 6 },
  rank: { width: 28, color: colors.textSecondary, fontSize: 13, fontWeight: '900' },
  leaderCopy: { flex: 1 },
  leaderName: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' },
  leaderTeam: { color: colors.textSecondary, fontSize: 10, marginTop: 2 },
  leaderValue: { fontSize: 20, fontWeight: '900' },
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
  sponsorStrip: { minHeight: 92, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 14 },
  sponsor: { minWidth: 100, minHeight: 60, alignItems: 'center', justifyContent: 'center' },
  sponsorLogo: { width: 78, height: 38, resizeMode: 'contain' },
  sponsorName: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', marginTop: 4 },
});
