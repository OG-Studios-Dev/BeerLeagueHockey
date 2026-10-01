import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BrandAtmosphere from '../components/BrandAtmosphere';
import { FocusCard, FocusScrollView } from '../components/CardFocus';
import CareerTrendChart from '../components/PlayerProfile/CareerTrendChart';
import PlayerPortrait from '../components/PlayerProfile/PlayerPortrait';
import SeasonPicker from '../components/PlayerProfile/SeasonPicker';
import SectionHeader from '../components/SectionHeader';
import TeamLogo from '../components/TeamLogo';
import { HOCKEY_LIFE_ID, HOCKEY_LIFE_PRIMARY, HOCKEY_LIFE_SLUG } from '../config/hockeyLife';
import { createPlayerRequestGate, getPlayerMetricDefinitions } from '../lib/playerPageModel';
import { loadHockeyLifePlayerPage, type HockeyLifePlayerPage, type PlayerMetricValues } from '../lib/supabase/playerPage';
import type { PlayerCardParams } from '../navigation/types';
import { navigateToTeamDetail } from '../navigation/teamDetail';
import { useMobileShellData } from '../navigation/MobileShellDataContext';
import colors from '../theme/colors';
import { getContrastTextColor } from '../theme/contrast';
import { resolveFocusAccent } from '../theme/focusAccent';

type Props = { route: { params: PlayerCardParams }; navigation: { goBack: () => void; navigate: (screen: string, params?: unknown) => void } };

function metricValue(key: string, values: PlayerMetricValues) {
  const value = values[key];
  if (value == null) return '—';
  if (key === 'save_percentage') return (value / 100).toFixed(3).replace(/^0/, '');
  if (key === 'goals_against_average' || key.endsWith('_per_game') || key === 'shooting_percentage') return value.toFixed(2);
  if (key === 'plus_minus' && value > 0) return `+${value}`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
function badgeLabel(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function dateLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function leadershipLabel(value: string | null) {
  if (value === 'captain') return 'C  Captain';
  if (value === 'alternate_captain') return 'A  Alternate';
  return value ? badgeLabel(value) : null;
}
function ParitySection({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><SectionHeader title={title} />{children}</View>;
}
function EmptySection({ children }: { children: string }) {
  return <View style={styles.emptyCard}><Text style={styles.emptyText}>{children}</Text></View>;
}
function DataCell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <Text numberOfLines={2} style={[styles.tableCell, wide && styles.tableCellWide]}>{children}</Text>;
}

export default function PlayerCardScreen({ route, navigation }: Props) {
  const { focusAccent } = useMobileShellData();
  const playerId = route.params.playerId;
  const gate = React.useMemo(() => createPlayerRequestGate(), []);
  const [selection, setSelection] = React.useState<{ playerId: string; seasonId: string | null | undefined }>({ playerId, seasonId: undefined });
  const requestedSeasonId = selection.playerId === playerId ? selection.seasonId : undefined;
  const chooseSeason = (seasonId: string | null) => setSelection({ playerId, seasonId });
  const [state, setState] = React.useState<{ status: 'loading' | 'ready' | 'error' | 'empty'; data: HockeyLifePlayerPage | null }>({ status: 'loading', data: null });

  const load = React.useCallback(async () => {
    const identity = `${playerId}:${requestedSeasonId === undefined ? 'current' : requestedSeasonId ?? 'all'}`;
    const request = gate.begin(identity);
    setState((current) => ({ status: 'loading', data: current.data?.playerId === playerId ? current.data : null }));
    try {
      const data = await loadHockeyLifePlayerPage(playerId, requestedSeasonId);
      if (gate.isCurrent(request, identity)) setState({ status: data ? 'ready' : 'empty', data });
    } catch {
      if (gate.isCurrent(request, identity)) setState((current) => ({ status: 'error', data: current.data }));
    }
  }, [gate, playerId, requestedSeasonId]);

  React.useEffect(() => { void load(); return () => gate.invalidate(); }, [gate, load]);

  const data = state.data;
  const accent = resolveFocusAccent(data?.team?.primaryColor, focusAccent);
  if (state.status === 'loading' && !data) return <SafeAreaView style={styles.safeArea} edges={['left', 'right']}><View style={styles.centered}><ActivityIndicator color={accent} /><Text style={styles.stateText}>Loading Hockey Life player</Text></View></SafeAreaView>;
  if (state.status === 'empty') return <SafeAreaView style={styles.safeArea} edges={['left', 'right']}><View style={styles.centered}><Ionicons name="person-circle-outline" size={42} color={colors.textSecondary} /><Text style={styles.stateTitle}>Player unavailable</Text><Text style={styles.stateText}>This player is not accessible in Hockey Life.</Text></View></SafeAreaView>;
  if (!data) return <SafeAreaView style={styles.safeArea} edges={['left', 'right']}><View style={styles.centered}><Text style={styles.stateTitle}>Unable to load player</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View></SafeAreaView>;

  const seasonHeading = data.isCareer ? 'Career Stats' : data.selectedSeasonName ? `${data.selectedSeasonName} Stats` : 'Season Stats';
  const metricDefinitions = getPlayerMetricDefinitions(data.isGoalie);
  const filteredBadges = data.selectedSeasonId ? data.badges.filter((badge) => badge.seasonId === data.selectedSeasonId) : data.badges;
  const heroAwards = data.heroAwards ?? [];
  const leadership = leadershipLabel(data.leadershipRole);
  const showGameLog = !data.isCareer && !data.aggregateOnly;
  const showMatchups = showGameLog && data.matchups.length > 0;
  const shareScope = data.isCareer ? 'Career' : data.selectedSeasonName ?? 'Season';
  const sharePlayer = () => Share.share({
    title: `${data.fullName} · Hockey Life Player`,
    message: `${data.fullName} · Hockey Life Player\n${shareScope} stats and history: https://hockey-life.beerleaguehockey.ca/${HOCKEY_LIFE_SLUG}/players/${data.playerId}${data.isCareer ? '?season=all' : data.selectedSeasonId ? `?season=${data.selectedSeasonId}` : ''}`,
  });

  return <SafeAreaView style={styles.safeArea} edges={['left', 'right']} onAccessibilityEscape={navigation.goBack}>
    <BrandAtmosphere accentColor={accent} secondaryColor={HOCKEY_LIFE_PRIMARY} intensity="medium" />
    <FocusScrollView accentColor={accent} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <FocusCard focusId={`player:${data.playerId}:identity`} accentColor={accent} style={[styles.hero, { borderTopColor: accent }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Share player card" onPress={() => void sharePlayer()} style={styles.shareButton}><Ionicons name="share-outline" size={20} color={colors.textPrimary} /></Pressable>
        <View style={styles.portraitWrap}><PlayerPortrait uri={data.photoUrl} name={data.fullName} accent={accent} />{data.jerseyNumber != null ? <View style={[styles.jerseyBadge, { backgroundColor: accent }]}><Text style={[styles.jerseyBadgeText, { color: getContrastTextColor(accent) }]}>#{data.jerseyNumber}</Text></View> : null}</View>
        <Text style={styles.playerName}>{data.fullName}</Text>
        {heroAwards.some((award) => award.count > 0) ? <View style={styles.heroAwards}>{heroAwards.filter((award) => award.count > 0).map((award) => <View key={award.key} style={styles.heroAward}>{award.imageUrl ? <Image alt={award.label} source={{ uri: award.imageUrl }} resizeMode="contain" accessibilityLabel={award.label} style={styles.trophyImage} /> : <Ionicons name="trophy-outline" size={42} color={accent} />}<Text style={styles.awardCount}>×{award.count}</Text><Text numberOfLines={2} style={styles.awardLabel}>{award.label.toUpperCase()}</Text></View>)}</View> : null}
        {data.team ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${data.team.name}`} style={styles.teamLink} onPress={() => navigateToTeamDetail(navigation, { teamId: data.team!.id, leagueId: HOCKEY_LIFE_ID })}><TeamLogo teamId={data.team.id} logoUrl={data.team.logoUrl} teamName={data.team.name} primaryColor={accent} size={34} /><Text style={[styles.teamName, { color: accent }]}>{data.team.name}</Text></Pressable> : null}
        <View style={styles.metaRow}>{data.position ? <Text style={styles.metaPill}>{data.position.toUpperCase()}</Text> : null}{leadership ? <Text style={styles.leadershipPill}>{leadership.toUpperCase()}</Text> : null}</View>
      </FocusCard>

      {filteredBadges.length > 0 ? <ParitySection title="Achievements"><View style={styles.achievements}>{filteredBadges.map((badge) => <View key={badge.id} style={styles.badge}><Ionicons name="trophy-outline" size={24} color={accent} /><View style={styles.listCopy}><Text style={styles.badgeTitle}>{badgeLabel(badge.type)}</Text><Text style={styles.badgeMeta}>{[badge.seasonName, badge.teamName].filter(Boolean).join(' • ') || dateLabel(badge.createdAt)}</Text></View></View>)}</View></ParitySection> : null}

      <ParitySection title={seasonHeading}>
        <SeasonPicker seasons={data.seasons} selectedSeasonId={data.selectedSeasonId} isCareer={data.isCareer} accent={accent} onSelect={chooseSeason} />
        {data.metrics ? <View style={styles.metricGrid}>{metricDefinitions.map((metric) => <View key={metric.key} style={styles.metricCard}><Text style={[styles.metricValue, { color: metric.key === 'points' || metric.key === 'wins' ? accent : colors.textPrimary }]}>{metricValue(metric.key, data.metrics!)}</Text><Text style={styles.metricLabel}>{metric.label}</Text></View>)}</View> : <EmptySection>No stats available for this selection.</EmptySection>}
      </ParitySection>

      {data.careerRows.length > 0 ? <ParitySection title="Career Stats"><CareerTrendChart rows={data.careerRows} isGoalie={data.isGoalie} accent={accent} hotFacts={data.hotFacts} /></ParitySection> : null}

      {showGameLog ? <ParitySection title="Game Log">{data.games.length ? <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel="Game log table"><View><View style={styles.tableHeader}><DataCell wide>Date / Opponent</DataCell><DataCell>Result</DataCell><DataCell>{data.isGoalie ? 'SV' : 'G'}</DataCell><DataCell>{data.isGoalie ? 'GA' : 'A'}</DataCell><DataCell>{data.isGoalie ? 'SV%' : 'PTS'}</DataCell><DataCell>{data.isGoalie ? 'SO' : 'PIM'}</DataCell></View>{data.games.map((game) => <Pressable key={game.id} accessibilityRole="button" style={styles.tableRow} onPress={() => navigation.navigate('Schedule', { screen: 'GamePreview', params: { gameId: game.id } })}><DataCell wide>{dateLabel(game.date)}{`\nvs ${game.opponent ?? '—'}`}</DataCell><DataCell>{game.result ?? '—'}{`\n${game.score ?? '—'}`}</DataCell><DataCell>{metricValue(data.isGoalie ? 'saves' : 'goals', game.metrics)}</DataCell><DataCell>{metricValue(data.isGoalie ? 'goals_against' : 'assists', game.metrics)}</DataCell><DataCell>{metricValue(data.isGoalie ? 'save_percentage' : 'points', game.metrics)}</DataCell><DataCell>{metricValue(data.isGoalie ? 'shutouts' : 'penalty_minutes', game.metrics)}</DataCell></Pressable>)}</View></ScrollView> : <EmptySection>No games played this season.</EmptySection>}</ParitySection> : null}

      {showMatchups ? <ParitySection title="Matchup Stats"><ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel="Matchup stats table"><View><View style={styles.tableHeader}><DataCell wide>{data.isGoalie ? 'Shooter' : 'Goalie'}</DataCell><DataCell>GP</DataCell><DataCell>G</DataCell><DataCell>A</DataCell><DataCell>PTS</DataCell><DataCell>Shots</DataCell><DataCell>SH%</DataCell></View>{data.matchups.map((matchup) => <View key={matchup.id} style={styles.tableRow}><DataCell wide>{matchup.name}</DataCell><DataCell>{matchup.gamesPlayed}</DataCell><DataCell>{matchup.goals}</DataCell><DataCell>{matchup.assists}</DataCell><DataCell>{matchup.points}</DataCell><DataCell>{matchup.shots}</DataCell><DataCell>{matchup.shootingPct == null ? '—' : `${matchup.shootingPct.toFixed(1)}%`}</DataCell></View>)}</View></ScrollView></ParitySection> : null}

      {data.articles.length > 0 ? <ParitySection title="In The News"><View style={styles.articles}>{data.articles.map((article) => <Pressable key={article.id} accessibilityRole="button" style={styles.article} onPress={() => navigation.navigate('LeaguePages', { screen: 'NewsArticle', params: { leagueId: HOCKEY_LIFE_ID, leagueSlug: HOCKEY_LIFE_SLUG, articleSlug: article.slug ?? article.id } })}>{article.imageUrl ? <Image alt={article.title} source={{ uri: article.imageUrl }} resizeMode="cover" accessibilityLabel={article.title} style={styles.articleImage} /> : null}<View style={styles.listCopy}>{article.type || article.publishedAt ? <Text style={[styles.articleEyebrow, { color: accent }]}>{[article.type?.replace(/_/g, ' ').toUpperCase(), dateLabel(article.publishedAt)].filter(Boolean).join('  •  ')}</Text> : null}<Text style={styles.listTitle}>{article.title}</Text>{article.excerpt ? <Text numberOfLines={4} style={styles.listMeta}>{article.excerpt}</Text> : null}</View><Ionicons name="chevron-forward" size={18} color={colors.textSecondary} /></Pressable>)}</View></ParitySection> : null}

      {data.seasons.length > 1 ? <ParitySection title="Season History">{data.seasons.map((season) => { const selected = season.id === data.selectedSeasonId; return <Pressable key={season.id} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.historyRow, selected && { borderColor: accent }]} onPress={() => chooseSeason(season.id)}><Text style={styles.historyName}>{season.name}</Text>{selected ? <Text style={[styles.viewing, { color: accent }]}>Viewing</Text> : <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}</Pressable>; })}</ParitySection> : null}
      {state.status === 'error' ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.inlineError}><Text style={styles.emptyText}>Refresh failed. Showing the last loaded facts. Tap to retry.</Text></Pressable> : null}
    </FocusScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  stateTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', textAlign: 'center' }, stateText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  retry: { minWidth: 96, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: HOCKEY_LIFE_PRIMARY }, retryText: { color: getContrastTextColor(HOCKEY_LIFE_PRIMARY), fontWeight: '900' },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 150 }, hero: { alignItems: 'center', padding: 18, paddingTop: 24, borderRadius: 26, borderWidth: 1, borderTopWidth: 4, borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgSurface, overflow: 'hidden' },
  shareButton: { position: 'absolute', top: 8, right: 8, zIndex: 2, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElevated },
  portraitWrap: { position: 'relative', marginBottom: 22 }, jerseyBadge: { position: 'absolute', right: -8, bottom: -9, minWidth: 48, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 2, borderColor: colors.bgSurface }, jerseyBadgeText: { fontSize: 17, fontWeight: '900' },
  playerName: { color: colors.textPrimary, fontSize: 29, lineHeight: 35, fontWeight: '900', textAlign: 'center' }, heroAwards: { width: '100%', flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 }, heroAward: { width: 92, alignItems: 'center' }, trophyImage: { width: 58, height: 66 }, awardCount: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: -12, backgroundColor: colors.bgBase, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }, awardLabel: { color: colors.textSecondary, fontSize: 9, lineHeight: 12, fontWeight: '900', textAlign: 'center', marginTop: 5 },
  teamLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 14 }, teamName: { fontSize: 15, fontWeight: '900' }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 7, marginTop: 5 }, metaPill: { color: colors.textPrimary, borderWidth: 1, borderColor: colors.glassStrokeStrong, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, fontSize: 11, fontWeight: '800' }, leadershipPill: { color: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.13)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.45)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, fontSize: 11, fontWeight: '900' },
  section: { marginTop: 22 }, emptyCard: { minHeight: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, padding: 16 }, emptyText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  achievements: { gap: 8 }, badge: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 15, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, padding: 13 }, badgeTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' }, badgeMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, metricCard: { width: '30%', minWidth: 86, flexGrow: 1, alignItems: 'center', borderRadius: 15, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, paddingVertical: 14, paddingHorizontal: 6 }, metricValue: { fontSize: 21, fontWeight: '900' }, metricLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', marginTop: 3 },
  tableHeader: { minWidth: 560, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.glassStrokeStrong, backgroundColor: colors.bgElevated, paddingVertical: 9 }, tableRow: { minWidth: 560, minHeight: 61, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.glassStroke, backgroundColor: colors.bgSurface, paddingVertical: 8 }, tableCell: { width: 62, color: colors.textPrimary, fontSize: 11, lineHeight: 16, fontWeight: '700', textAlign: 'center', paddingHorizontal: 4 }, tableCellWide: { width: 178, textAlign: 'left', paddingLeft: 10 },
  listCopy: { flex: 1, minWidth: 0 }, listTitle: { color: colors.textPrimary, fontSize: 14, lineHeight: 19, fontWeight: '900' }, listMeta: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 5 }, articles: { gap: 10 }, article: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, padding: 12 }, articleImage: { width: 78, height: 78, borderRadius: 11, backgroundColor: colors.bgInteractive }, articleEyebrow: { fontSize: 9, fontWeight: '900', marginBottom: 4 },
  historyRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 13, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, paddingHorizontal: 14, marginBottom: 7 }, historyName: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' }, viewing: { fontSize: 11, fontWeight: '900' }, inlineError: { minHeight: 58, justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.accentRed, padding: 12, marginTop: 18 },
});
