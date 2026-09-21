import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../components/Avatar';
import BrandAtmosphere from '../components/BrandAtmosphere';
import { FocusCard, FocusScrollView } from '../components/CardFocus';
import SectionHeader from '../components/SectionHeader';
import TeamLogo from '../components/TeamLogo';
import { HOCKEY_LIFE_ID, HOCKEY_LIFE_PRIMARY, HOCKEY_LIFE_SLUG } from '../config/hockeyLife';
import { createPlayerRequestGate, getPlayerMetricDefinitions } from '../lib/playerPageModel';
import { loadHockeyLifePlayerPage, type HockeyLifePlayerPage, type PlayerMetricValues } from '../lib/supabase/playerPage';
import type { PlayerCardParams } from '../navigation/types';
import { navigateToTeamDetail } from '../navigation/teamDetail';
import colors from '../theme/colors';
import { getContrastTextColor } from '../theme/contrast';

type Props = {
  route: { params: PlayerCardParams };
  navigation: { goBack: () => void; navigate: (screen: string, params?: unknown) => void };
};

function metricValue(key: string, values: PlayerMetricValues) {
  const value = values[key];
  if (value == null) return '—';
  if (key === 'save_percentage') return `${value.toFixed(1)}%`;
  if (key === 'goals_against_average') return value.toFixed(2);
  if (key === 'plus_minus' && value > 0) return `+${value}`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function badgeLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function leadershipLabel(value: string | null) {
  if (value === 'captain') return 'Captain';
  if (value === 'alternate_captain') return 'Alternate';
  return null;
}

function ParitySection({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><SectionHeader title={title} />{children}</View>;
}

function EmptySection({ children }: { children: string }) {
  return <View style={styles.emptyCard}><Text style={styles.emptyText}>{children}</Text></View>;
}

export default function PlayerCardScreen({ route, navigation }: Props) {
  const playerId = route.params.playerId;
  const gate = React.useMemo(() => createPlayerRequestGate(), []);
  const [requestedSeasonId, setRequestedSeasonId] = React.useState<string | null | undefined>(undefined);
  const [state, setState] = React.useState<{ status: 'loading' | 'ready' | 'error' | 'empty'; data: HockeyLifePlayerPage | null }>({ status: 'loading', data: null });

  const load = React.useCallback(async () => {
    const identity = `${playerId}:${requestedSeasonId === undefined ? 'current' : requestedSeasonId ?? 'all'}`;
    const request = gate.begin(identity);
    setState((current) => ({ status: 'loading', data: current.data?.playerId === playerId ? current.data : null }));
    try {
      const data = await loadHockeyLifePlayerPage(playerId, requestedSeasonId);
      if (!gate.isCurrent(request, identity)) return;
      setState({ status: data ? 'ready' : 'empty', data });
    } catch {
      if (gate.isCurrent(request, identity)) setState((current) => ({ status: 'error', data: current.data }));
    }
  }, [gate, playerId, requestedSeasonId]);

  React.useEffect(() => {
    void load();
    return () => gate.invalidate();
  }, [gate, load]);

  const data = state.data;
  const accent = data?.team?.primaryColor && /^#[0-9a-f]{6}$/i.test(data.team.primaryColor) ? data.team.primaryColor : HOCKEY_LIFE_PRIMARY;

  if (state.status === 'loading' && !data) {
    return <SafeAreaView style={styles.safeArea} edges={['left', 'right']}><View style={styles.centered}><ActivityIndicator color={accent} /><Text style={styles.stateText}>Loading Hockey Life player</Text></View></SafeAreaView>;
  }
  if (state.status === 'empty') {
    return <SafeAreaView style={styles.safeArea} edges={['left', 'right']}><View style={styles.centered}><Ionicons name="person-circle-outline" size={42} color={colors.textSecondary} /><Text style={styles.stateTitle}>Player unavailable</Text><Text style={styles.stateText}>This player is not accessible in Hockey Life.</Text></View></SafeAreaView>;
  }
  if (!data) {
    return <SafeAreaView style={styles.safeArea} edges={['left', 'right']}><View style={styles.centered}><Text style={styles.stateTitle}>Unable to load player</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View></SafeAreaView>;
  }

  const seasonHeading = data.isCareer ? 'Career Stats' : data.selectedSeasonName ? `${data.selectedSeasonName} Stats` : 'Season Stats';
  const metrics = getPlayerMetricDefinitions(data.isGoalie);
  const filteredBadges = data.selectedSeasonId ? data.badges.filter((badge) => badge.seasonId === data.selectedSeasonId) : data.badges;
  const trendMetrics = data.isGoalie
    ? [{ key: 'wins', label: 'W' }, { key: 'save_percentage', label: 'SV%' }, { key: 'goals_against_average', label: 'GAA' }, { key: 'saves', label: 'SV' }]
    : [{ key: 'goals', label: 'G' }, { key: 'assists', label: 'A' }, { key: 'points', label: 'PTS' }, { key: 'points_per_game', label: 'PPG' }];
  const leadership = leadershipLabel(data.leadershipRole);
  const sharePlayer = () => Share.share({
    title: `${data.fullName} · Hockey Life Player`,
    message: `${data.fullName} · Hockey Life Player\n${data.selectedSeasonName ?? 'Career'} stats and history in the Hockey Life app.`,
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']} onAccessibilityEscape={navigation.goBack}>
      <BrandAtmosphere accentColor={accent} secondaryColor={HOCKEY_LIFE_PRIMARY} intensity="medium" />
      <FocusScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FocusCard focusId={`player:${data.playerId}:identity`} accentColor={accent} style={[styles.hero, { borderTopColor: accent }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Share player card" onPress={() => void sharePlayer()} style={styles.shareButton}><Ionicons name="share-outline" size={20} color={colors.textPrimary} /></Pressable>
          <View style={styles.heroIdentity}>
            <Avatar uri={data.photoUrl} name={data.fullName} size={94} borderColor={accent} />
            <View style={styles.heroCopy}>
              <Text style={styles.playerName}>{data.fullName}</Text>
              {data.team ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${data.team.name}`} style={styles.teamLink} onPress={() => navigateToTeamDetail(navigation, { teamId: data.team!.id, leagueId: HOCKEY_LIFE_ID })}><TeamLogo teamId={data.team.id} logoUrl={data.team.logoUrl} teamName={data.team.name} primaryColor={accent} size={30} /><Text style={[styles.teamName, { color: accent }]}>{data.team.name}</Text></Pressable> : null}
              <View style={styles.metaRow}>
                {data.jerseyNumber != null ? <Text style={[styles.metaPill, { borderColor: accent }]}>#{data.jerseyNumber}</Text> : null}
                {data.position ? <Text style={styles.metaPill}>{data.position}</Text> : null}
                {leadership ? <Text style={styles.leadershipPill}>{leadership}</Text> : null}
              </View>
            </View>
          </View>
        </FocusCard>

        <ParitySection title="Achievements">
          {filteredBadges.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badges}>{filteredBadges.map((badge) => <View key={badge.id} style={styles.badge}><Ionicons name="trophy-outline" size={21} color={accent} /><Text style={styles.badgeTitle}>{badgeLabel(badge.type)}</Text><Text style={styles.badgeMeta}>{badge.seasonName ?? badge.teamName ?? dateLabel(badge.createdAt)}</Text></View>)}</ScrollView> : <EmptySection>No achievements recorded for this selection.</EmptySection>}
        </ParitySection>

        <ParitySection title="Season Stats">
          <Text style={styles.selectedSeasonHeading}>{seasonHeading}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasons}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: data.isCareer }} style={[styles.seasonChip, data.isCareer && { borderColor: accent, backgroundColor: `${accent}22` }]} onPress={() => setRequestedSeasonId(null)}><Text style={[styles.seasonChipText, data.isCareer && { color: accent }]}>Career</Text></Pressable>
            {data.seasons.map((season) => { const selected = season.id === data.selectedSeasonId; return <Pressable key={season.id} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.seasonChip, selected && { borderColor: accent, backgroundColor: `${accent}22` }]} onPress={() => setRequestedSeasonId(season.id)}><Text style={[styles.seasonChipText, selected && { color: accent }]}>{season.name}</Text></Pressable>; })}
          </ScrollView>
          {data.metrics ? <View style={styles.metricGrid}>{metrics.map((metric) => <View key={metric.key} style={styles.metricCard}><Text style={[styles.metricValue, { color: metric.key === 'points' || metric.key === 'wins' ? accent : colors.textPrimary }]}>{metricValue(metric.key, data.metrics!)}</Text><Text style={styles.metricLabel}>{metric.label}</Text></View>)}</View> : <EmptySection>No stats available for this selection.</EmptySection>}
        </ParitySection>

        <ParitySection title="Career Stats">
          {data.careerRows.length ? data.careerRows.map((season) => <View key={season.seasonId} style={styles.trendRow}><Text style={styles.trendSeason}>{season.seasonName}</Text>{trendMetrics.map((metric) => <View key={metric.key} style={styles.trendMetric}><Text style={styles.trendValue}>{metricValue(metric.key, season.metrics)}</Text><Text style={styles.trendLabel}>{metric.label}</Text></View>)}</View>) : <EmptySection>No Hockey Life career seasons are available.</EmptySection>}
        </ParitySection>

        <ParitySection title="Game Log">
          {data.isCareer ? <EmptySection>Select a season to view its game log.</EmptySection> : data.games.length ? data.games.map((game) => <Pressable key={game.id} accessibilityRole="button" style={styles.listRow} onPress={() => navigation.navigate('Schedule', { screen: 'GamePreview', params: { gameId: game.id } })}><View style={styles.listCopy}><Text style={styles.listTitle}>{game.opponent}</Text><Text style={styles.listMeta}>{dateLabel(game.date)} · {game.result} · {game.score}</Text></View><Text style={[styles.listMetric, { color: accent }]}>{data.isGoalie ? `${metricValue('saves', game.metrics)} SV` : `${metricValue('points', game.metrics)} PTS`}</Text><Ionicons name="chevron-forward" size={18} color={colors.textSecondary} /></Pressable>) : <EmptySection>No games played this season.</EmptySection>}
        </ParitySection>

        <ParitySection title="Matchup Stats">
          {data.isCareer ? <EmptySection>Select a season to view matchup stats.</EmptySection> : data.matchups.length ? data.matchups.map((matchup) => <View key={matchup.id} style={styles.listRow}><View style={styles.listCopy}><Text style={styles.listTitle}>{matchup.name}</Text><Text style={styles.listMeta}>{matchup.gamesPlayed} GP · {matchup.shots} shots</Text></View><Text style={[styles.listMetric, { color: accent }]}>{matchup.points} PTS</Text></View>) : <EmptySection>No matchup stats are available for this season.</EmptySection>}
        </ParitySection>

        <ParitySection title="In The News">
          {data.articles.length ? data.articles.map((article) => <Pressable key={article.id} accessibilityRole="button" style={styles.article} onPress={() => navigation.navigate('LeaguePages', { screen: 'NewsArticle', params: { leagueId: HOCKEY_LIFE_ID, leagueSlug: HOCKEY_LIFE_SLUG, articleSlug: article.slug ?? article.id } })}><View style={styles.listCopy}><Text style={styles.listTitle}>{article.title}</Text><Text numberOfLines={2} style={styles.listMeta}>{article.excerpt ?? dateLabel(article.publishedAt)}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textSecondary} /></Pressable>) : <EmptySection>No published Hockey Life stories tag this player.</EmptySection>}
        </ParitySection>

        <ParitySection title="Season History">
          {data.seasons.length > 1 ? data.seasons.map((season) => { const selected = season.id === data.selectedSeasonId; return <Pressable key={season.id} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.historyRow, selected && { borderColor: accent }]} onPress={() => setRequestedSeasonId(season.id)}><Text style={styles.historyName}>{season.name}</Text>{selected ? <Ionicons name="checkmark-circle" size={19} color={accent} /> : <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}</Pressable>; }) : <EmptySection>No other Hockey Life seasons are available.</EmptySection>}
        </ParitySection>

        {state.status === 'error' ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.inlineError}><Text style={styles.emptyText}>Refresh failed. Showing the last loaded facts. Tap to retry.</Text></Pressable> : null}
      </FocusScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  stateTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  stateText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  retry: { minWidth: 96, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: HOCKEY_LIFE_PRIMARY },
  retryText: { color: getContrastTextColor(HOCKEY_LIFE_PRIMARY), fontWeight: '900' },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 150 },
  hero: { padding: 18, borderRadius: 20, borderWidth: 1, borderTopWidth: 4, borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgSurface, overflow: 'hidden' },
  shareButton: { position: 'absolute', top: 8, right: 8, zIndex: 2, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElevated },
  heroIdentity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroCopy: { flex: 1, minWidth: 0, gap: 8 },
  playerName: { color: colors.textPrimary, fontSize: 26, lineHeight: 31, fontWeight: '900' },
  teamLink: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamName: { flex: 1, fontSize: 15, fontWeight: '800' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaPill: { color: colors.textPrimary, borderWidth: 1, borderColor: colors.glassStrokeStrong, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: '800' },
  leadershipPill: { color: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.12)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: '900' },
  section: { marginTop: 20 },
  emptyCard: { minHeight: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, padding: 16 },
  emptyText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  badges: { gap: 10, paddingRight: 16 },
  badge: { width: 148, minHeight: 112, gap: 7, borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, padding: 14 },
  badgeTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' },
  badgeMeta: { color: colors.textSecondary, fontSize: 11 },
  selectedSeasonHeading: { color: colors.textPrimary, fontSize: 17, fontWeight: '900', marginBottom: 10 },
  seasons: { gap: 8, paddingBottom: 12, paddingRight: 16 },
  seasonChip: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: colors.glassStrokeStrong, borderRadius: 999, paddingHorizontal: 14, backgroundColor: colors.bgSurface },
  seasonChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { width: '31%', minWidth: 92, flexGrow: 1, alignItems: 'center', borderRadius: 15, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, paddingVertical: 14, paddingHorizontal: 8 },
  metricValue: { fontSize: 21, fontWeight: '900' },
  metricLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', marginTop: 3 },
  trendRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.glassStroke, paddingVertical: 10 },
  trendSeason: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  trendMetric: { width: 43, alignItems: 'flex-end' },
  trendValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' },
  trendLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '800' },
  listRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.glassStroke, paddingVertical: 10, paddingHorizontal: 4 },
  listCopy: { flex: 1, minWidth: 0 },
  listTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  listMeta: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 },
  listMetric: { fontSize: 13, fontWeight: '900' },
  article: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, padding: 13, marginBottom: 8 },
  historyRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 13, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, paddingHorizontal: 14, marginBottom: 7 },
  historyName: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  inlineError: { minHeight: 58, justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.accentRed, padding: 12, marginTop: 18 },
});
