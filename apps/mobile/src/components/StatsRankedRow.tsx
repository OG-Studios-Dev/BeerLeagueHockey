import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { fitLeagueLeaderNameLine, splitLeagueLeaderLineLosslessly, splitLeagueLeaderName } from '../lib/leaderPresentation';
import { buildGoalieRows, buildSkaterRows, type StatsLeaderMetric, type StatsLeaderRow, type StatsTableColumn } from '../lib/statsPresentationModel';
import { getSurfacePalette } from '../theme/ui';
import Avatar from './Avatar';

const PRIMARY_COLUMN: Readonly<Record<StatsLeaderMetric, StatsTableColumn['key']>> = {
  goals: 'g', assists: 'a', points: 'pts', gaa: 'gaa',
};

function visibleMetrics(row: StatsLeaderRow, metric: StatsLeaderMetric, showChampionships: boolean) {
  const columns = metric === 'gaa' ? buildGoalieRows([row])[0].columns : buildSkaterRows([row])[0].columns;
  return columns.filter((column) => column.key !== 'ch' || showChampionships);
}

type Props = {
  row: StatsLeaderRow;
  metric: StatsLeaderMetric;
  showChampionships?: boolean;
  onOpenPlayer: (playerId: string) => void;
};

export default function StatsRankedRow({ row, metric, showChampionships = false, onOpenPlayer }: Props) {
  const { reduceTransparency } = useAccessibilityPreferences();
  const { fontScale } = useWindowDimensions();
  const surface = getSurfacePalette(reduceTransparency);
  const name = splitLeagueLeaderName(row.playerName);
  const [measuredNameWidth, setMeasuredNameWidth] = React.useState(0);
  const availableNameWidth = measuredNameWidth > 0 ? measuredNameWidth : 139;
  const effectiveFontScale = Math.max(1, fontScale || 1);
  const surname = name.secondLine || '\u00A0';
  const surnameLines = splitLeagueLeaderLineLosslessly(surname, {
    availableWidth: availableNameWidth,
    fontSize: 14 * effectiveFontScale,
  });
  const givenNameFit = fitLeagueLeaderNameLine(name.firstLine, {
    availableWidth: availableNameWidth / effectiveFontScale,
    baseFontSize: 11,
    minimumFontSize: 9.5,
  });
  const surnameFits = surnameLines.map((line) => fitLeagueLeaderNameLine(line, {
    availableWidth: availableNameWidth / effectiveFontScale,
    baseFontSize: 14,
    minimumFontSize: 9.5,
  }));
  const teamName = row.displayTeam?.name ?? 'unknown team';
  const columns = visibleMetrics(row, metric, showChampionships);
  const secondary = columns.filter((column) => column.key !== PRIMARY_COLUMN[metric]);
  const metricSummary = columns.map((column) => {
    const label = column.key === 'ch' ? 'Champs' : column.label;
    const value = column.key === PRIMARY_COLUMN[metric] ? row.display : column.display;
    return `${label} ${value === '—' ? 'unavailable' : value}`;
  }).join(', ');
  return (
    <Pressable
      testID={`stats-ranked-row-${row.playerId}`}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${row.rank}. ${name.fullName}, ${teamName}. ${metricSummary}. Open player card.`}
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
        <View
          testID={`stats-ranked-name-block-${row.playerId}`}
          style={styles.nameBlock}
          onLayout={(event) => {
            const nextWidth = Math.floor(event.nativeEvent.layout.width);
            if (nextWidth > 0 && Math.abs(nextWidth - measuredNameWidth) >= 1) setMeasuredNameWidth(nextWidth);
          }}
        >
          <Text
            testID={`stats-ranked-given-${row.playerId}`}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={Math.min(1, 9.5 / givenNameFit.fontSize)}
            maxFontSizeMultiplier={1.5}
            style={[styles.givenName, givenNameFit]}
          >
            {name.firstLine}
          </Text>
          {surnameLines.map((line, index) => (
            <Text
              key={`${index}:${line}`}
              testID={`stats-ranked-surname-${row.playerId}-${index}`}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={Math.min(1, 9.5 / surnameFits[index].fontSize)}
              maxFontSizeMultiplier={1.5}
              style={[styles.surname, surnameFits[index]]}
            >
              {line}
            </Text>
          ))}
        </View>
        <Text maxFontSizeMultiplier={1.5} style={styles.teamName}>{teamName}</Text>
        <View style={styles.secondaryStats}>
          {secondary.map((column) => <View key={column.key} testID={`stats-ranked-metric-${row.playerId}-${column.key}`} accessible accessibilityRole="text" accessibilityLabel={column.accessibilityLabel} style={styles.secondaryMetric}>
            <Text maxFontSizeMultiplier={1.5} style={styles.secondaryValue}>{column.display}</Text>
            <Text maxFontSizeMultiplier={1.5} style={styles.secondaryLabel}>{column.key === 'ch' ? 'Champs' : column.label}</Text>
          </View>)}
        </View>
      </View>
      <View testID={`stats-ranked-primary-${row.playerId}`} style={styles.statCol}>
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
  nameBlock: { minWidth: 0 },
  givenName: { color: '#AFC0CD', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  surname: { color: '#F2F7FB', fontSize: 14, lineHeight: 19, fontWeight: '900' },
  teamName: { color: '#8298AA', fontSize: 10, lineHeight: 15, fontWeight: '600' },
  secondaryStats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 2, marginTop: 2 },
  secondaryMetric: { minHeight: 20, flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  secondaryValue: { color: '#91A5B5', fontSize: 10, lineHeight: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  secondaryLabel: { color: '#8298AA', fontSize: 8, lineHeight: 12, fontWeight: '700' },
  statCol: { minWidth: 46, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  statValue: { color: '#61E2E8', fontSize: 21, lineHeight: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLabel: { color: '#8298AA', fontSize: 9, lineHeight: 12, fontWeight: '900' },
  pressed: { opacity: 0.7 },
});
