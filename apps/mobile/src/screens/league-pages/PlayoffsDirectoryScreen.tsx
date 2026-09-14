import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import TeamLogo from '../../components/TeamLogo';
import {
  buildPlayoffsDirectoryView,
  emptySeedLabel,
  type PlayoffPreview,
  type PreviewSeries,
  type PreviewTeam,
} from '../../lib/leaguePagesModel';
import type { PageSeries, PageSeriesTeam } from '../../lib/leaguePages';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { commonStyles, DivisionPicker, FilterChips, LeaguePageFrame, PageHeader, PageLoadState, SeasonPicker, useLeaguePage, useLeaguePageScope } from './LeaguePageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'PlayoffsDirectory'>;

function formatNextGame(value: string) {
  return new Date(value).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function TeamRow({ team, label, wins, winner, onPress }: {
  team: PageSeriesTeam | null; label: string; wins?: number; winner?: boolean; onPress?: () => void;
}) {
  if (!team) return <View style={styles.seedRow}><Text style={[styles.seedPlaceholder, label === 'BYE' && styles.bye]}>{label === 'BYE' ? 'BYE' : 'TBD'}</Text></View>;
  return (
    <Pressable accessibilityRole="button" disabled={!onPress} onPress={onPress} style={[styles.seedRow, winner && styles.winnerRow]}>
      <TeamLogo teamId={team.id} logoUrl={team.logoUrl} teamName={team.name} size={30} transparentBacking />
      <Text numberOfLines={2} style={[styles.seedName, winner && styles.winnerText]}>{team.name}</Text>
      {wins === undefined ? null : <Text style={[styles.wins, winner && styles.winnerText]}>{wins}</Text>}
    </Pressable>
  );
}

function OfficialSeriesCard({ series, leagueId, navigation }: { series: PageSeries; leagueId: string; navigation: Props['navigation'] }) {
  const highLabel = emptySeedLabel(series, 'high');
  const lowLabel = emptySeedLabel(series, 'low');
  return (
    <View style={styles.seriesCard}>
      <TeamRow team={series.highSeed} label={highLabel} wins={series.highSeedWins} winner={series.winnerId === series.highSeed?.id} onPress={series.highSeed ? () => navigation.navigate('LeagueTeamDetail', { teamId: series.highSeed!.id, leagueId }) : undefined} />
      <View style={styles.separator} />
      <TeamRow team={series.lowSeed} label={lowLabel} wins={series.lowSeedWins} winner={series.winnerId === series.lowSeed?.id} onPress={series.lowSeed ? () => navigation.navigate('LeagueTeamDetail', { teamId: series.lowSeed!.id, leagueId }) : undefined} />
      {series.nextGame ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Next game ${formatNextGame(series.nextGame.scheduledAt)}, ${series.nextGame.location ?? 'location to be announced'}`} onPress={() => navigation.navigate('LeagueGamePreview', { gameId: series.nextGame!.id })} style={styles.nextGame}>
          <Text style={styles.nextLabel}>Next Game</Text>
          <Text style={styles.nextValue}>{formatNextGame(series.nextGame.scheduledAt)}</Text>
          <Text style={styles.nextLocation}>{series.nextGame.location ?? 'Location to be announced'} ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function previewLabel(series: PreviewSeries, side: 'high' | 'low') {
  const target = side === 'high' ? series.highSeed : series.lowSeed;
  const opponent = side === 'high' ? series.lowSeed : series.highSeed;
  return target?.teamName ?? (opponent ? 'BYE' : 'TBD');
}

function PreviewTeamRow({ team, placeholder }: { team: PreviewTeam | null; placeholder: string }) {
  if (!team) return <View style={styles.previewSeedRow}><Text style={styles.seedPlaceholder}>{placeholder}</Text></View>;
  return (
    <View style={styles.previewSeedRow}>
      <Text style={styles.previewSeed}>#{team.rank}</Text>
      <TeamLogo teamId={team.teamId} logoUrl={team.logoUrl} teamName={team.teamName} size={28} transparentBacking />
      <Text numberOfLines={2} style={styles.previewTeam}>{team.teamName}</Text>
      <Text style={styles.previewPoints}>{team.points} pts</Text>
    </View>
  );
}

function PreviewBracket({ preview }: { preview: PlayoffPreview }) {
  return (
    <View style={styles.previewRounds}>
      <View style={styles.previewSummary}>
        <Text style={styles.previewScope}>{preview.divisionName ? `${preview.divisionName} Preview` : 'League Preview'}</Text>
        <Text style={styles.previewCount}>{preview.playoffTeamCount} teams, {preview.totalRounds} rounds</Text>
      </View>
      {preview.rounds.map((round) => (
        <View key={round.roundNumber} style={styles.roundBlock}>
          <Text style={styles.roundTitle}>{round.label}</Text>
          {round.series.map((series) => {
            const priorSeries = (series.seriesNumber - 1) * 2;
            const highPlaceholder = round.roundNumber === 1 ? previewLabel(series, 'high') : `Winner of Series ${priorSeries + 1}`;
            const lowPlaceholder = round.roundNumber === 1 ? previewLabel(series, 'low') : `Winner of Series ${priorSeries + 2}`;
            return (
            <View key={series.seriesNumber} style={styles.previewSeries}>
              <PreviewTeamRow team={series.highSeed} placeholder={highPlaceholder} />
              <View style={styles.separator} />
              <PreviewTeamRow team={series.lowSeed} placeholder={lowPlaceholder} />
            </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function PlayoffsDirectoryScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const page = useLeaguePage(scope, 'playoffs');
  const [officialDivisionId, setOfficialDivisionId] = React.useState<string | null>(null);
  const [previewDivisionId, setPreviewDivisionId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ data: PlayoffPreview | null; error: string | null } | null>(null);
  React.useEffect(() => {
    setOfficialDivisionId(null);
    setPreviewDivisionId(null);
    setPreview(null);
  }, [scope.leagueId, page.data?.selectedSeason?.id]);

  if (!page.data) return <LeaguePageFrame><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;
  const data = page.data;
  if (!data.selectedSeason) return <LeaguePageFrame><PageHeader eyebrow="League playoffs" title="Playoff Bracket" detail={data.league.name} /><SeasonPicker seasons={data.seasons} selected={null} onSelect={page.selectSeason} /><PageLoadState loading={false} error={null} noSeason retry={page.retry} /></LeaguePageFrame>;
  const view = buildPlayoffsDirectoryView(data, officialDivisionId);
  const historical = data.selectedSeason.id !== page.defaultSeasonId;
  const generatePreview = () => {
    const result = view.generatePreview(previewDivisionId);
    setPreview(result.success ? { data: result.data, error: null } : { data: null, error: result.error });
  };
  const generateLabel = preview?.data
    ? (view.previewContext.requiresDivisionSelection ? 'Regenerate Division Preview' : 'Regenerate Preview')
    : (view.previewContext.requiresDivisionSelection ? 'Generate Division Preview' : 'Generate Preview');
  const goToTab = (tab: 'Standings' | 'Schedule') => navigation.getParent()?.navigate(tab as never);

  return (
    <LeaguePageFrame>
      <PageHeader eyebrow="League playoffs" title="Playoff Bracket" detail={`${view.officialSeriesCount} official series — ${data.selectedSeason.name}`} />
      <SeasonPicker seasons={data.seasons} selected={data.selectedSeason.id} onSelect={page.selectSeason} />
      <DivisionPicker divisions={data.divisions} selected={officialDivisionId} onSelect={setOfficialDivisionId} />

      <View style={[commonStyles.section, commonStyles.card, styles.previewPanel]}>
        <View style={styles.previewHeader}><View style={styles.previewTitleWrap}><Text style={styles.previewOnly}>Preview Only</Text><Text style={commonStyles.sectionTitle}>Projected Playoff Seeding</Text></View></View>
        <Text style={commonStyles.sectionDetail}>This local projection shows what the playoff field looks like right now for {data.selectedSeason.name}. It never changes the official bracket.</Text>
        {view.previewContext.requiresDivisionSelection ? (
          <View style={styles.previewControl}><Text style={styles.controlLabel}>Preview division</Text><FilterChips items={view.previewContext.availableDivisions} selectedId={previewDivisionId} onSelect={(id) => { setPreviewDivisionId(id); setPreview(null); }} /></View>
        ) : null}
        <Pressable accessibilityRole="button" onPress={generatePreview} style={[commonStyles.primaryButton, styles.generate]}><Text style={commonStyles.primaryButtonText}>{generateLabel}</Text></Pressable>
        {preview?.error ? <Text accessibilityRole="alert" style={styles.previewError}>{preview.error}</Text> : null}
        {preview?.data ? <PreviewBracket preview={preview.data} /> : <Text style={styles.previewPrompt}>{view.previewContext.requiresDivisionSelection ? 'Select a division, then generate its projection.' : 'Generate a projection from the current standings.'}</Text>}
      </View>

      <View style={commonStyles.section}>
        <Text style={commonStyles.sectionTitle}>Official Bracket</Text>
        {historical ? <Text style={styles.historyLinks}>Team links in this historical bracket open current-season native team pages.</Text> : null}
        {view.sections.length === 0 ? (
          <View style={[commonStyles.card, styles.officialEmpty]}>
            <Text style={styles.emptyTitle}>No official bracket yet</Text>
            <Text style={styles.muted}>The official bracket will appear here after the league publishes playoff series.</Text>
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" onPress={() => goToTab('Standings')} style={[commonStyles.secondaryButton, styles.action]}><Text style={commonStyles.secondaryButtonText}>Standings</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => goToTab('Schedule')} style={[commonStyles.secondaryButton, styles.action]}><Text style={commonStyles.secondaryButtonText}>Schedule</Text></Pressable>
            </View>
          </View>
        ) : view.sections.map((section) => (
          <View key={section.key} style={styles.section}>
            {section.divisionName ? <Text style={styles.divisionTitle}>{section.divisionName}</Text> : null}
            {section.champion ? <View style={styles.champion}><Text style={styles.championLabel}>Champion</Text><TeamLogo teamId={section.champion.id} logoUrl={section.champion.logoUrl} teamName={section.champion.name} size={40} transparentBacking /><Text style={styles.championName}>{section.champion.name}</Text></View> : null}
            {section.rounds.map((round) => (
              <View key={round.roundNumber} style={styles.roundBlock}>
                <Text style={styles.roundTitle}>{round.label}</Text>
                {round.series.map((series) => <OfficialSeriesCard key={series.id} series={series} leagueId={data.league.id} navigation={navigation} />)}
              </View>
            ))}
          </View>
        ))}
      </View>
    </LeaguePageFrame>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16 },
  divisionTitle: { color: colors.textInteractive, fontSize: 18, fontWeight: '900', marginBottom: 10 },
  roundBlock: { marginTop: 14, gap: 9 },
  roundTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  seriesCard: { backgroundColor: colors.bgSurface, borderColor: colors.glassStroke, borderWidth: 1, borderRadius: 16, padding: 6 },
  seedRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, paddingHorizontal: 9 },
  winnerRow: { backgroundColor: 'rgba(34, 211, 238, 0.12)', borderWidth: 1, borderColor: 'rgba(34, 211, 238, 0.25)' },
  seedName: { flex: 1, color: colors.textPrimary, fontWeight: '800' },
  seedPlaceholder: { color: colors.textSecondary, fontStyle: 'italic', opacity: 0.7, paddingVertical: 8 },
  bye: { opacity: 0.5 },
  wins: { color: colors.textSecondary, fontSize: 16, fontWeight: '900' },
  winnerText: { color: colors.textInteractive },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.glassStroke, marginHorizontal: 7 },
  nextGame: { minHeight: 62, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassStroke, marginTop: 4, padding: 10 },
  nextLabel: { color: colors.textInteractive, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.3 },
  nextValue: { color: colors.textPrimary, fontWeight: '800', marginTop: 4 },
  nextLocation: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  champion: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(212, 175, 55, 0.35)', backgroundColor: 'rgba(212, 175, 55, 0.10)', padding: 12, marginBottom: 8 },
  championLabel: { width: '100%', color: '#EBCB69', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  championName: { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '900' },
  officialEmpty: { minHeight: 210, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  muted: { color: colors.textSecondary, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  actionRow: { width: '100%', flexDirection: 'row', gap: 9, marginTop: 18 },
  action: { flex: 1 },
  previewPanel: { padding: 16 },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewTitleWrap: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9 },
  previewOnly: { color: colors.textOnPrimary, backgroundColor: colors.primary, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  previewControl: { marginTop: 16 },
  controlLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 },
  generate: { marginTop: 16 },
  previewError: { color: '#FCA5A5', lineHeight: 20, marginTop: 14, textAlign: 'center' },
  previewPrompt: { color: colors.textSecondary, fontStyle: 'italic', lineHeight: 20, marginTop: 16, textAlign: 'center' },
  previewRounds: { marginTop: 8 },
  previewSeries: { backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 14, padding: 9 },
  previewSummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 },
  previewScope: { color: colors.textInteractive, borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 12, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  previewCount: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  previewSeedRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  previewSeed: { width: 25, color: colors.textSecondary, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  previewTeam: { flex: 1, minWidth: 0, color: colors.textPrimary, fontWeight: '800' },
  previewPoints: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  historyLinks: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginBottom: 10 },
});
