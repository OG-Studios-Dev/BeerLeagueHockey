import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { PositioningData, PositionMetric } from '../lib/leaguePages';
import { buildBumpChartSegment, POSITION_METRICS } from '../lib/leaguePagesModel';
import colors from '../theme/colors';
import TeamLogo from './TeamLogo';

const RANK_WIDTH = 36;
const COLUMN_WIDTH = 112;
const HEADER_HEIGHT = 54;
const ROW_HEIGHT = 64;
const CREST_SIZE = 40;
const TARGET_SIZE = 52;
const CHART_WIDTH = RANK_WIDTH + COLUMN_WIDTH * POSITION_METRICS.length;

function center(columnIndex: number, rank: number) {
  return { x: RANK_WIDTH + COLUMN_WIDTH * columnIndex + COLUMN_WIDTH / 2, y: HEADER_HEIGHT + (rank - 0.5) * ROW_HEIGHT };
}

function accessibilityLabel(team: PositioningData['teams'][number], metricKey: PositionMetric, metricLabel: string, totalTeams: number) {
  const metric = team.metrics[metricKey];
  const estimate = metricKey === 'commitment' ? ', estimated from confirmed attendance plus roster appearances' : '';
  return `${team.teamName}, rank ${metric.rank} of ${totalTeams} in ${metricLabel}, ${metric.valueLabel}${estimate}`;
}

export default function TeamPositioningChart({ positioning }: { positioning: PositioningData }) {
  const [selected, setSelected] = React.useState<{ teamId: string; metric: PositionMetric } | null>(null);
  const chartHeight = HEADER_HEIGHT + positioning.totalTeams * ROW_HEIGHT;
  const teams = [...positioning.teams].sort((left, right) => left.metrics.overall.rank - right.metrics.overall.rank);

  return (
    <View accessibilityRole="summary" accessibilityLabel="Team positioning connected crest chart across five measures" style={styles.viewport}>
      <ScrollView testID="team-positioning-chart-scroll" horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator contentContainerStyle={styles.scrollContent}>
        <View testID="team-positioning-chart" style={[styles.canvas, { height: chartHeight, width: CHART_WIDTH }]}>
          <View pointerEvents="none" style={[styles.headerRule, { top: HEADER_HEIGHT }]} />
          {POSITION_METRICS.map(({ key, label }, columnIndex) => (
            <React.Fragment key={key}>
              <View pointerEvents="none" style={[styles.axis, { left: RANK_WIDTH + columnIndex * COLUMN_WIDTH }]} />
              <Text style={[styles.header, { left: RANK_WIDTH + columnIndex * COLUMN_WIDTH }]}>{label}</Text>
            </React.Fragment>
          ))}
          <View pointerEvents="none" style={[styles.axis, { left: CHART_WIDTH - StyleSheet.hairlineWidth }]} />
          {Array.from({ length: positioning.totalTeams }, (_, index) => <Text key={`rank-${index + 1}`} style={[styles.rank, { top: center(0, index + 1).y - 9 }]}>{index + 1}</Text>)}
          <View pointerEvents="none" style={styles.lineLayer}>
            {teams.flatMap((team) => POSITION_METRICS.slice(0, -1).map((metric, columnIndex) => {
              const next = POSITION_METRICS[columnIndex + 1]!;
              const segment = buildBumpChartSegment(center(columnIndex, team.metrics[metric.key].rank), center(columnIndex + 1, team.metrics[next.key].rank));
              return <View key={`${team.teamId}-${metric.key}`} style={[styles.line, { backgroundColor: team.primaryColor, left: segment.center.x - segment.length / 2, opacity: !selected || selected.teamId === team.teamId ? 0.9 : 0.16, top: segment.center.y - 1.5, transform: [{ rotate: `${segment.angleRadians}rad` }], width: segment.length }]} />;
            }))}
          </View>
          {teams.flatMap((team) => POSITION_METRICS.map(({ key, label }, columnIndex) => {
            const point = center(columnIndex, team.metrics[key].rank);
            const active = selected?.teamId === team.teamId && selected.metric === key;
            return (
              <Pressable
                key={`${team.teamId}-${key}`}
                testID={`team-positioning-${team.teamId}-${key}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={accessibilityLabel(team, key, label, positioning.totalTeams)}
                onPress={() => setSelected(active ? null : { teamId: team.teamId, metric: key })}
                style={[styles.target, { borderColor: active ? colors.textInteractive : 'transparent', left: point.x - TARGET_SIZE / 2, opacity: selected && selected.teamId !== team.teamId ? 0.3 : 1, top: point.y - TARGET_SIZE / 2 }]}
              >
                <TeamLogo teamId={team.teamId} logoUrl={team.logoUrl} teamName={team.teamName} primaryColor={team.primaryColor} size={CREST_SIZE} transparentBacking />
              </Pressable>
            );
          }))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { width: '100%', overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface },
  scrollContent: { minWidth: CHART_WIDTH },
  canvas: { position: 'relative' },
  header: { position: 'absolute', top: 0, width: COLUMN_WIDTH, height: HEADER_HEIGHT, paddingHorizontal: 5, color: colors.textPrimary, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 0.8, textAlign: 'center', textAlignVertical: 'center', textTransform: 'uppercase' },
  headerRule: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.glassStroke },
  axis: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.glassStroke },
  rank: { position: 'absolute', left: 0, width: RANK_WIDTH - 4, height: 18, color: colors.textSecondary, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  lineLayer: { ...StyleSheet.absoluteFillObject },
  line: { position: 'absolute', height: 3, borderRadius: 2 },
  target: { position: 'absolute', width: TARGET_SIZE, height: TARGET_SIZE, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSurface },
});
