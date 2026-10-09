import React from 'react';
import { ActivityIndicator, Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';

import jackFooteArt from '../../assets/league-leaders/jack-foote.png';
import neutralGoalieArt from '../../assets/league-leaders/neutral-goalie.png';
import neutralHelmetArt from '../../assets/league-leaders/neutral-helmet-player.png';
import { resolveLeaderArtwork, type LeaderArtwork } from '../lib/homeLeagueLeaders';
import { loadPlayerArtworkManifest, type PlayerArtworkManifest } from '../lib/playerArtworkManifest';
import type { StatsLeaderMetric, StatsLeaderRow } from '../lib/statsPresentationModel';
import { FocusCard } from './CardFocus';
import { SECTION_HEADING_TEXT_STYLE } from './SectionHeader';
import TeamLogo from './TeamLogo';

export type { StatsLeaderMetric } from '../lib/statsPresentationModel';
export type StatsLeaderStatus = 'loading' | 'ready' | 'error';

const METRICS: ReadonlyArray<{ key: StatsLeaderMetric; label: string }> = [
  { key: 'points', label: 'Points' },
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'gaa', label: 'GAA' },
];
const GENERATED_ART: Record<'jack-foote-v1', ImageSourcePropType> = { 'jack-foote-v1': jackFooteArt };
const NEUTRAL_ART: Record<'neutral-helmet-v1' | 'neutral-goalie-v1', ImageSourcePropType> = {
  'neutral-helmet-v1': neutralHelmetArt,
  'neutral-goalie-v1': neutralGoalieArt,
};

type Props = {
  leagueId: string;
  headerControl?: React.ReactNode;
  metric: StatsLeaderMetric;
  leaders: readonly StatsLeaderRow[];
  status: StatsLeaderStatus;
  onMetricChange: (metric: StatsLeaderMetric) => void;
  onRetry: () => void;
  onOpenPlayer: (playerId: string) => void;
};
type ArtworkStage = 'remote' | 'generated' | 'photo' | 'neutral';

function homeLeader(row: StatsLeaderRow, metric: StatsLeaderMetric) {
  return {
    player_id: row.playerId, player_name: row.playerName, avatar_url: row.avatarUrl,
    team_id: row.displayTeam?.id ?? null, team_name: row.displayTeam?.name ?? 'Unknown team',
    display_team_name: row.displayTeam?.name ?? null, display_team_logo_url: row.displayTeam?.logoUrl ?? null,
    position: null, goals: metric === 'goals' ? row.value.value : null,
    assists: metric === 'assists' ? row.value.value : null, points: metric === 'points' ? row.value.value : null,
    gaa: metric === 'gaa' ? row.value.value : null, is_goalie: metric === 'gaa', estimated: row.value.state === 'estimated',
  };
}

function artSource(artwork: LeaderArtwork, stage: ArtworkStage, goalie: boolean): ImageSourcePropType {
  if (stage === 'neutral') return NEUTRAL_ART[goalie ? 'neutral-goalie-v1' : 'neutral-helmet-v1'];
  if (stage === 'remote' && artwork.kind === 'remote') return { uri: artwork.uri, cache: 'force-cache' };
  if (stage === 'generated') return GENERATED_ART['jack-foote-v1'];
  if (artwork.kind === 'photo') return { uri: artwork.uri };
  if (artwork.kind === 'remote' || artwork.kind === 'generated') return { uri: artwork.fallbackUri };
  return NEUTRAL_ART[goalie ? 'neutral-goalie-v1' : 'neutral-helmet-v1'];
}

function nextStage(artwork: LeaderArtwork, stage: ArtworkStage): ArtworkStage {
  if (stage === 'remote') return artwork.kind === 'remote' && artwork.bundledFallback ? 'generated' : 'photo';
  if (stage === 'generated') return 'photo';
  return 'neutral';
}

function splitLeaderName(playerName: string) {
  const parts = playerName.trim().split(/\s+/).filter(Boolean);
  return { givenName: parts[0] ?? 'Unknown', surname: parts.slice(1).join(' ') };
}

function artworkAttemptKey(artwork: LeaderArtwork): string {
  if (artwork.kind === 'remote') return `${artwork.identityKey}:remote:${artwork.uri}:${artwork.bundledFallback ?? ''}:${artwork.fallbackUri}`;
  if (artwork.kind === 'generated') return `${artwork.identityKey}:generated:${artwork.artworkId}:${artwork.fallbackUri}`;
  if (artwork.kind === 'photo') return `${artwork.identityKey}:photo:${artwork.uri}`;
  return `${artwork.identityKey}:neutral:${artwork.artworkId}`;
}

function LeaderArt({ artwork, goalie }: { artwork: LeaderArtwork; goalie: boolean }) {
  const attemptKey = artworkAttemptKey(artwork);
  const attempt = React.useMemo(() => ({ key: attemptKey }), [attemptKey]);
  const activeAttempt = React.useRef(attempt);
  const [state, setState] = React.useState({ key: attemptKey, stage: artwork.kind as ArtworkStage });
  const current = state.key === attemptKey ? state : { key: attemptKey, stage: artwork.kind as ArtworkStage };
  React.useLayoutEffect(() => {
    activeAttempt.current = attempt;
    setState({ key: attemptKey, stage: artwork.kind as ArtworkStage });
  }, [attempt, attemptKey, artwork.kind]);
  const onError = () => setState((previous) => {
    if (activeAttempt.current !== attempt) return previous;
    return { key: attemptKey, stage: nextStage(artwork, previous.key === attemptKey ? previous.stage : artwork.kind) };
  });
  return <Image key={`${attemptKey}:${current.stage}`} testID="stats-leader-feature-art" alt={artwork.accessibilityLabel} source={artSource(artwork, current.stage, goalie)} accessibilityLabel={artwork.accessibilityLabel} resizeMode="contain" style={styles.art} onError={onError} />;
}

export default function StatsLeadersCard({ leagueId, headerControl, metric, leaders, status, onMetricChange, onRetry, onOpenPlayer }: Props) {
  const [manifest, setManifest] = React.useState<PlayerArtworkManifest | null>(null);
  React.useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    void loadPlayerArtworkManifest({ signal: controller.signal }).then((value) => { if (mounted) setManifest(value?.leagueId === leagueId ? value : null); });
    return () => { mounted = false; controller.abort(); };
  }, [leagueId]);
  const featured = leaders[0] ?? null;
  const artwork = featured ? resolveLeaderArtwork(leagueId, homeLeader(featured, metric), manifest) : null;
  return (
    <FocusCard focusId={`stats:leaders:${leagueId}`} testID="stats-leaders-card" style={styles.card}>
      <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>League Leaders</Text>{headerControl}</View>
      <View accessibilityRole="tablist" accessibilityLabel="Leader metric" style={styles.toggle}>
        {METRICS.map(({ key, label }) => <Pressable key={key} testID={`stats-leaders-tab-${key}`} accessibilityRole="tab" accessibilityLabel={`Show ${label} leaders`} accessibilityState={{ selected: metric === key }} aria-selected={metric === key} aria-pressed={metric === key} onPress={() => onMetricChange(key)} style={({ pressed }) => [styles.toggleButton, metric === key && styles.toggleSelected, pressed && styles.pressed]}><Text style={[styles.toggleText, metric === key && styles.toggleTextSelected]}>{label}</Text></Pressable>)}
      </View>
      {status === 'loading' ? <View testID="stats-leaders-loading" style={styles.state}><ActivityIndicator color="#61E2E8" /><Text style={styles.stateText}>Loading leaders…</Text></View>
        : status === 'error' ? <View testID="stats-leaders-error" style={styles.state}><Text style={styles.stateText}>Leaders are temporarily unavailable.</Text><Pressable testID="stats-leaders-retry" accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View>
          : leaders.length === 0 ? <View testID="stats-leaders-empty" style={styles.state}><Text style={styles.stateText}>No eligible {metric.toUpperCase()} leaders are available.</Text></View>
            : <View style={styles.composition}>
              <View style={styles.rows}>{leaders.map((row) => {
                const name = splitLeaderName(row.playerName);
                return <Pressable key={row.playerId} testID={`stats-leader-row-${row.playerId}`} accessibilityRole="button" accessibilityLabel={`${row.rank}. ${row.playerName}, ${row.displayTeam?.name ?? 'unknown team'}, ${row.display} ${metric}. Open player card.`} onPress={() => onOpenPlayer(row.playerId)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Text maxFontSizeMultiplier={1.35} style={[styles.rank, row.rank === 1 && styles.rankFirst]}>{String(row.rank).padStart(2, '0')}</Text>
                <TeamLogo teamId={row.displayTeam?.id} logoUrl={row.displayTeam?.logoUrl ?? null} teamName={row.displayTeam?.name ?? 'Unknown team'} size={24} transparentBacking decorative />
                <View style={styles.name}><Text numberOfLines={1} maxFontSizeMultiplier={1.35} style={styles.givenName}>{name.givenName}</Text><Text numberOfLines={1} maxFontSizeMultiplier={1.35} style={styles.surname}>{name.surname || ' '}</Text></View>
                <View style={styles.score}><Text maxFontSizeMultiplier={1.3} style={styles.value}>{row.display}</Text><Text maxFontSizeMultiplier={1.35} style={styles.unit}>{metric === 'gaa' ? 'GAA' : metric === 'points' ? 'PTS' : metric === 'goals' ? 'G' : 'A'}</Text></View>
              </Pressable>;
              })}</View>
              {featured && artwork ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${featured.playerName} player card`} onPress={() => onOpenPlayer(featured.playerId)} style={styles.artStage}><LeaderArt artwork={artwork} goalie={metric === 'gaa'} /></Pressable> : null}
            </View>}
    </FocusCard>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', overflow: 'hidden', marginBottom: 22, backgroundColor: 'transparent' },
  heading: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, title: { ...SECTION_HEADING_TEXT_STYLE, flex: 1, minWidth: 0, color: '#F7FBFF' },
  toggle: { flexDirection: 'row', padding: 3, gap: 2, marginBottom: 7, borderWidth: 1, borderColor: 'rgba(126,184,215,0.2)', borderRadius: 14, backgroundColor: 'rgba(4,14,25,0.72)' },
  toggleButton: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 2 }, toggleSelected: { backgroundColor: '#61DDE2' },
  toggleText: { color: '#92A7B8', fontSize: 11, fontWeight: '900' }, toggleTextSelected: { color: '#061923' },
  composition: { height: 330, flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(125,190,255,0.18)' }, rows: { width: '56%', zIndex: 2, backgroundColor: 'rgba(4,15,27,0.34)' },
  row: { minHeight: 64, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(125,190,255,0.18)' },
  rank: { width: 18, color: '#7E94A6', fontSize: 9, fontWeight: '900', fontVariant: ['tabular-nums'] }, rankFirst: { color: '#61E2E8' },
  name: { flex: 1, minWidth: 0 }, givenName: { color: '#AFC0CD', fontSize: 9, lineHeight: 12, fontWeight: '800' }, surname: { color: '#F2F7FB', fontSize: 11, lineHeight: 14, fontWeight: '900' }, score: { width: 34, alignItems: 'center' },
  value: { color: '#61E2E8', fontSize: 20, lineHeight: 22, fontWeight: '900', fontVariant: ['tabular-nums'] }, unit: { color: '#8299AA', fontSize: 6, lineHeight: 8, fontWeight: '900' },
  artStage: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }, art: { position: 'absolute', right: -18, bottom: -5, width: '128%', height: '108%', backgroundColor: 'transparent' },
  state: { minHeight: 210, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 18 }, stateText: { color: '#A8B4C8', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  retry: { minHeight: 44, minWidth: 90, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(125,190,255,0.28)', borderRadius: 13 }, retryText: { color: '#61E2E8', fontSize: 12, fontWeight: '900' }, pressed: { opacity: 0.72 },
});
