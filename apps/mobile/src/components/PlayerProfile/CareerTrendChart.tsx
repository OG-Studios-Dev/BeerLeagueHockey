import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';


import { getCareerMetricDefinitions, lineChartGeometry } from '../../lib/playerPageModel';
import type { HockeyLifePlayerPage } from '../../lib/supabase/playerPage';
import colors from '../../theme/colors';
import CarouselPager from '../CarouselPager';
import { SelectableControl, SelectableControlGroup } from '../SelectableControl';


type Props = {
  rows: HockeyLifePlayerPage['careerRows'];
  isGoalie: boolean;
  accent: string;
  hotFacts: string[];
};

const WIDTH = 300;
const HEIGHT = 132;
const Y_AXIS_WIDTH = 36;

function chartValueLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

export default function CareerTrendChart({ rows, isGoalie, accent, hotFacts }: Props) {

  const definitions = getCareerMetricDefinitions(isGoalie).filter((metric) => rows.some((row) => row.metrics[metric.key] != null));
  const [selectedKey, setSelectedKey] = React.useState(definitions[0]?.key ?? '');
  const [selectedPointIndex, setSelectedPointIndex] = React.useState<number | null>(null);
  const [factIndex, setFactIndex] = React.useState(0);
  const [chartWidth, setChartWidth] = React.useState(WIDTH - Y_AXIS_WIDTH);
  const selected = definitions.find((metric) => metric.key === selectedKey) ?? definitions[0];
  React.useEffect(() => {
    if (!definitions.some((metric) => metric.key === selectedKey)) setSelectedKey(definitions[0]?.key ?? '');
  }, [definitions, selectedKey]);
  if (!selected) return null;

  const values = rows.map((row) => row.metrics[selected.key] ?? null);
  const geometry = lineChartGeometry(values, chartWidth, HEIGHT);
  const summary = `${selected.label}: ${rows.flatMap((row, index) => values[index] == null ? [] : [`${row.seasonName} ${values[index]}`]).join(', ')}`;
  const yAxisValues = geometry.minimum == null || geometry.maximum == null
    ? []
    : [geometry.maximum, (geometry.maximum + geometry.minimum) / 2, geometry.minimum];
  const selectedPoint = geometry.points.find((point) => point.index === selectedPointIndex);
  const selectedRow = selectedPoint ? rows[selectedPoint.index] : null;

  return <View>
    <SelectableControlGroup role="radiogroup" accessibilityLabel="Career metric" contentContainerStyle={styles.controls}>{definitions.map((metric) => {
      const active = metric.key === selected.key;
      return <SelectableControl key={metric.key} role="radio" label={metric.label} accessibilityLabel={`Show ${metric.label} career trend`} selected={active} onPress={() => { setSelectedKey(metric.key); setSelectedPointIndex(null); }} style={styles.control} />;
    })}</SelectableControlGroup>
    <View style={styles.chartFrame}>
      <View accessible accessibilityRole="image" accessibilityLabel={summary}><Text style={styles.chartTitle}>{selected.label} by season</Text></View>
      <View style={styles.chartBody}>
        <View style={styles.yAxis}>{yAxisValues.map((value, index) => <Text key={`${value}:${index}`} testID={`career-chart-y-axis-${['maximum', 'midpoint', 'minimum'][index]}`} style={styles.yAxisLabel}>{chartValueLabel(value)}</Text>)}</View>
        <View style={styles.chart} onLayout={(event) => setChartWidth(Math.min(WIDTH - Y_AXIS_WIDTH, event.nativeEvent.layout.width))}>
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
          {geometry.points.map((point) => {
            const row = rows[point.index];
            const top = Math.min(Math.max(0, point.y - 22), HEIGHT - 44);
            return <Pressable
              key={`target-${point.index}`}
              testID={`career-chart-point-${row.seasonId}`}
              accessibilityRole="button"
              accessibilityLabel={`Show ${selected.label} for ${row.seasonName}`}
              accessibilityHint="Displays this value in the chart tooltip"
              accessibilityState={{ selected: selectedPointIndex === point.index }}
              onPress={() => setSelectedPointIndex(point.index)}
              style={[styles.dataTarget, { height: HEIGHT - top, left: Math.max(0, Math.min(point.x - 22, chartWidth - 44)), top }]}
            />;
          })}
          {selectedPoint && selectedRow ? <View
            testID="career-chart-tooltip"
            accessible
            accessibilityRole="summary"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${selected.label}, ${selectedRow.seasonName}: ${chartValueLabel(selectedPoint.value)}`}
            pointerEvents="none"
            style={[styles.tooltip, {
              borderColor: accent,
              left: Math.max(0, Math.min(selectedPoint.x - 50, chartWidth - 100)),
              top: Math.max(0, Math.min(selectedPoint.y < 34 ? selectedPoint.y + 14 : selectedPoint.y - 34, HEIGHT - 30)),
            }]}
          ><Text style={styles.tooltipText}>{selectedRow.seasonName}: {chartValueLabel(selectedPoint.value)}</Text></View> : null}
        </View>
      </View>
      <View style={styles.xAxis}><View style={styles.xAxisSpacer} /><View style={styles.labels}>{rows.map((row) => <Text key={`${row.seasonId}:${row.teamId ?? ''}`} numberOfLines={2} style={styles.axisLabel}>{row.seasonName}</Text>)}</View></View>
    </View>
    {hotFacts.length ? <View style={styles.factCard}>
      <Text style={styles.fact}>{hotFacts[factIndex % hotFacts.length]}</Text>
      <CarouselPager currentIndex={factIndex % hotFacts.length} pageCount={hotFacts.length} onPrevious={() => setFactIndex((factIndex - 1 + hotFacts.length) % hotFacts.length)} onNext={() => setFactIndex((factIndex + 1) % hotFacts.length)} previousLabel="Previous hot take" nextLabel="Next hot take" positionLabel="Hot Takes position" loop testID="career-hot-take" />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  controls: { marginBottom: 14 },
  control: { minWidth: 92 },
  chartFrame: { borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 18, backgroundColor: colors.bgSurface, paddingHorizontal: 10, paddingTop: 12, overflow: 'hidden' },
  chartTitle: { color: colors.textPrimary, fontSize: 12, lineHeight: 16, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  chartBody: { width: '100%', maxWidth: WIDTH, flexDirection: 'row', alignSelf: 'center' },
  yAxis: { width: Y_AXIS_WIDTH, height: HEIGHT, alignItems: 'flex-end', justifyContent: 'space-between', paddingRight: 8 },
  yAxisLabel: { color: colors.textSecondary, fontSize: 10, lineHeight: 12, fontWeight: '700' },
  chart: { flex: 1, height: HEIGHT, position: 'relative' },
  gridLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.glassStrokeStrong },
  areaColumn: { position: 'absolute', width: 26, opacity: 0.1 },
  line: { position: 'absolute', height: 3, borderRadius: 2, transformOrigin: 'left center' },
  point: { position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.bgSurface },
  dataTarget: { position: 'absolute', zIndex: 2, width: 44 },
  tooltip: { position: 'absolute', zIndex: 3, width: 100, minHeight: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, backgroundColor: colors.bgElevated, paddingHorizontal: 7, paddingVertical: 5 },
  tooltipText: { color: colors.textPrimary, fontSize: 10, lineHeight: 14, fontWeight: '800', textAlign: 'center' },
  xAxis: { width: '100%', maxWidth: WIDTH, flexDirection: 'row', alignSelf: 'center' },
  xAxisSpacer: { width: Y_AXIS_WIDTH },
  labels: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 4, marginTop: 10, paddingBottom: 12 },
  axisLabel: { flex: 1, color: colors.textSecondary, fontSize: 9, lineHeight: 12, textAlign: 'center' },
  factCard: { minHeight: 70, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, marginTop: 12 },
  fact: { flex: 1, color: colors.textPrimary, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingVertical: 12 },
});
