import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';

import jackFooteArt from '../../assets/league-leaders/jack-foote.png';
import neutralHelmetArt from '../../assets/league-leaders/neutral-helmet-player.png';
import type { HomeLeader } from '../lib/supabase/home';
import {
  type HomeLeaderMetric,
  type LeaderArtwork,
  type RankedHomeLeader,
  rankHomeLeaders,
  resolveLeaderArtwork,
} from '../lib/homeLeagueLeaders';
import { HOME_VISUAL_TOKENS as homeTokens } from '../theme/home';
import { FocusCard } from './CardFocus';
import TeamLogo from './TeamLogo';

const GENERATED_ART: Record<'jack-foote-v1', ImageSourcePropType> = {
  'jack-foote-v1': jackFooteArt,
};
const NEUTRAL_ART: ImageSourcePropType = neutralHelmetArt;
const METRICS: readonly { key: HomeLeaderMetric; label: string }[] = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'points', label: 'Points' },
];

type Props = {
  leagueId: string;
  seasonName: string | null;
  metric: HomeLeaderMetric;
  leaders: readonly HomeLeader[];
  status: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  width: number;
  fontScale: number;
  reduceTransparency: boolean;
  onMetricChange: (metric: HomeLeaderMetric) => void;
  onRetry: () => void;
  onOpenPlayer: (playerId: string) => void;
  onOpenAllStats: () => void;
};

function artworkSource(artwork: LeaderArtwork, stage: LeaderArtwork['kind']): ImageSourcePropType {
  if (stage === 'neutral') return NEUTRAL_ART;
  if (stage === 'photo' && artwork.kind === 'photo') return { uri: artwork.uri };
  if (stage === 'photo' && artwork.kind === 'generated') {
    return { uri: artwork.fallbackUri };
  }
  return GENERATED_ART[(artwork as Extract<LeaderArtwork, { kind: 'generated' }>).artworkId];
}

function LeaderArtworkImage({ artwork, leader }: { artwork: LeaderArtwork; leader: RankedHomeLeader }) {
  const [attempt, setAttempt] = React.useState({ identityKey: artwork.identityKey, stage: artwork.kind, generation: 0 });
  const currentAttempt = React.useMemo(() => attempt.identityKey === artwork.identityKey
    ? attempt
    : { identityKey: artwork.identityKey, stage: artwork.kind, generation: 0 },
  [artwork.identityKey, artwork.kind, attempt]);
  const attemptRef = React.useRef(currentAttempt);
  React.useLayoutEffect(() => {
    attemptRef.current = currentAttempt;
  }, [currentAttempt]);
  const { stage, generation } = currentAttempt;
  const shownLabel = stage === 'neutral'
    ? `${leader.player_name}, no player photo available`
    : stage === 'photo' ? `${leader.player_name} player photo` : artwork.accessibilityLabel;
  const handleError = () => {
    const captured = { identityKey: artwork.identityKey, stage, generation };
    const latest = attemptRef.current;
    if (
      captured.stage === 'neutral'
      || latest.identityKey !== captured.identityKey
      || latest.stage !== captured.stage
      || latest.generation !== captured.generation
    ) return;

    const next = {
      identityKey: captured.identityKey,
      stage: captured.stage === 'generated' ? 'photo' as const : 'neutral' as const,
      generation: captured.generation + 1,
    };
    attemptRef.current = next;
    setAttempt(next);
  };
  return (
    <Image
      key={`${stage}:${generation}`}
      testID="home-leader-feature-art"
      source={artworkSource(artwork, stage)}
      accessibilityLabel={shownLabel}
      alt={shownLabel}
      resizeMode="contain"
      style={[styles.artImage, stage === 'photo' && styles.photoImage]}
      onLoad={() => {}}
      onError={handleError}
    />
  );
}

function MetricTabs({ value, onChange }: { value: HomeLeaderMetric; onChange: (metric: HomeLeaderMetric) => void }) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {METRICS.map(({ key, label }) => (
        <Pressable
          key={key}
          testID={`home-leaders-tab-${key}`}
          accessibilityRole="tab"
          accessibilityLabel={`Show ${label} leaders`}
          accessibilityState={{ selected: value === key }}
          aria-selected={value === key}
          onPress={() => onChange(key)}
          style={({ pressed }) => [styles.tab, value === key && styles.tabSelected, pressed && styles.pressed]}
        >
          <Text style={[styles.tabText, value === key && styles.tabTextSelected]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function LeaderRow({ leader, compact, onOpen }: { leader: RankedHomeLeader; compact: boolean; onOpen: () => void }) {
  const teamName = leader.display_team_name || leader.team_name || 'Free agent';
  const metricLabel = leader.metric.toUpperCase();
  return (
    <FocusCard focusId={`home:leader:${leader.metric}:${leader.player_id}`}>
      <Pressable
        testID={`home-leader-row-${leader.player_id}`}
        accessibilityRole="button"
        accessibilityLabel={`${leader.rankLabel}. ${leader.player_name}, ${teamName}, ${leader.metricValue} ${leader.metric}. Open player card.`}
        onPress={onOpen}
        style={({ pressed }) => [styles.row, compact && styles.rowCompact, pressed && styles.pressed]}
      >
        <Text allowFontScaling={false} style={[styles.rank, compact && styles.rankCompact, leader.tied && styles.tiedRank]}>{leader.rankLabel}</Text>
        <View style={styles.rowCopy}>
          <Text style={[styles.name, compact && styles.nameCompact]}>{leader.player_name}</Text>
          <View style={[styles.valueLine, compact && styles.valueLineCompact]}>
            <TeamLogo
              key={`${leader.team_id ?? 'free'}:${leader.display_team_logo_url ?? 'none'}`}
              teamId={leader.team_id}
              logoUrl={leader.display_team_logo_url}
              teamName={teamName}
              size={compact ? 30 : 36}
              transparentBacking
            />
            <Text allowFontScaling={false} style={[styles.value, compact && styles.valueCompact]}>{leader.metricValue}</Text>
            <Text style={[styles.metricLabel, compact && styles.metricLabelCompact]}>{metricLabel}</Text>
          </View>
        </View>
      </Pressable>
    </FocusCard>
  );
}

export default function HomeLeagueLeaders({
  leagueId, seasonName, metric, leaders, status, errorMessage, width, fontScale,
  onMetricChange, onRetry, onOpenPlayer, onOpenAllStats,
}: Props) {
  const ranked = rankHomeLeaders(leaders, metric);
  const featured = ranked[0] ?? null;
  const artwork = featured ? resolveLeaderArtwork(leagueId, featured) : null;
  const stacked = fontScale >= 1.3;
  const compact = width <= 340 && !stacked;
  const artStageHeight = stacked ? Math.min(340, Math.max(280, Math.round(width * 0.82))) : 326;

  return (
    <View testID="home-league-leaders" style={styles.module}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>LEAGUE</Text>
          <Text accessibilityRole="header" style={styles.title}>League Leaders</Text>
          {seasonName ? <Text style={styles.season}>{seasonName}</Text> : null}
        </View>
      </View>
      <MetricTabs value={metric} onChange={onMetricChange} />

      {status === 'loading' ? (
        <View testID="home-leaders-loading" style={styles.state} accessibilityLiveRegion="polite">
          <ActivityIndicator color="#A970FF" />
          <Text style={styles.stateText}>Loading league leaders…</Text>
        </View>
      ) : status === 'error' && ranked.length === 0 ? (
        <View testID="home-leaders-error" style={styles.state} accessibilityLiveRegion="polite">
          <Ionicons name="cloud-offline-outline" size={22} color={homeTokens.textSecondary} />
          <Text style={styles.stateText}>{errorMessage || 'Current-season leaders are temporarily unavailable.'}</Text>
          <Pressable testID="home-leaders-retry" accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      ) : ranked.length === 0 ? (
        <View testID="home-leaders-empty" style={styles.state} accessibilityLiveRegion="polite">
          <Text style={styles.stateTitle}>No {metric} leaders yet</Text>
          <Text style={styles.stateText}>Current-season skater totals will appear after completed games are published.</Text>
        </View>
      ) : (
        <>
          <View testID="home-leaders-layout" style={[styles.layout, compact && styles.layoutCompact, stacked && styles.layoutStacked]}>
            <View style={[styles.ranking, compact && styles.rankingCompact, stacked && styles.rankingStacked]}>
              {ranked.map((leader) => <LeaderRow key={leader.player_id} leader={leader} compact={compact} onOpen={() => onOpenPlayer(leader.player_id)} />)}
            </View>
            {featured && artwork ? (
              <Pressable
                testID="home-leader-feature-action"
                accessibilityRole="button"
                accessibilityLabel={`Open ${featured.player_name} player card`}
                onPress={() => onOpenPlayer(featured.player_id)}
                style={({ pressed }) => [styles.artStage, { height: artStageHeight }, stacked && styles.artStageStacked, pressed && styles.pressed]}
              >
                <LeaderArtworkImage key={artwork.identityKey} artwork={artwork} leader={featured} />
              </Pressable>
            ) : null}
          </View>
          {status === 'error' ? <Text style={styles.staleNote}>{errorMessage}</Text> : null}
        </>
      )}

      <Pressable testID="home-leaders-all-stats" accessibilityRole="button" accessibilityLabel="View all league stats" onPress={onOpenAllStats} style={({ pressed }) => [styles.allStats, pressed && styles.pressed]}>
        <Text style={styles.allStatsText}>View all stats</Text><Ionicons name="arrow-forward" size={16} color={homeTokens.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  module: { width: '100%', overflow: 'hidden', paddingVertical: 4 },
  heading: { minHeight: 58, flexDirection: 'row', alignItems: 'flex-end' },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: homeTokens.textSecondary, fontSize: 10, lineHeight: 15, fontWeight: '900', letterSpacing: 2.8 },
  title: { color: homeTokens.text, fontSize: 28, lineHeight: 34, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.8 },
  season: { color: homeTokens.textSecondary, fontSize: 11, lineHeight: 17, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', marginTop: 3 },
  tabs: { flexDirection: 'row', gap: 6, marginTop: 13, marginBottom: 12 },
  tab: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  tabSelected: { borderColor: 'rgba(172, 101, 255, 0.72)', backgroundColor: 'rgba(103, 48, 151, 0.28)' },
  tabText: { color: homeTokens.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  tabTextSelected: { color: homeTokens.text },
  layout: { minHeight: 326, flexDirection: 'row', alignItems: 'stretch', gap: 4 },
  layoutCompact: { gap: 0 },
  layoutStacked: { flexDirection: 'column', minHeight: 0 },
  ranking: { width: '54%', minWidth: 0, justifyContent: 'center' },
  rankingCompact: { width: '60%' },
  rankingStacked: { width: '100%' },
  row: { minHeight: 92, flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, paddingRight: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: homeTokens.stroke },
  rowCompact: { paddingRight: 2 },
  rank: { width: 36, paddingTop: 3, color: homeTokens.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  rankCompact: { width: 28, fontSize: 13 },
  tiedRank: { color: '#B47CFF' },
  rowCopy: { flex: 1, minWidth: 0 },
  name: { color: homeTokens.text, fontSize: 17, lineHeight: 22, fontWeight: '900', flexShrink: 1 },
  nameCompact: { fontSize: 14, lineHeight: 18 },
  valueLine: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 },
  valueLineCompact: { gap: 4 },
  value: { color: '#B47CFF', fontSize: 29, lineHeight: 34, fontWeight: '900', fontVariant: ['tabular-nums'] },
  valueCompact: { fontSize: 24, lineHeight: 30 },
  metricLabel: { flexShrink: 1, color: homeTokens.textSecondary, fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: 0.8 },
  metricLabelCompact: { fontSize: 8, letterSpacing: 0.3 },
  artStage: { flex: 1, minWidth: 0, justifyContent: 'flex-end', alignItems: 'center', overflow: 'hidden' },
  artStageStacked: { width: '100%', flex: 0 },
  artImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%', backgroundColor: 'transparent' },
  photoImage: { borderRadius: 24, borderWidth: 1, borderColor: 'rgba(176, 103, 255, 0.54)' },
  state: { minHeight: 184, alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 },
  stateTitle: { color: homeTokens.text, fontSize: 16, lineHeight: 22, fontWeight: '900', textAlign: 'center' },
  stateText: { color: homeTokens.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  retry: { minWidth: 90, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: homeTokens.strokeOpaque, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: homeTokens.text, fontSize: 12, fontWeight: '800' },
  staleNote: { color: homeTokens.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 6 },
  allStats: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingRight: 10, marginTop: 4 },
  allStatsText: { color: homeTokens.text, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  pressed: { opacity: 0.72 },
});
