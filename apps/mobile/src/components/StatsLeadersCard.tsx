import React from 'react';
import { ActivityIndicator, Image, type ImageSourcePropType, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';

import jackFooteArt from '../../assets/league-leaders/jack-foote.png';
import neutralGoalieArt from '../../assets/league-leaders/neutral-goalie.png';
import neutralHelmetArt from '../../assets/league-leaders/neutral-helmet-player.png';
import { resolveLeaderArtwork, type LeaderArtwork } from '../lib/homeLeagueLeaders';
import { loadPlayerArtworkManifest, type PlayerArtworkManifest } from '../lib/playerArtworkManifest';
import { fitLeagueLeaderNameLine, formatLeagueLeaderGaa, splitLeagueLeaderName } from '../lib/leaderPresentation';
import type { StatsLeaderMetric, StatsLeaderRow } from '../lib/statsPresentationModel';
import { FocusCard } from './CardFocus';
import { SECTION_HEADING_TEXT_STYLE } from './SectionHeader';
import TeamLogo from './TeamLogo';
import { SelectableControl, SelectableControlGroup } from './SelectableControl';

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
  width?: number;
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

export default function StatsLeadersCard({ leagueId, width = 390, headerControl, metric, leaders, status, onMetricChange, onRetry, onOpenPlayer }: Props) {
  const [manifest, setManifest] = React.useState<PlayerArtworkManifest | null>(null);
  React.useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    void loadPlayerArtworkManifest({ signal: controller.signal }).then((value) => { if (mounted) setManifest(value?.leagueId === leagueId ? value : null); });
    return () => { mounted = false; controller.abort(); };
  }, [leagueId]);
  const featured = leaders[0] ?? null;
  const artwork = featured ? resolveLeaderArtwork(leagueId, homeLeader(featured, metric), manifest) : null;
  const availableNameWidth = Math.max(96, Math.floor((width - 32) * 0.56 - 50));
  const surnameMinimumFontScale = 0.9 / Math.max(1, Math.min(PixelRatio.getFontScale(), 1.35));
  return (
    <FocusCard focusId={`stats:leaders:${leagueId}`} testID="stats-leaders-card" style={styles.card}>
      <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>League Leaders</Text>{headerControl}</View>
      <SelectableControlGroup role="tablist" accessibilityLabel="Leader metric" contentContainerStyle={styles.toggle}>
        {METRICS.map(({ key, label }) => <SelectableControl key={key} testID={`stats-leaders-tab-${key}`} role="tab" label={label} accessibilityLabel={`Show ${label} leaders`} selected={metric === key} onPress={() => onMetricChange(key)} style={styles.toggleButton} />)}
      </SelectableControlGroup>
      {status === 'loading' ? <View testID="stats-leaders-loading" style={styles.state}><ActivityIndicator color="#61E2E8" /><Text style={styles.stateText}>Loading leaders…</Text></View>
        : status === 'error' ? <View testID="stats-leaders-error" style={styles.state}><Text style={styles.stateText}>Leaders are temporarily unavailable.</Text><Pressable testID="stats-leaders-retry" accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View>
          : leaders.length === 0 ? <View testID="stats-leaders-empty" style={styles.state}><Text style={styles.stateText}>No eligible {metric.toUpperCase()} leaders are available.</Text></View>
            : <View style={styles.composition}>
              <View testID="stats-leaders-rows" style={styles.rows}>{leaders.map((row) => {
                const name = splitLeagueLeaderName(row.playerName);
                const rowDisplay = metric === 'gaa' && row.value.value !== null ? formatLeagueLeaderGaa(row.value.value) : row.display;
                const givenNameFit = fitLeagueLeaderNameLine(name.firstLine, { availableWidth: availableNameWidth, baseFontSize: 9, minimumFontSize: 8 });
                const surnameFit = fitLeagueLeaderNameLine(name.secondLine || '\u00A0', { availableWidth: availableNameWidth, baseFontSize: 11, minimumFontSize: 10 });
                return <Pressable key={row.playerId} testID={`stats-leader-row-${row.playerId}`} accessibilityRole="button" accessibilityLabel={`${row.rank}. ${name.fullName}, ${row.displayTeam?.name ?? 'unknown team'}, ${rowDisplay} ${metric}. Open player card.`} onPress={() => onOpenPlayer(row.playerId)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Text maxFontSizeMultiplier={1.35} style={[styles.rank, row.rank === 1 && styles.rankFirst]}>{String(row.rank).padStart(2, '0')}</Text>
                <TeamLogo teamId={row.displayTeam?.id} logoUrl={row.displayTeam?.logoUrl ?? null} teamName={row.displayTeam?.name ?? 'Unknown team'} size={24} transparentBacking decorative />
                <View style={styles.facts}>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.88} maxFontSizeMultiplier={1.35} style={[styles.givenName, givenNameFit]}>{name.firstLine}</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={surnameMinimumFontScale} maxFontSizeMultiplier={1.35} style={[styles.surname, surnameFit]}>{name.secondLine || '\u00A0'}</Text>
                  <View testID={`stats-leader-score-${row.playerId}`} style={styles.score}><Text maxFontSizeMultiplier={1.3} style={styles.value}>{rowDisplay}</Text><Text maxFontSizeMultiplier={1.35} style={styles.unit}>{metric === 'gaa' ? 'GAA' : metric === 'points' ? 'PTS' : metric === 'goals' ? 'G' : 'A'}</Text></View>
                </View>
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
  toggleButton: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 2 },
  composition: { height: 330, flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(125,190,255,0.18)' }, rows: { width: '56%', zIndex: 2, backgroundColor: 'rgba(4,15,27,0.34)' },
  row: { minHeight: 64, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(125,190,255,0.18)' },
  rank: { width: 18, color: '#7E94A6', fontSize: 9, fontWeight: '900', fontVariant: ['tabular-nums'] }, rankFirst: { color: '#61E2E8' },
  facts: { flex: 1, minWidth: 0 }, givenName: { color: '#AFC0CD', fontSize: 9, lineHeight: 12, fontWeight: '800' }, surname: { color: '#F2F7FB', fontSize: 11, lineHeight: 14, fontWeight: '900' }, score: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  value: { color: '#61E2E8', fontSize: 20, lineHeight: 22, fontWeight: '900', fontVariant: ['tabular-nums'] }, unit: { color: '#8299AA', fontSize: 6, lineHeight: 8, fontWeight: '900' },
  artStage: { position: 'absolute', zIndex: 1, right: 0, top: 0, bottom: 0, width: '44%', minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }, art: { position: 'absolute', right: -18, bottom: -5, width: '128%', height: '108%', backgroundColor: 'transparent', transform: [{ scale: 0.8 }] },
  state: { minHeight: 210, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 18 }, stateText: { color: '#A8B4C8', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  retry: { minHeight: 44, minWidth: 90, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(125,190,255,0.28)', borderRadius: 13 }, retryText: { color: '#61E2E8', fontSize: 12, fontWeight: '900' }, pressed: { opacity: 0.72 },
});
