import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import TeamLogo from '../../components/TeamLogo';
import type { PositioningData, PositionMetric } from '../../lib/leaguePages';
import { buildBumpChartSegment, buildTeamsDirectoryView, POSITION_METRICS, positioningNarrative } from '../../lib/leaguePagesModel';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { commonStyles, DivisionPicker, LeaguePageFrame, PageHeader, PageLoadState, SeasonPicker, useLeaguePage, useLeaguePageScope } from './LeaguePageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'TeamsDirectory'>;

const CHART_RANK_WIDTH = 36;
const CHART_COLUMN_WIDTH = 112;
const CHART_HEADER_HEIGHT = 54;
const CHART_ROW_HEIGHT = 64;
const CHART_CREST_SIZE = 40;
const CHART_TARGET_SIZE = 52;
const CHART_WIDTH = CHART_RANK_WIDTH + CHART_COLUMN_WIDTH * POSITION_METRICS.length;

function metricCenter(columnIndex: number, rank: number) {
  return {
    x: CHART_RANK_WIDTH + CHART_COLUMN_WIDTH * columnIndex + CHART_COLUMN_WIDTH / 2,
    y: CHART_HEADER_HEIGHT + (rank - 0.5) * CHART_ROW_HEIGHT,
  };
}

function metricAccessibilityLabel(team: PositioningData['teams'][number], metricKey: PositionMetric, metricLabel: string, totalTeams: number) {
  const metric = team.metrics[metricKey];
  const estimate = metricKey === 'commitment' ? ', estimated from confirmed attendance plus roster appearances' : '';
  return `${team.teamName}, rank ${metric.rank} of ${totalTeams} in ${metricLabel}, ${metric.valueLabel}${estimate}`;
}

function TeamPositioningChart({
  positioning,
  selected,
  onSelect,
}: {
  positioning: PositioningData;
  selected: { teamId: string; metric: PositionMetric } | null;
  onSelect: (selection: { teamId: string; metric: PositionMetric } | null) => void;
}) {
  const chartHeight = CHART_HEADER_HEIGHT + positioning.totalTeams * CHART_ROW_HEIGHT;
  const teams = [...positioning.teams].sort((left, right) => left.metrics.overall.rank - right.metrics.overall.rank);

  return (
    <View accessibilityRole="summary" accessibilityLabel="Team positioning connected crest chart across five measures. Swipe horizontally to review every measure." style={styles.chartViewport}>
      <ScrollView
        testID="team-positioning-chart-scroll"
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.chartScrollContent}
      >
        <View testID="team-positioning-chart" style={[styles.chartCanvas, { height: chartHeight, width: CHART_WIDTH }]}>
          <View pointerEvents="none" style={[styles.chartHeaderRule, { top: CHART_HEADER_HEIGHT }]} />
          {POSITION_METRICS.map(({ key, label }, columnIndex) => (
            <React.Fragment key={key}>
              <View pointerEvents="none" style={[styles.chartAxis, { left: CHART_RANK_WIDTH + columnIndex * CHART_COLUMN_WIDTH }]} />
              <Text style={[styles.chartHeader, { left: CHART_RANK_WIDTH + columnIndex * CHART_COLUMN_WIDTH }]}>{label}</Text>
            </React.Fragment>
          ))}
          <View pointerEvents="none" style={[styles.chartAxis, { left: CHART_WIDTH - StyleSheet.hairlineWidth }]} />
          {Array.from({ length: positioning.totalTeams }, (_, index) => (
            <Text key={`rank-${index + 1}`} style={[styles.chartRankLabel, { top: metricCenter(0, index + 1).y - 9 }]}>{index + 1}</Text>
          ))}

          <View pointerEvents="none" style={styles.chartLineLayer}>
            {teams.flatMap((team) => POSITION_METRICS.slice(0, -1).map((metric, columnIndex) => {
              const nextMetric = POSITION_METRICS[columnIndex + 1]!;
              const segment = buildBumpChartSegment(
                metricCenter(columnIndex, team.metrics[metric.key].rank),
                metricCenter(columnIndex + 1, team.metrics[nextMetric.key].rank),
              );
              const isSelectedTeam = !selected || selected.teamId === team.teamId;
              return (
                <View
                  key={`${team.teamId}-${metric.key}-${nextMetric.key}`}
                  style={[
                    styles.chartLine,
                    {
                      backgroundColor: team.primaryColor,
                      left: segment.center.x - segment.length / 2,
                      opacity: isSelectedTeam ? 0.9 : 0.16,
                      top: segment.center.y - 1.5,
                      transform: [{ rotate: `${segment.angleRadians}rad` }],
                      width: segment.length,
                    },
                  ]}
                />
              );
            }))}
          </View>

          {teams.flatMap((team) => POSITION_METRICS.map(({ key, label }, columnIndex) => {
            const center = metricCenter(columnIndex, team.metrics[key].rank);
            const isSelected = selected?.teamId === team.teamId && selected.metric === key;
            const isDimmed = Boolean(selected && selected.teamId !== team.teamId);
            return (
              <Pressable
                key={`${team.teamId}-${key}`}
                testID={`team-positioning-${team.teamId}-${key}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={metricAccessibilityLabel(team, key, label, positioning.totalTeams)}
                accessibilityHint="Select to show this value below the chart."
                onPress={() => onSelect(isSelected ? null : { teamId: team.teamId, metric: key })}
                style={[
                  styles.chartTarget,
                  {
                    borderColor: isSelected ? colors.textInteractive : 'transparent',
                    left: center.x - CHART_TARGET_SIZE / 2,
                    opacity: isDimmed ? 0.3 : 1,
                    top: center.y - CHART_TARGET_SIZE / 2,
                  },
                ]}
              >
                <TeamLogo teamId={team.teamId} logoUrl={team.logoUrl} teamName={team.teamName} primaryColor={team.primaryColor} size={CHART_CREST_SIZE} transparentBacking />
              </Pressable>
            );
          }))}
        </View>
      </ScrollView>
    </View>
  );
}

export default function TeamsDirectoryScreen({ route, navigation }: Props) {
  const { width } = useWindowDimensions();
  const scope = useLeaguePageScope(route.params);
  const page = useLeaguePage(scope, 'teams');
  const [divisionId, setDivisionId] = React.useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = React.useState<{ teamId: string; metric: (typeof POSITION_METRICS)[number]['key'] } | null>(null);
  React.useEffect(() => { setDivisionId(null); setSelectedMetric(null); }, [scope.leagueId, page.data?.selectedSeason?.id]);

  if (!page.data) return <LeaguePageFrame><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;
  const data = page.data;
  if (!data.selectedSeason) return <LeaguePageFrame><PageHeader eyebrow="League directory" title="Teams" detail={data.league.name} /><SeasonPicker seasons={data.seasons} selected={null} onSelect={page.selectSeason} /><PageLoadState loading={false} error={null} noSeason retry={page.retry} /></LeaguePageFrame>;
  const view = buildTeamsDirectoryView(data, divisionId, page.defaultSeasonId);
  const historical = data.selectedSeason.id !== page.defaultSeasonId;
  const cardWidth = width < 360 ? '100%' : '48%';
  const selectedTeam = selectedMetric ? view.positioning?.teams.find((team) => team.teamId === selectedMetric.teamId) : null;

  return (
    <LeaguePageFrame>
      <PageHeader eyebrow="League directory" title="Teams" detail={`${view.count} team${view.count === 1 ? '' : 's'} — ${data.selectedSeason.name}`} />
      <SeasonPicker seasons={data.seasons} selected={data.selectedSeason.id} onSelect={page.selectSeason} />
      <DivisionPicker divisions={data.divisions} selected={divisionId} onSelect={setDivisionId} />
      {view.count === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyTitle}>No teams yet</Text><Text style={styles.muted}>Teams will appear here once this season’s directory is published.</Text></View>
      ) : view.groups.map((group) => (
        <View key={group.id ?? group.name} style={commonStyles.section}>
          <Text style={commonStyles.sectionTitle}>{group.name}</Text>
          <View style={styles.grid}>
            {group.teams.map((team) => (
              <Pressable
                key={team.id}
                accessibilityRole="button"
                accessibilityLabel={`${team.name}, ${team.divisionName ?? 'Unassigned'}, ${historical ? 'View Current Roster' : 'View Roster'}`}
                onPress={() => navigation.navigate('LeagueTeamDetail', { teamId: team.id, leagueId: data.league.id })}
                style={[commonStyles.card, styles.teamCard, { width: cardWidth }]}
              >
                <TeamLogo teamId={team.id} logoUrl={team.logoUrl} teamName={team.name} primaryColor={team.primaryColor} size={78} transparentBacking />
                <Text style={styles.teamName}>{team.name}</Text>
                <Text style={styles.muted}>{team.divisionName ?? 'Unassigned'}</Text>
                <Text style={styles.link}>{historical ? 'View Current Roster' : 'View Roster'} ›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      {view.positioning ? (
        <View style={commonStyles.section}>
          <Text style={commonStyles.sectionTitle}>Team Positioning</Text>
          <Text style={commonStyles.sectionDetail}>Compare each team across five current-season measures. The chart scrolls horizontally; tap a crest for its recorded value.</Text>
          <TeamPositioningChart positioning={view.positioning} selected={selectedMetric} onSelect={setSelectedMetric} />
          <Text style={styles.estimate}>Commitment: Estimated from confirmed attendance plus roster appearances.</Text>
          {selectedTeam && selectedMetric ? <Text accessibilityLiveRegion="polite" style={styles.narrative}>{positioningNarrative(selectedTeam, selectedMetric.metric, view.positioning.totalTeams)}</Text> : null}
        </View>
      ) : historical ? <Text style={styles.historicalNote}>Team Positioning is available only for the current/default season.</Text> : null}
    </LeaguePageFrame>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  teamCard: { minHeight: 190, alignItems: 'center', justifyContent: 'center' },
  teamName: { color: colors.textPrimary, fontSize: 17, lineHeight: 22, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  muted: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  link: { color: colors.textInteractive, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  empty: { minHeight: 220, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: colors.textPrimary, fontWeight: '900', fontSize: 19 },
  chartViewport: { width: '100%', overflow: 'hidden', marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface },
  chartScrollContent: { minWidth: CHART_WIDTH },
  chartCanvas: { position: 'relative' },
  chartHeader: { position: 'absolute', top: 0, width: CHART_COLUMN_WIDTH, height: CHART_HEADER_HEIGHT, paddingHorizontal: 5, color: colors.textPrimary, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 0.8, textAlign: 'center', textAlignVertical: 'center', textTransform: 'uppercase' },
  chartHeaderRule: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.glassStroke },
  chartAxis: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.glassStroke },
  chartRankLabel: { position: 'absolute', left: 0, width: CHART_RANK_WIDTH - 4, height: 18, color: colors.textSecondary, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  chartLineLayer: { ...StyleSheet.absoluteFillObject },
  chartLine: { position: 'absolute', height: 3, borderRadius: 2 },
  chartTarget: { position: 'absolute', width: CHART_TARGET_SIZE, height: CHART_TARGET_SIZE, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSurface },
  estimate: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 12 },
  narrative: { color: colors.textPrimary, fontSize: 14, lineHeight: 21, backgroundColor: colors.bgInteractive, borderRadius: 14, padding: 14, marginTop: 12 },
  historicalNote: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 24, textAlign: 'center' },
});
