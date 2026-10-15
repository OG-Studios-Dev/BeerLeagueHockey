import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { splitLeagueLeaderName } from '../lib/leaderPresentation';
import type { StatsLeaderMetric, StatsLeaderRow } from '../lib/statsPresentationModel';
import { formatPublicMetric } from '../lib/supabase/publicStats';
import { getSurfacePalette } from '../theme/ui';
import Avatar from './Avatar';

const METRIC_LABELS: Record<StatsLeaderMetric, string> = {
  goals: 'goals',
  assists: 'assists',
  points: 'points',
  gaa: 'GAA',
};

function secondaryMetrics(row: StatsLeaderRow, metric: StatsLeaderMetric) {
  if (metric === 'gaa') {
    const stats = row.goalie!;
    return [
      { key: 'gp', value: formatPublicMetric(stats.gamesPlayed).value, label: 'GP' },
      { key: 'ga', value: formatPublicMetric(stats.goalsAgainst).value, label: 'GA' },
    ];
  }
  const stats = row.skater!;
  return [
    { key: 'goals', value: formatPublicMetric(stats.goals).value, label: 'G' },
    { key: 'assists', value: formatPublicMetric(stats.assists).value, label: 'A' },
    { key: 'points', value: formatPublicMetric(stats.points).value, label: 'P' },
  ].filter((item) => item.key !== metric);
}

type Props = {
  row: StatsLeaderRow;
  metric: StatsLeaderMetric;
  onOpenPlayer: (playerId: string) => void;
};

export default function StatsRankedRow({ row, metric, onOpenPlayer }: Props) {
  const { reduceTransparency } = useAccessibilityPreferences();
  const surface = getSurfacePalette(reduceTransparency);
  const name = splitLeagueLeaderName(row.playerName);
  const teamName = row.displayTeam?.name ?? 'unknown team';
  const gamesPlayed = metric === 'gaa' ? row.goalie!.gamesPlayed : row.skater!.gamesPlayed;
  const secondary = secondaryMetrics(row, metric);
  return (
    <Pressable
      testID={`stats-ranked-row-${row.playerId}`}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${row.rank}. ${name.fullName}, ${teamName}, ${row.display} ${METRIC_LABELS[metric]}. Open player card.`}
      onPress={() => onOpenPlayer(row.playerId)}
      style={({ pressed }) => [
        styles.row,
        row.rank <= 3 && styles.topThree,
        reduceTransparency && { backgroundColor: row.rank <= 3 ? '#292513' : surface.surface, borderColor: surface.stroke },
        pressed && styles.pressed,
        pressed && reduceTransparency && { opacity: 1, backgroundColor: row.rank <= 3 ? '#3B3217' : surface.interactive, borderColor: '#61E2E8' },
      ]}
    >
      <Text maxFontSizeMultiplier={1.5} style={[styles.rank, row.rank <= 3 && styles.rankTop]}>{row.rank}</Text>
      <Avatar uri={row.avatarUrl} name={row.playerName} size={36} />
      <View style={styles.playerInfo}>
        <Text maxFontSizeMultiplier={1.5} style={styles.givenName}>{name.firstLine}</Text>
        <Text maxFontSizeMultiplier={1.5} style={styles.surname}>{name.secondLine || ' '}</Text>
        <Text maxFontSizeMultiplier={1.5} style={styles.teamName}>{teamName} · {formatPublicMetric(gamesPlayed).value} GP</Text>
        <View style={styles.secondaryStats}>
          {secondary.map((item) => <Text key={item.key} maxFontSizeMultiplier={1.5} style={styles.secondaryStat}>{item.value}{item.label}</Text>)}
        </View>
      </View>
      <View style={styles.statCol}>
        <Text testID={`stats-ranked-value-${row.playerId}`} maxFontSizeMultiplier={1.5} style={styles.statValue}>{row.display}</Text>
        <Text maxFontSizeMultiplier={1.5} style={styles.statLabel}>{metric === 'gaa' ? 'GAA' : metric === 'points' ? 'PTS' : metric === 'goals' ? 'G' : 'A'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(125,190,255,0.22)',
    borderRadius: 12,
    backgroundColor: 'rgba(4,13,24,0.12)',
  },
  topThree: { backgroundColor: 'rgba(212,175,55,0.06)' },
  rank: { width: 24, flexShrink: 0, color: '#8FA4B5', fontSize: 15, lineHeight: 20, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'] },
  rankTop: { color: '#D4AF37' },
  playerInfo: { flex: 1, minWidth: 0, paddingVertical: 1 },
  givenName: { color: '#AFC0CD', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  surname: { color: '#F2F7FB', fontSize: 14, lineHeight: 19, fontWeight: '900' },
  teamName: { color: '#8298AA', fontSize: 10, lineHeight: 15, fontWeight: '600' },
  secondaryStats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 2, marginTop: 2 },
  secondaryStat: { color: '#91A5B5', fontSize: 10, lineHeight: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statCol: { minWidth: 46, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  statValue: { color: '#61E2E8', fontSize: 21, lineHeight: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLabel: { color: '#8298AA', fontSize: 9, lineHeight: 12, fontWeight: '900' },
  pressed: { opacity: 0.7 },
});
