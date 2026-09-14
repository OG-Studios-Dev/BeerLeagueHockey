import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Avatar from '../../components/Avatar';
import TeamLogo from '../../components/TeamLogo';
import { filterPlayerMemberships, filterPlayers, reconcilePlayerFilters, type PlayerFilters } from '../../lib/leaguePagesModel';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { commonStyles, DivisionPicker, FilterChips, LeaguePageFrame, PageHeader, PageLoadState, SeasonPicker, useLeaguePage, useLeaguePageScope } from './LeaguePageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'PlayersDirectory'>;

function leadershipLabel(role: string | null) {
  if (role === 'captain') return 'Captain';
  if (role === 'alternate_captain') return 'Alternate Captain';
  return role ? role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : null;
}

export default function PlayersDirectoryScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const page = useLeaguePage(scope, 'players');
  const [filters, setFilters] = React.useState<Required<PlayerFilters>>({ search: '', divisionId: null, teamId: null, position: null });
  const playerRows = page.data?.players;
  React.useEffect(() => {
    setFilters((current) => playerRows ? reconcilePlayerFilters(playerRows, current) : { search: '', divisionId: null, teamId: null, position: null });
  }, [playerRows, scope.leagueId]);

  if (!page.data) return <LeaguePageFrame><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;
  const data = page.data;
  if (!data.selectedSeason) return <LeaguePageFrame><PageHeader eyebrow="Seasonal roster" title="Players" detail={data.league.name} /><SeasonPicker seasons={data.seasons} selected={null} onSelect={page.selectSeason} /><PageLoadState loading={false} error={null} noSeason retry={page.retry} /></LeaguePageFrame>;
  const players = filterPlayers(data.players, filters);
  const memberships = filterPlayerMemberships(data.players, filters);
  const teamOptions = data.teams.filter((team) => !filters.divisionId || team.divisionId === filters.divisionId);
  const positionOptions = [...new Set(data.players
    .filter((row) => (!filters.divisionId || row.divisionId === filters.divisionId) && (!filters.teamId || row.teamId === filters.teamId))
    .map((row) => row.position).filter((value): value is string => Boolean(value)))]
    .sort().map((name) => ({ id: name, name }));
  const historical = data.selectedSeason.id !== page.defaultSeasonId;
  const update = (next: PlayerFilters) => setFilters((current) => reconcilePlayerFilters(data.players, { ...current, ...next }));

  return (
    <LeaguePageFrame>
      <PageHeader eyebrow="Seasonal roster" title="Player Directory" detail={`${players.length} player${players.length === 1 ? '' : 's'} across ${new Set(memberships.map((row) => row.teamId)).size} team${new Set(memberships.map((row) => row.teamId)).size === 1 ? '' : 's'} — ${data.selectedSeason.name}`} />
      <SeasonPicker seasons={data.seasons} selected={data.selectedSeason.id} onSelect={page.selectSeason} />
      <View style={styles.searchWrap}>
        <Text style={styles.controlLabel}>Search</Text>
        <TextInput accessibilityLabel="Search name or jersey" placeholder="Search name or jersey" placeholderTextColor={colors.textSecondary} value={filters.search} onChangeText={(search) => setFilters((current) => ({ ...current, search }))} autoCapitalize="none" style={styles.search} />
      </View>
      <DivisionPicker divisions={data.divisions} selected={filters.divisionId} onSelect={(divisionId) => update({ divisionId, teamId: null })} />
      <View style={styles.filterBlock}><Text style={styles.controlLabel}>Team</Text><FilterChips items={teamOptions} selectedId={filters.teamId} allLabel="All Teams" onSelect={(teamId) => update({ teamId })} /></View>
      <View style={styles.filterBlock}><Text style={styles.controlLabel}>Position</Text><FilterChips items={positionOptions} selectedId={filters.position} allLabel="All Positions" onSelect={(position) => update({ position })} /></View>
      {(filters.search || filters.divisionId || filters.teamId || filters.position) ? (
        <Pressable accessibilityRole="button" onPress={() => setFilters({ search: '', divisionId: null, teamId: null, position: null })} style={styles.clear}><Text style={styles.clearText}>Clear filters</Text></Pressable>
      ) : null}

      <View style={commonStyles.section}>
        {historical ? <Text style={styles.historyLinks}>Player cards and team links below open current-season native detail pages.</Text> : null}
        {players.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No players found</Text><Text style={styles.muted}>Try adjusting your roster filters.</Text></View> : players.map((player) => {
          const playerMemberships = memberships.filter((row) => row.id === player.id);
          return (
            <View key={player.id} style={[commonStyles.card, styles.playerCard]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${player.fullName}, ${historical ? 'View current player card' : 'View player card'}`} onPress={() => navigation.navigate('LeaguePlayerCard', { playerId: player.id, leagueId: data.league.id })} style={styles.playerTop}>
                <Avatar uri={player.photoUrl} name={player.fullName} size={62} borderColor={colors.glassStrokeStrong} />
                <View style={styles.playerIdentity}>
                  <Text style={styles.playerName}>{player.fullName}</Text>
                  <Text style={styles.meta}>{player.jerseyNumber === null ? 'Jersey —' : `#${player.jerseyNumber}`} · {player.position ?? 'Position not listed'}</Text>
                  {leadershipLabel(player.leadershipRole) ? <Text style={styles.captain}>{leadershipLabel(player.leadershipRole)}</Text> : null}
                  {historical ? <Text style={styles.currentNote}>Opens current player card</Text> : null}
                </View>
              </Pressable>
              <View style={styles.memberships}>
                {playerMemberships.map((membership) => (
                  <Pressable key={membership.teamId} accessibilityRole="button" accessibilityLabel={`${membership.teamName}, View current roster`} onPress={() => navigation.navigate('LeagueTeamDetail', { teamId: membership.teamId, leagueId: data.league.id })} style={styles.teamLink}>
                    <TeamLogo teamId={membership.teamId} logoUrl={membership.teamLogoUrl} teamName={membership.teamName} size={30} transparentBacking />
                    <Text numberOfLines={2} style={styles.teamLinkText}>{membership.teamName}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </LeaguePageFrame>
  );
}

const styles = StyleSheet.create({
  searchWrap: { marginTop: 18 },
  controlLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 8 },
  search: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgInteractive, color: colors.textPrimary, fontSize: 16, paddingHorizontal: 15 },
  filterBlock: { marginTop: 18 },
  clear: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 12, paddingHorizontal: 4 },
  clearText: { color: colors.textInteractive, fontWeight: '800' },
  playerCard: { marginBottom: 12 },
  playerTop: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 13 },
  playerIdentity: { flex: 1, minWidth: 0 },
  playerName: { color: colors.textPrimary, fontSize: 18, lineHeight: 23, fontWeight: '900' },
  meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 },
  captain: { color: colors.textInteractive, fontSize: 12, fontWeight: '900', marginTop: 4 },
  currentNote: { color: colors.textSecondary, fontSize: 11, fontStyle: 'italic', marginTop: 4 },
  memberships: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassStroke, paddingTop: 8, gap: 6 },
  teamLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, paddingHorizontal: 6 },
  teamLinkText: { flex: 1, color: colors.textInteractive, fontSize: 13, fontWeight: '800' },
  empty: { minHeight: 220, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '900' },
  muted: { color: colors.textSecondary, textAlign: 'center', marginTop: 7 },
  historyLinks: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginBottom: 12 },
});
