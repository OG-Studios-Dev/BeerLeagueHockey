import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../../components/Avatar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase/client';
import { getTeamRoster, type RosterMemberRow } from '../../lib/supabase/data';
import { getGameCheckinStatusMap, type CaptainRole } from '../../lib/supabase/captain';
import { type CheckinStatus, getGameCheckinSummary } from '../../lib/supabase/checkins';
import colors from '../../theme/colors';

type StatusGroup = {
  key: string;
  label: string;
  icon: string;
  color: string;
  players: Array<RosterMemberRow & { checkinStatus?: CheckinStatus | null }>;
};

export default function GameAvailabilityScreen({ route, navigation }: any) {
  const { gameId, teamId, leagueId } = route.params;
  const { user } = useAuth();
  const [roster, setRoster] = React.useState<RosterMemberRow[]>([]);
  const [checkinMap, setCheckinMap] = React.useState<Record<string, CheckinStatus>>({});
  const [gameInfo, setGameInfo] = React.useState<{ opponent: string; date: string; location: string | null } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const loadData = React.useCallback(async () => {
    try {
      // Get roster
      const rosterData = await getTeamRoster(teamId, leagueId);
      setRoster(rosterData);

      // Get checkin statuses
      const checkins = await getGameCheckinStatusMap(gameId, teamId);
      setCheckinMap(checkins);

      // Get game info
      const { data: game } = await supabase
        .from('games')
        .select(`
          scheduled_at, location, home_team_id, away_team_id,
          home_team:teams!games_home_team_id_fkey(name),
          away_team:teams!games_away_team_id_fkey(name)
        `)
        .eq('id', gameId)
        .single();

      if (game) {
        const g = game as any;
        const homeTeam = Array.isArray(g.home_team) ? g.home_team[0] : g.home_team;
        const awayTeam = Array.isArray(g.away_team) ? g.away_team[0] : g.away_team;
        const isHome = g.home_team_id === teamId;
        const opponent = isHome ? (awayTeam?.name ?? 'TBD') : (homeTeam?.name ?? 'TBD');
        const d = new Date(g.scheduled_at);
        setGameInfo({
          opponent,
          date: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) +
            ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          location: g.location ?? null,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [gameId, teamId, leagueId]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const groups: StatusGroup[] = React.useMemo(() => {
    const confirmed: RosterMemberRow[] = [];
    const tentative: RosterMemberRow[] = [];
    const out: RosterMemberRow[] = [];
    const noResponse: RosterMemberRow[] = [];

    for (const player of roster) {
      const status = checkinMap[player.player_id];
      if (status === 'confirmed') confirmed.push(player);
      else if (status === 'tentative') tentative.push(player);
      else if (status === 'out') out.push(player);
      else noResponse.push(player);
    }

    return [
      { key: 'confirmed', label: 'In', icon: 'checkmark-circle', color: colors.accentGreen, players: confirmed },
      { key: 'tentative', label: 'Maybe', icon: 'help-circle', color: '#EAB308', players: tentative },
      { key: 'out', label: 'Out', icon: 'close-circle', color: colors.accentRed, players: out },
      { key: 'noResponse', label: 'No Response', icon: 'ellipse-outline', color: colors.textSecondary, players: noResponse },
    ];
  }, [roster, checkinMap]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Game Info */}
        {gameInfo && (
          <View style={styles.gameInfoCard}>
            <Text style={styles.gameInfoOpponent}>vs {gameInfo.opponent}</Text>
            <Text style={styles.gameInfoDate}>{gameInfo.date}</Text>
            {gameInfo.location && (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                <Text style={styles.locationText}>{gameInfo.location}</Text>
              </View>
            )}
          </View>
        )}

        {/* Summary Counts */}
        <View style={styles.countsRow}>
          {groups.map((group) => (
            <View key={group.key} style={styles.countCard}>
              <Ionicons name={group.icon as any} size={18} color={group.color} />
              <Text style={[styles.countValue, { color: group.color }]}>{group.players.length}</Text>
              <Text style={styles.countLabel}>{group.label}</Text>
            </View>
          ))}
        </View>

        {/* Roster by Status */}
        {groups.map((group) => {
          if (group.players.length === 0) return null;
          return (
            <View key={group.key} style={styles.statusSection}>
              <View style={styles.statusHeader}>
                <Ionicons name={group.icon as any} size={16} color={group.color} />
                <Text style={[styles.statusTitle, { color: group.color }]}>
                  {group.label} ({group.players.length})
                </Text>
              </View>
              {group.players.map((player) => (
                <View key={player.player_id} style={styles.playerRow}>
                  <Avatar uri={player.avatar_url ?? null} name={player.player_name} size={36} />
                  <View style={styles.playerInfo}>
                    <Text style={styles.playerName} numberOfLines={1}>{player.player_name}</Text>
                    <Text style={styles.playerMeta}>
                      #{player.jersey_number ?? '--'} {player.position ?? ''}
                    </Text>
                  </View>
                  <View style={[styles.statusDot, { backgroundColor: group.color }]} />
                </View>
              ))}
            </View>
          );
        })}

        {/* Empty state */}
        {roster.length === 0 && (
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={28} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>No roster data available</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, gap: 14 },

  gameInfoCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 16,
    gap: 6,
  },
  gameInfoOpponent: { fontSize: 20, fontWeight: '900', color: colors.textPrimary },
  gameInfoDate: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  locationText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

  countsRow: { flexDirection: 'row', gap: 8 },
  countCard: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4,
  },
  countValue: { fontSize: 22, fontWeight: '900' },
  countLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },

  statusSection: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    overflow: 'hidden',
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.bgInteractive,
  },
  statusTitle: { fontSize: 14, fontWeight: '800' },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderCard,
  },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  playerMeta: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 1 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  emptyCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 32,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
});
