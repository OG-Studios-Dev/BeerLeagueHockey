import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getCareerMetricDefinitions, lineChartGeometry } from '../../lib/playerPageModel';
import type { HockeyLifePlayerPage } from '../../lib/supabase/playerPage';
import colors from '../../theme/colors';

type Props = {
  rows: HockeyLifePlayerPage['careerRows'];
  isGoalie: boolean;
  accent: string;
  hotFacts: string[];
};

const WIDTH = 300;
const HEIGHT = 132;

export default function CareerTrendChart({ rows, isGoalie, accent, hotFacts }: Props) {
  const definitions = getCareerMetricDefinitions(isGoalie).filter((metric) => rows.some((row) => row.metrics[metric.key] != null));
  const [selectedKey, setSelectedKey] = React.useState(definitions[0]?.key ?? '');
  const [factIndex, setFactIndex] = React.useState(0);
  const [chartWidth, setChartWidth] = React.useState(WIDTH);
  const selected = definitions.find((metric) => metric.key === selectedKey) ?? definitions[0];
  React.useEffect(() => {
    if (!definitions.some((metric) => metric.key === selectedKey)) setSelectedKey(definitions[0]?.key ?? '');
  }, [definitions, selectedKey]);
  if (!selected) return null;

  const values = rows.map((row) => row.metrics[selected.key] ?? null);
  const geometry = lineChartGeometry(values, chartWidth, HEIGHT);
  const summary = `${selected.label}: ${rows.flatMap((row, index) => values[index] == null ? [] : [`${row.seasonName} ${values[index]}`]).join(', ')}`;

  return <View>
    <View style={styles.controls}>{definitions.map((metric) => {
      const active = metric.key === selected.key;
      return <Pressable key={metric.key} accessibilityRole="button" accessibilityLabel={`Show ${metric.label} career trend`} accessibilityState={{ selected: active }} onPress={() => setSelectedKey(metric.key)} style={[styles.control, active && { borderColor: accent, backgroundColor: `${accent}22` }]}><Text style={[styles.controlText, active && { color: accent }]}>{metric.label}</Text></Pressable>;
    })}</View>
    <View accessibilityRole="image" accessibilityLabel={summary} style={styles.chartFrame}>
      <View style={styles.chart} accessible={false} onLayout={(event) => setChartWidth(Math.min(WIDTH, event.nativeEvent.layout.width))}>
        {[0, 1, 2].map((line) => <View key={line} style={[styles.gridLine, { top: line * (HEIGHT / 2) }]} />)}
        {geometry.points.map((point) => <View key={`area-${point.index}`} style={[styles.areaColumn, { left: Math.max(0, point.x - 13), top: point.y, height: HEIGHT - point.y, backgroundColor: accent }]} />)}
        {geometry.points.slice(0, -1).map((point, index) => {
          const next = geometry.points[index + 1];
          const dx = next.x - point.x;
          const dy = next.y - point.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          return <View key={`line-${point.index}`} style={[styles.line, { left: point.x, top: point.y, width: length, backgroundColor: accent, transform: [{ rotateZ: `${Math.atan2(dy, dx)}rad` }] }]} />;
        })}
        {geometry.points.map((point) => <View key={`point-${point.index}`} style={[styles.point, { left: point.x - 5, top: point.y - 5, backgroundColor: accent }]} />)}
      </View>
      <View style={styles.labels}>{rows.map((row) => <Text key={`${row.seasonId}:${row.teamId ?? ''}`} numberOfLines={2} style={styles.axisLabel}>{row.seasonName}</Text>)}</View>
    </View>
    <Text style={styles.accessibleSummary}>{summary}</Text>
    {hotFacts.length ? <View style={styles.factCard}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous hot take" disabled={hotFacts.length < 2} onPress={() => setFactIndex((factIndex - 1 + hotFacts.length) % hotFacts.length)} style={styles.factButton}><Text style={styles.factArrow}>‹</Text></Pressable>
      <Text style={styles.fact}>{hotFacts[factIndex % hotFacts.length]}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next hot take" disabled={hotFacts.length < 2} onPress={() => setFactIndex((factIndex + 1) % hotFacts.length)} style={styles.factButton}><Text style={styles.factArrow}>›</Text></Pressable>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 },
  control: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.glassStrokeStrong, borderRadius: 999, paddingHorizontal: 13, backgroundColor: colors.bgSurface },
  controlText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  chartFrame: { borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 18, backgroundColor: colors.bgSurface, paddingHorizontal: 10, paddingTop: 20, overflow: 'hidden' },
  chart: { width: '100%', maxWidth: WIDTH, height: HEIGHT, alignSelf: 'center', position: 'relative' },
  gridLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.glassStrokeStrong },
  areaColumn: { position: 'absolute', width: 26, opacity: 0.1 },
  line: { position: 'absolute', height: 3, borderRadius: 2, transformOrigin: 'left center' },
  point: { position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.bgSurface },
  labels: { flexDirection: 'row', justifyContent: 'space-between', gap: 4, marginTop: 10, paddingBottom: 12 },
  axisLabel: { flex: 1, color: colors.textSecondary, fontSize: 9, lineHeight: 12, textAlign: 'center' },
  accessibleSummary: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 10 },
  factCard: { minHeight: 70, flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, marginTop: 12 },
  factButton: { width: 44, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  factArrow: { color: colors.textPrimary, fontSize: 27 },
  fact: { flex: 1, color: colors.textPrimary, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingVertical: 12 },
});
