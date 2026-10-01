import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusFlatList } from '../../components/CardFocus';
import TeamLogo from '../../components/TeamLogo';
import { usePlayersDirectory } from '../../hooks/usePlayersDirectory';
import { BLH_DEFAULT_PLAYER_AVATAR_URL } from '../../lib/imagePlaceholders';
import { buildPlayersDirectoryView, type DirectoryFilters, type DirectoryMembership } from '../../lib/playersDirectory';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { LeaguePageFrame, PageLoadState, useLeaguePageScope } from './LeaguePageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'PlayersDirectory'>;
type Option = { id: string | null; label: string };

function PlayerPortrait({ player, size }: { player: DirectoryMembership; size: number }) {
  const [uri, setUri] = React.useState(player.photoUrl ?? BLH_DEFAULT_PLAYER_AVATAR_URL);
  React.useEffect(() => setUri(player.photoUrl ?? BLH_DEFAULT_PLAYER_AVATAR_URL), [player.photoUrl]);
  return (
    <View style={[styles.portraitFrame, { width: size, height: size }]}>
      <Image alt={`${player.fullName} photo`} accessibilityLabel={`${player.fullName} photo`} resizeMode="cover" source={{ uri }} style={styles.portrait}
        onError={() => { if (uri !== BLH_DEFAULT_PLAYER_AVATAR_URL) setUri(BLH_DEFAULT_PLAYER_AVATAR_URL); }} />
      {player.jerseyNumber === null ? null : <View style={styles.jerseyBadge}><Text style={styles.jerseyText}>#{player.jerseyNumber}</Text></View>}
      {player.leadershipRole === 'captain' || player.leadershipRole === 'alternate_captain' ? (
        <View style={styles.roleBadge} accessibilityLabel={player.leadershipRole === 'captain' ? 'Captain' : 'Alternate captain'}>
          <Text style={styles.roleText}>{player.leadershipRole === 'captain' ? 'C' : 'A'}</Text>
        </View>
      ) : null}
    </View>
  );
}

function DirectorySelect({ label, selectedLabel, options, onSelect }: { label: string; selectedLabel: string; options: Option[]; onSelect: (id: string | null) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${selectedLabel}`} accessibilityHint="Opens selection list"
        onPress={() => setOpen(true)} style={({ pressed }) => [styles.select, pressed && styles.pressed]}>
        <Text numberOfLines={1} style={styles.selectText}>{selectedLabel}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.textPrimary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>{label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Close ${label}`} onPress={() => setOpen(false)} style={styles.modalClose}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
            <FocusFlatList data={options} keyExtractor={(item) => item.id ?? 'all'} initialNumToRender={12}
              renderItem={({ item }) => {
                const selected = item.label === selectedLabel;
                return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { onSelect(item.id); setOpen(false); }}
                  style={[styles.modalOption, selected && styles.modalOptionSelected]}>
                  <Text style={[styles.modalOptionText, selected && styles.modalOptionTextSelected]}>{item.label}</Text>
                  {selected ? <Ionicons name="checkmark" size={20} color={colors.textInteractive} /> : null}
                </Pressable>;
              }} />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function PlayerCard({ player, width, leagueId, navigation }: { player: DirectoryMembership; width: number; leagueId: string; navigation: Props['navigation'] }) {
  return (
    <FocusCard focusId={`league-players:${leagueId}:${player.id}`} style={[styles.card, { width }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${player.fullName}, view player card`}
        onPress={() => navigation.navigate('LeaguePlayerCard', { playerId: player.id, leagueId })}>
        <PlayerPortrait player={player} size={width} />
        <View style={styles.cardBody}>
          <Text numberOfLines={2} maxFontSizeMultiplier={1.5} style={styles.playerName}>{player.fullName}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${player.teamName}, view team`}
        onPress={() => navigation.navigate('LeagueTeamDetail', { teamId: player.teamId, leagueId })} style={[styles.teamLink, !player.position && styles.teamLinkLast]}>
        <TeamLogo teamId={player.teamId} logoUrl={player.teamLogoUrl} teamName={player.teamName} primaryColor={player.teamPrimaryColor} size={32} transparentBacking />
        <Text numberOfLines={2} maxFontSizeMultiplier={1.4} style={styles.teamName}>{player.teamName}</Text>
      </Pressable>
      {player.position ? <View style={styles.positionPill}><Text style={styles.positionText}>{player.position}</Text></View> : null}
    </FocusCard>
  );
}

export default function PlayersDirectoryScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const directory = usePlayersDirectory(scope);
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.max(140, (windowWidth - 48) / 2);
  const [filters, setFilters] = React.useState<DirectoryFilters>({ search: '', divisionId: null, teamId: null, position: null });
  React.useEffect(() => setFilters({ search: '', divisionId: null, teamId: null, position: null }), [scope.leagueId, scope.leagueSlug]);

  if (!directory.data) return <LeaguePageFrame><PageLoadState loading={directory.loading} error={directory.error} noSeason={false} retry={directory.retry} /></LeaguePageFrame>;

  const data = directory.data;
  const view = buildPlayersDirectoryView(data, filters);
  const selectedTeam = data.teams.find((team) => team.id === filters.teamId)?.name ?? 'All Teams';
  const selectedPosition = filters.position ?? 'All Positions';
  const teamOptions: Option[] = [{ id: null, label: 'All Teams' }, ...view.teamOptions.map((team) => ({ id: team.id, label: team.name }))];
  const positionOptions: Option[] = [{ id: null, label: 'All Positions' }, ...view.positions.map((position) => ({ id: position, label: position }))];
  const filtered = Boolean(filters.search || filters.teamId || filters.position || filters.divisionId);
  const reset = () => setFilters({ search: '', divisionId: null, teamId: null, position: null });
  const header = <View style={styles.header}>
    <Text style={styles.summary}>{view.players.length} player{view.players.length === 1 ? '' : 's'} across {view.teamCount} team{view.teamCount === 1 ? '' : 's'}</Text>
    {data.omittedOrphanRows ? <Text style={styles.integrityNote}>{data.omittedOrphanRows} roster {data.omittedOrphanRows === 1 ? 'entry is' : 'entries are'} unavailable because no canonical player profile is attached.</Text> : null}
    <View style={styles.searchWrap}>
      <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
      <TextInput accessibilityLabel="Search players by name or jersey number" placeholder="Search players by name or jersey number…"
        placeholderTextColor={colors.textSecondary} value={filters.search} onChangeText={(search) => setFilters((current) => ({ ...current, search }))}
        autoCapitalize="none" returnKeyType="search" style={styles.search} />
    </View>
    <View style={styles.filterRow}>
      <View style={styles.filterLabelWrap}><Ionicons name="filter-outline" size={17} color={colors.textSecondary} /><Text style={styles.filterLabel}>Filter by:</Text></View>
      <DirectorySelect label="Filter by team" selectedLabel={selectedTeam} options={teamOptions} onSelect={(teamId) => setFilters((current) => ({ ...current, teamId }))} />
      <DirectorySelect label="Filter by position" selectedLabel={selectedPosition} options={positionOptions} onSelect={(position) => setFilters((current) => ({ ...current, position }))} />
    </View>
    {filtered ? <Pressable accessibilityRole="button" onPress={reset} style={styles.clear}><Text style={styles.clearText}>Clear filters</Text></Pressable> : null}
  </View>;

  return <LeaguePageFrame scrollable={false}>
    <FocusFlatList data={view.players} numColumns={2} keyExtractor={(player) => player.id}
      focusScopeKey={`league-players:${data.league.id}`} focusKeyExtractor={(player) => `league-players:${data.league.id}:${player.id}`}
      ListHeaderComponent={header}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>No players found</Text><Text style={styles.emptyText}>Try another name, jersey number, team, or position.</Text>{filtered ? <Pressable accessibilityRole="button" onPress={reset} style={styles.emptyReset}><Text style={styles.clearText}>Reset filters</Text></Pressable> : null}</View>}
      columnWrapperStyle={styles.columns} contentContainerStyle={styles.content} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7} removeClippedSubviews
      renderItem={({ item }) => <PlayerCard player={item} width={cardWidth} leagueId={data.league.id} navigation={navigation} />} />
  </LeaguePageFrame>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  header: { paddingTop: 8, paddingBottom: 24 },
  summary: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  integrityNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 5 },
  searchWrap: { minHeight: 50, marginTop: 18, justifyContent: 'center' },
  searchIcon: { position: 'absolute', left: 16, zIndex: 1 },
  search: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: '#091423', color: colors.textPrimary, fontSize: 16, paddingLeft: 48, paddingRight: 16 },
  filterRow: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  filterLabelWrap: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 },
  filterLabel: { color: colors.textSecondary, fontSize: 14 },
  select: { minHeight: 44, maxWidth: 230, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderRadius: 9, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: '#091423', paddingHorizontal: 14 },
  selectText: { flexShrink: 1, color: colors.textPrimary, fontSize: 14 },
  pressed: { opacity: 0.72 },
  clear: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  clearText: { color: colors.textInteractive, fontWeight: '800' },
  columns: { justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  card: { overflow: 'hidden', borderRadius: 26, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: 'rgba(5, 12, 22, 0.96)' },
  portraitFrame: { position: 'relative', overflow: 'hidden', backgroundColor: colors.bgInteractive },
  portrait: { width: '100%', height: '100%' },
  jerseyBadge: { position: 'absolute', top: 8, left: 8, borderRadius: 8, backgroundColor: 'rgba(3, 9, 18, 0.84)', paddingHorizontal: 8, paddingVertical: 4 },
  jerseyText: { color: colors.textPrimary, fontSize: 14, fontWeight: '900' },
  roleBadge: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandGold },
  roleText: { color: '#10141B', fontSize: 14, fontWeight: '900' },
  cardBody: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  playerName: { minHeight: 40, color: colors.textPrimary, fontSize: 16, lineHeight: 20, fontWeight: '600' },
  positionPill: { alignSelf: 'flex-start', marginLeft: 16, marginBottom: 14, borderRadius: 5, backgroundColor: colors.bgInteractive, paddingHorizontal: 8, paddingVertical: 3 },
  positionText: { color: colors.textSecondary, fontSize: 12 },
  teamLink: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, paddingHorizontal: 6, borderRadius: 10 },
  teamLinkLast: { marginBottom: 10 },
  teamName: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  empty: { minHeight: 280, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '900' },
  emptyText: { color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 7 },
  emptyReset: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.72)' },
  modalSheet: { maxHeight: '78%', minHeight: 260, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: '#0A1628', paddingHorizontal: 16, paddingBottom: 18 },
  modalHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '900' },
  modalClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.bgInteractive },
  modalOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, paddingHorizontal: 14 },
  modalOptionSelected: { backgroundColor: colors.bgInteractive },
  modalOptionText: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  modalOptionTextSelected: { color: colors.textInteractive, fontWeight: '800' },
});
