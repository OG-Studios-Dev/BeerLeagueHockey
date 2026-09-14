import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TeamLogo from '../../components/TeamLogo';
import { useLeague } from '../../context/LeagueContext';
import { supabase } from '../../lib/supabase/client';
import colors from '../../theme/colors';

type DiscoverLeague = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  province: string | null;
  logo_url: string | null;
  primary_color: string | null;
  teamCount: number;
  hasActiveSeason: boolean;
};

export default function LeagueDiscoveryScreen({ navigation }: { navigation: any }) {
  const { availableLeagues } = useLeague();
  const [leagues, setLeagues] = React.useState<DiscoverLeague[]>([]);
  const [filteredLeagues, setFilteredLeagues] = React.useState<DiscoverLeague[]>([]);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  const memberLeagueIds = React.useMemo(
    () => new Set(availableLeagues.map((l) => l.id)),
    [availableLeagues],
  );

  React.useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data } = await supabase
          .from('leagues')
          .select('id, name, slug, city, province, logo_url, primary_color')
          .eq('is_public', true)
          .order('name');

        if (!data) {
          setLeagues([]);
          setFilteredLeagues([]);
          return;
        }

        const leagueIds = data.map((l: any) => l.id);

        // Get team counts
        const { data: teamCounts } = await supabase
          .from('teams')
          .select('league_id')
          .in('league_id', leagueIds);

        const countMap = new Map<string, number>();
        for (const row of (teamCounts ?? []) as any[]) {
          countMap.set(row.league_id, (countMap.get(row.league_id) ?? 0) + 1);
        }

        // Get active seasons
        const { data: activeSeasons } = await supabase
          .from('seasons')
          .select('league_id')
          .in('league_id', leagueIds)
          .eq('status', 'active');

        const activeSet = new Set((activeSeasons ?? []).map((s: any) => s.league_id));

        const discoverable: DiscoverLeague[] = (data as any[]).map((l) => ({
          id: l.id,
          name: l.name,
          slug: l.slug,
          city: l.city ?? null,
          province: l.province ?? null,
          logo_url: l.logo_url ?? null,
          primary_color: l.primary_color ?? null,
          teamCount: countMap.get(l.id) ?? 0,
          hasActiveSeason: activeSet.has(l.id),
        }));

        setLeagues(discoverable);
        setFilteredLeagues(discoverable);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  React.useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredLeagues(leagues);
      return;
    }
    const q = searchQuery.toLowerCase();
    setFilteredLeagues(
      leagues.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.city?.toLowerCase().includes(q) ?? false) ||
          (l.province?.toLowerCase().includes(q) ?? false),
      ),
    );
  }, [searchQuery, leagues]);

  const renderLeagueCard = ({ item }: { item: DiscoverLeague }) => {
    const isMember = memberLeagueIds.has(item.id);

    return (
      <Pressable
        style={styles.leagueCard}
        onPress={() => navigation.navigate('LeagueDetail', { leagueId: item.id })}
      >
        <View style={styles.leagueCardTop}>
          <TeamLogo
            logoUrl={item.logo_url}
            teamName={item.name}
            primaryColor={item.primary_color}
            size={48}
          />
          <View style={styles.leagueCardInfo}>
            <Text style={styles.leagueName} numberOfLines={1}>{item.name}</Text>
            {item.city && (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
                <Text style={styles.locationText}>
                  {item.city}{item.province ? `, ${item.province}` : ''}
                </Text>
              </View>
            )}
          </View>
          {isMember && (
            <View style={styles.memberBadge}>
              <Text style={styles.memberBadgeText}>Joined</Text>
            </View>
          )}
        </View>

        <View style={styles.leagueCardBottom}>
          <View style={styles.metaPill}>
            <Ionicons name="people-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.metaPillText}>{item.teamCount} teams</Text>
          </View>
          {item.hasActiveSeason && (
            <View style={[styles.metaPill, styles.activePill]}>
              <View style={styles.activeDot} />
              <Text style={[styles.metaPillText, { color: colors.accentGreen }]}>Active Season</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search leagues by name or city..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filteredLeagues.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="search-outline" size={32} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>
            {searchQuery ? 'No leagues match your search' : 'No public leagues available'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredLeagues}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={renderLeagueCard}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text style={styles.listSubtitle}>
                {filteredLeagues.length} league{filteredLeagues.length !== 1 ? 's' : ''} available
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  listHeader: { marginBottom: 4 },
  listSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: -6,
    marginBottom: 8,
  },
  leagueCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
    gap: 12,
    marginBottom: 10,
  },
  leagueCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  leagueCardInfo: { flex: 1, minWidth: 0 },
  leagueName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  locationText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  leagueCardBottom: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  activePill: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderColor: 'rgba(34,197,94,0.2)',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accentGreen,
  },
  metaPillText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  memberBadge: {
    backgroundColor: 'rgba(79,216,255,0.15)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  memberBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
});
