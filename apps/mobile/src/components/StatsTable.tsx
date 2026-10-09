import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import type { StatsTableColumn, StatsTableRow } from '../lib/statsPresentationModel';
import Avatar from './Avatar';
import TeamLogo from './TeamLogo';

export const STATS_TABLE_ROW_HEIGHT = 68;
const HEADER_HEIGHT = 46;
const MAX_FONT_SIZE_MULTIPLIER = 1.4;
const SKATER_COLUMNS = [
  { key: 'gp', label: 'GP' }, { key: 'g', label: 'G' }, { key: 'a', label: 'A' }, { key: 'pts', label: 'PTS' },
  { key: 'ch', label: 'CH' }, { key: 'gpg', label: 'GPG' }, { key: 'ppg', label: 'PPG' },
] as const;
const GOALIE_COLUMNS = [{ key: 'gp', label: 'GP' }, { key: 'ga', label: 'GA' }, { key: 'gaa', label: 'GAA' }, { key: 'ch', label: 'CH' }] as const;
const EXPANDED_GOALIE_METRIC_WIDTH = 144;

export type StatsHorizontalSync = { offset: number; revision: number; sourceId: string | null };

type SharedProps = {
  kind: 'skater' | 'goalie';
  syncId: string;
  horizontalSync: StatsHorizontalSync;
  onHorizontalOffset: (sourceId: string, offset: number) => void;
  expandedMetrics?: boolean;
};

export function getStatsTableLayout(kind: SharedProps['kind'], viewportWidth: number, expandedMetrics = false) {
  const contentWidth = Math.max(288, viewportWidth - 32);
  const identityWidth = kind === 'goalie'
    ? Math.min(180, Math.max(148, contentWidth * 0.47))
    : Math.min(220, Math.max(174, contentWidth * 0.6));
  const availableMetricsWidth = Math.max(0, contentWidth - identityWidth);
  const metricCellWidth = kind === 'goalie'
    ? expandedMetrics ? EXPANDED_GOALIE_METRIC_WIDTH : availableMetricsWidth / GOALIE_COLUMNS.length
    : 56;
  const columns = kind === 'goalie' ? GOALIE_COLUMNS : SKATER_COLUMNS;
  return {
    contentWidth,
    identityWidth,
    availableMetricsWidth,
    metricCellWidth,
    metricPaneWidth: kind === 'goalie' && !expandedMetrics ? availableMetricsWidth : metricCellWidth * columns.length,
    columns,
  };
}

export function needsExpandedGoalieMetrics(rows: readonly Pick<StatsTableRow, 'columns'>[]): boolean {
  return rows.some((row) => row.columns.some((column) => column.display.length > 6 || column.state === 'conflicted'));
}

function useTableLayout(kind: SharedProps['kind'], expandedMetrics = false) {
  const { width: viewportWidth } = useWindowDimensions();
  return getStatsTableLayout(kind, viewportWidth, expandedMetrics);
}

function eventTimestamp(event: NativeSyntheticEvent<NativeScrollEvent>): number {
  const timestamp = event.timeStamp ?? (event.nativeEvent as NativeScrollEvent & { timestamp?: number }).timestamp;
  return typeof timestamp === 'number' ? timestamp : Date.now();
}

function SyncedMetrics({ children, kind, syncId, horizontalSync, onHorizontalOffset, expandedMetrics = false, width, style }: SharedProps & { children: React.ReactNode; width: number; style?: object }) {
  const ref = React.useRef<ScrollView>(null);
  const nativeOffset = React.useRef(0);
  const generationToken = React.useMemo(() => ({ kind, revision: horizontalSync.revision }), [kind, horizontalSync.revision]);
  const latestSync = React.useRef(horizontalSync);
  const latestIdentity = React.useRef({ kind, token: generationToken });
  const ownership = React.useRef<{ token: object; startedAt: number } | null>(null);
  const pendingPublication = React.useRef<{ token: object; kind: SharedProps['kind']; offset: number } | null>(null);
  const lastPublishedOffset = React.useRef(horizontalSync.offset);
  const scrollEnabled = kind === 'skater' || expandedMetrics;
  React.useLayoutEffect(() => {
    const previousToken = latestIdentity.current.token;
    const previousOwnership = ownership.current;
    const pending = pendingPublication.current;
    const continuesOwnedGesture = latestIdentity.current.kind === kind
      && previousOwnership?.token === previousToken
      && pending?.token === previousToken
      && pending.kind === kind
      && horizontalSync.sourceId === syncId
      && Math.abs(horizontalSync.offset - pending.offset) < 0.5;
    latestSync.current = horizontalSync;
    latestIdentity.current = { kind, token: generationToken };
    ownership.current = continuesOwnedGesture
      ? { token: generationToken, startedAt: previousOwnership.startedAt }
      : null;
    pendingPublication.current = null;
  }, [generationToken, horizontalSync, kind, syncId]);
  React.useEffect(() => {
    lastPublishedOffset.current = horizontalSync.offset;
    if (!scrollEnabled || Math.abs(nativeOffset.current - horizontalSync.offset) < 0.5) return;
    nativeOffset.current = horizontalSync.offset;
    ref.current?.scrollTo({ x: horizontalSync.offset, animated: false });
  }, [horizontalSync.offset, horizontalSync.revision, scrollEnabled]);
  const restoreLatest = () => {
    const latestOffset = latestSync.current.offset;
    if (Math.abs(nativeOffset.current - latestOffset) < 0.5) return;
    nativeOffset.current = latestOffset;
    ref.current?.scrollTo({ x: latestOffset, animated: false });
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!scrollEnabled) return;
    const nextOffset = event.nativeEvent.contentOffset.x;
    nativeOffset.current = nextOffset;
    const currentOwnership = ownership.current;
    if (currentOwnership?.token !== generationToken || eventTimestamp(event) < currentOwnership.startedAt) {
      restoreLatest();
      return;
    }
    if (Math.abs(nextOffset - lastPublishedOffset.current) < 0.5) return;
    lastPublishedOffset.current = nextOffset;
    pendingPublication.current = { token: generationToken, kind, offset: nextOffset };
    onHorizontalOffset(syncId, nextOffset);
  };
  const onScrollBeginDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    nativeOffset.current = event.nativeEvent.contentOffset.x;
    if (latestIdentity.current.token !== generationToken) {
      restoreLatest();
      return;
    }
    ownership.current = { token: generationToken, startedAt: eventTimestamp(event) };
    pendingPublication.current = null;
    lastPublishedOffset.current = event.nativeEvent.contentOffset.x;
  };
  const onScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => { onScroll(event); ownership.current = null; pendingPublication.current = null; };
  const onMomentumScrollBegin = () => {
    if (latestIdentity.current.token !== generationToken) {
      restoreLatest();
      return;
    }
    const startedAt = ownership.current?.startedAt ?? Number.NEGATIVE_INFINITY;
    ownership.current = { token: generationToken, startedAt };
  };
  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => { onScroll(event); ownership.current = null; pendingPublication.current = null; };
  return <ScrollView
    ref={ref}
    testID={`${syncId}-metrics-scroll`}
    horizontal
    scrollEnabled={scrollEnabled}
    bounces={false}
    directionalLockEnabled
    nestedScrollEnabled
    showsHorizontalScrollIndicator={false}
    scrollEventThrottle={16}
    onScroll={onScroll}
    onScrollBeginDrag={onScrollBeginDrag}
    onScrollEndDrag={onScrollEndDrag}
    onMomentumScrollBegin={onMomentumScrollBegin}
    onMomentumScrollEnd={onMomentumScrollEnd}
    style={styles.metricScroll}
    contentContainerStyle={[{ width }, style]}
  >{children}</ScrollView>;
}

export function StatsTableHeader(props: SharedProps) {
  const { identityWidth, metricCellWidth, metricPaneWidth, columns } = useTableLayout(props.kind, props.expandedMetrics);
  const kindLabel = props.kind === 'goalie' ? 'Goalie' : 'Skater';
  return <View
    accessible
    accessibilityRole="summary"
    accessibilityLabel={`${kindLabel} statistics table. Columns: rank, player, team, ${columns.map((column) => column.label).join(', ')}.`}
    accessibilityHint={props.kind === 'skater' || props.expandedMetrics ? 'Swipe the metrics area left and right to review every statistic.' : 'All goalie metrics are visible.'}
    style={[styles.tableHeader, styles.transparent, styles.horizontalOverflow]}
  >
    <View importantForAccessibility="no-hide-descendants" style={[styles.identityHeader, { width: identityWidth }]}><Text maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER} style={styles.rankHead}>#</Text><View style={styles.avatarHead} /><Text maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER} style={styles.nameHead}>Name</Text><Text maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER} style={styles.teamHead}>Team</Text></View>
    <SyncedMetrics {...props} width={metricPaneWidth} style={props.kind === 'goalie' ? styles.goalieMetrics : styles.skaterMetrics}>
      <View importantForAccessibility="no-hide-descendants" style={[styles.metricRow, styles.metricHeader, { width: metricPaneWidth }]}>{columns.map((column) => <Text key={column.key} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER} style={[styles.metricHead, { width: metricCellWidth }]}>{column.label}</Text>)}</View>
    </SyncedMetrics>
  </View>;
}

export function StatsTableRowView({ row, last, onOpenPlayer, ...props }: SharedProps & { row: StatsTableRow; last: boolean; onOpenPlayer: (playerId: string) => void }) {
  const { identityWidth, metricCellWidth, metricPaneWidth } = useTableLayout(props.kind, props.expandedMetrics);
  return <View testID={`stats-table-row-${row.playerId}`} style={[styles.tableRow, last && styles.tableRowLast, styles.transparent, styles.horizontalOverflow]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Rank ${row.rank}. ${row.playerName}, ${row.displayTeam?.name ?? 'unknown team'}. Open player card.`} onPress={() => onOpenPlayer(row.playerId)} style={({ pressed }) => [styles.identityRow, { width: identityWidth }, last && styles.identityLast, pressed && styles.pressed]}>
      <Text maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER} style={[styles.rank, row.rank === 1 && styles.rankFirst]}>{row.rank}</Text>
      <Avatar uri={row.avatarUrl} name={row.playerName} size={30} />
      <View style={styles.playerName}><Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER} style={styles.givenName}>{row.name.givenName}</Text><Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER} style={styles.surname}>{row.name.surname || ' '}</Text></View>
      <TeamLogo teamId={row.displayTeam?.id} logoUrl={row.displayTeam?.logoUrl ?? null} teamName={row.displayTeam?.name ?? 'Unknown team'} size={24} transparentBacking decorative />
    </Pressable>
    <SyncedMetrics {...props} width={metricPaneWidth} style={props.kind === 'goalie' ? styles.goalieMetrics : styles.skaterMetrics}>
      <View style={[styles.metricRow, { width: metricPaneWidth }]}>{row.columns.map((column: StatsTableColumn) => <Text
        key={column.key}
        testID={`stats-metric-${row.playerId}-${column.key}`}
        accessible
        accessibilityRole="text"
        accessibilityLabel={column.accessibilityLabel}
        maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.metricValue, column.key === 'pts' || column.key === 'gaa' ? styles.metricEmphasis : null, column.state === 'unknown' || column.state === 'conflicted' ? styles.metricUnknown : null, column.state === 'estimated' ? styles.metricEstimated : null, { width: metricCellWidth }]}
      >{column.state === 'conflicted' ? 'Review' : column.display}</Text>)}</View>
    </SyncedMetrics>
  </View>;
}

const styles = StyleSheet.create({
  tableHeader: { width: '100%', minHeight: HEADER_HEIGHT, flexDirection: 'row', borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(125,190,255,0.3)', borderTopLeftRadius: 15, borderTopRightRadius: 15, backgroundColor: 'rgba(4,13,24,0.16)' },
  tableRow: { width: '100%', minHeight: STATS_TABLE_ROW_HEIGHT, flexDirection: 'row', alignItems: 'stretch', borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(125,190,255,0.26)', backgroundColor: 'rgba(4,13,24,0.12)' },
  tableRowLast: { borderBottomWidth: 1, borderBottomLeftRadius: 15, borderBottomRightRadius: 15 }, transparent: { backgroundColor: 'rgba(4,13,24,0.12)' }, horizontalOverflow: { overflow: 'hidden' },
  identityHeader: { minHeight: HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, gap: 4, borderRightWidth: 1, borderRightColor: 'rgba(125,190,255,0.26)', borderBottomWidth: 1, borderBottomColor: 'rgba(125,190,255,0.27)', backgroundColor: 'rgba(7,20,33,0.5)' },
  identityRow: { minHeight: STATS_TABLE_ROW_HEIGHT, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 7, gap: 4, borderRightWidth: 1, borderRightColor: 'rgba(125,190,255,0.24)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(125,190,255,0.16)', backgroundColor: 'rgba(7,17,31,0.2)' }, identityLast: { borderBottomLeftRadius: 14 },
  rankHead: { width: 20, color: '#92A8B9', fontSize: 8, lineHeight: 11, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' }, avatarHead: { width: 30 }, nameHead: { flex: 1, color: '#92A8B9', fontSize: 8, lineHeight: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 }, teamHead: { width: 24, color: '#92A8B9', fontSize: 8, lineHeight: 11, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' },
  rank: { width: 20, color: '#90A5B5', fontSize: 10, lineHeight: 14, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'] }, rankFirst: { color: '#61E2E8' }, playerName: { flex: 1, minWidth: 0, paddingLeft: 2 }, givenName: { color: '#B6C7D2', fontSize: 9, lineHeight: 13, fontWeight: '800' }, surname: { color: '#F2F7FB', fontSize: 11, lineHeight: 15, fontWeight: '900' },
  metricScroll: { flex: 1, minWidth: 0, alignSelf: 'stretch' }, skaterMetrics: { backgroundColor: 'transparent' }, goalieMetrics: { flex: 1, backgroundColor: 'transparent' }, metricRow: { minHeight: STATS_TABLE_ROW_HEIGHT, flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(125,190,255,0.16)' }, metricHeader: { minHeight: HEADER_HEIGHT, borderBottomWidth: 1, borderBottomColor: 'rgba(125,190,255,0.27)', backgroundColor: 'rgba(7,20,33,0.5)' },
  metricHead: { minHeight: HEADER_HEIGHT, paddingHorizontal: 2, textAlign: 'center', textAlignVertical: 'center', color: '#92A8B9', fontSize: 8, lineHeight: HEADER_HEIGHT, fontWeight: '900', letterSpacing: 0.35 }, metricValue: { minHeight: STATS_TABLE_ROW_HEIGHT, paddingHorizontal: 2, paddingVertical: 6, textAlign: 'center', textAlignVertical: 'center', color: '#DCE9F2', fontSize: 10, lineHeight: 14, fontWeight: '800', fontVariant: ['tabular-nums'], borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(125,190,255,0.08)' }, metricEmphasis: { color: '#61E2E8', fontWeight: '900' }, metricUnknown: { color: '#8298AA' }, metricEstimated: { color: '#E8C779' }, pressed: { opacity: 0.7 },
});
