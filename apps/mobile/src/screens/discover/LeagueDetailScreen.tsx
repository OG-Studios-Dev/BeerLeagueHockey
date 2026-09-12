import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BrandAtmosphere from '../../components/BrandAtmosphere';
import SectionHeader from '../../components/SectionHeader';
import TeamLogo from '../../components/TeamLogo';
import { useLeague } from '../../context/LeagueContext';
import { supabase } from '../../lib/supabase/client';
import { getStandings, getCurrentSeason, type StandingRow, type Season } from '../../lib/supabase/data';
import colors from '../../theme/colors';

type LeagueInfo = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  province: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
};

type TeamInfo = {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
};

export default function LeagueDetailScreen({ route, navigation }: any) {
  const { leagueId } = route.params;
  const { availableLeagues, previewLeague, setActiveLeague } = useLeague();
  const [league, setLeague] = React.useState<LeagueInfo | null>(null);
  const [season, setSeason] = React.useState<Season | null>(null);
  const [teams, setTeams] = React.useState<TeamInfo[]>([]);
  const [standings, setStandings] = React.useState<StandingRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  const isMember = React.useMemo(
    () => availableLeagues.some((l) => l.id === leagueId),
    [availableLeagues, leagueId],
  );

  React.useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // Fetch league info
        const { data: leagueData } = await supabase
          .from('leagues')
          .select('id, name, slug, city, province, logo_url, primary_color, secondary_color')
          .eq('id', leagueId)
          .single();

        if (leagueData) {
          setLeague(leagueData as LeagueInfo);
        }

        // Fetch teams
        const { data: teamsData } = await supabase
          .from('teams')
          .select('id, name, logo_url, primary_color')
          .eq('league_id', leagueId)
          .order('name');

        setTeams((teamsData as TeamInfo[]) ?? []);

        // Fetch current season
        const currentSeason = await getCurrentSeason(leagueId);
        setSeason(currentSeason);

        // Fetch standings
        if (currentSeason) {
          const standingsData = await getStandings(leagueId, currentSeason.id);
          setStandings(standingsData);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [leagueId]);

  const handleBrowse = () => {
    if (!league) return;
    previewLeague({
      id: league.id,
      name: league.name,
      slug: league.slug,
      logoUrl: league.logo_url,
      city: league.city,
      theme: {
        primaryColor: league.primary_color ?? '#22D3EE',
        secondaryColor: league.secondary_color ?? '#3B82F6',
        backgroundColor: colors.bgBase,
        cardColor: colors.bgSurface,
        textColor: colors.textPrimary,
        logoUrl: league.logo_url,
        leagueName: league.name,
      },
    });
    navigation.navigate('Home');
  };

  const handleJoinRequest = () => {
    Alert.alert(
      'Request to Join',
      `Contact the league administrator of ${league?.name ?? 'this league'} to join. Visit their league website for contact info.`,
      [
        { text: 'OK', style: 'default' },
        {
          text: 'Browse Schedule',
          onPress: handleBrowse,
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>League Details</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!league) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>League Details</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>League not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const accentColor = league.primary_color ?? colors.primary;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <BrandAtmosphere accentColor={accentColor} intensity="low" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>League Details</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* League Header */}
        <View style={styles.heroCard}>
          <LinearGradient
            colors={[`${accentColor}20`, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <TeamLogo
            logoUrl={league.logo_url}
            teamName={league.name}
            primaryColor={accentColor}
            size={72}
          />
          <Text style={styles.heroName}>{league.name}</Text>
          {league.city && (
            <View style={styles.heroLocationRow}>
              <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.heroLocation}>
                {league.city}{league.province ? `, ${league.province}` : ''}
              </Text>
            </View>
          )}
          <View style={styles.heroMetaRow}>
            <View style={styles.heroMetaPill}>
              <Text style={styles.heroMetaValue}>{teams.length}</Text>
              <Text style={styles.heroMetaLabel}>Teams</Text>
            </View>
            {season && (
              <View style={styles.heroMetaPill}>
                <Text style={styles.heroMetaValue}>{season.name}</Text>
                <Text style={styles.heroMetaLabel}>Current Season</Text>
              </View>
            )}
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          {isMember ? (
            <Pressable
              style={[styles.actionBtn, { backgroundColor: accentColor }]}
              onPress={() => {
                const leagueObj = availableLeagues.find((l) => l.id === leagueId);
                if (leagueObj) {
                  void setActiveLeague(leagueObj);
                  navigation.navigate('Home');
                }
              }}
            >
              <Ionicons name="enter-outline" size={18} color={colors.textOnPrimary} />
              <Text style={[styles.actionBtnText, { color: colors.textOnPrimary }]}>Switch to League</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.actionBtn, { backgroundColor: accentColor }]}
              onPress={handleJoinRequest}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.textOnPrimary} />
              <Text style={[styles.actionBtnText, { color: colors.textOnPrimary }]}>Request to Join</Text>
            </Pressable>
          )}
          <Pressable style={styles.actionBtnSecondary} onPress={handleBrowse}>
            <Ionicons name="eye-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.actionBtnSecondaryText}>Browse Schedule</Text>
          </Pressable>
        </View>

        {/* Teams List */}
        {teams.length > 0 && (
          <>
            <SectionHeader title="Teams" />
            <View style={styles.teamsList}>
              {teams.map((team) => (
                <View key={team.id} style={styles.teamRow}>
                  <TeamLogo
                    teamId={team.id}
                    logoUrl={team.logo_url}
                    teamName={team.name}
                    primaryColor={team.primary_color}
                    size={36}
                  />
                  <Text style={styles.teamRowName} numberOfLines={1}>{team.name}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Standings */}
        {standings.length > 0 && (
          <>
            <SectionHeader title="Standings" />
            <View style={styles.standingsCard}>
              <View style={styles.standingsHeader}>
                <Text style={[styles.standingsHeaderCell, styles.standingsTeamCol]}>Team</Text>
                <Text style={styles.standingsHeaderCell}>GP</Text>
                <Text style={styles.standingsHeaderCell}>W</Text>
                <Text style={styles.standingsHeaderCell}>L</Text>
                <Text style={styles.standingsHeaderCell}>PTS</Text>
              </View>
              {standings.map((row, index) => (
                <View key={row.team_id ?? index} style={styles.standingsRow}>
                  <View style={styles.standingsTeamCol}>
                    <Text style={styles.standingsTeamName} numberOfLines={1}>
                      {row.team_name ?? '---'}
                    </Text>
                  </View>
                  <Text style={styles.standingsCell}>{row.games_played ?? 0}</Text>
                  <Text style={styles.standingsCell}>{row.wins ?? 0}</Text>
                  <Text style={styles.standingsCell}>{row.losses ?? 0}</Text>
                  <Text style={[styles.standingsCell, styles.standingsPts]}>{row.points ?? 0}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderCard,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: 16 },
  content: { padding: 16, paddingBottom: 40, gap: 8 },

  heroCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  heroName: { fontSize: 24, fontWeight: '900', color: colors.textPrimary, textAlign: 'center' },
  heroLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroLocation: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  heroMetaRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  heroMetaPill: {
    backgroundColor: colors.glassHighlight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  heroMetaValue: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  heroMetaLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },

  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
  },
  actionBtnText: { fontSize: 14, fontWeight: '800' },
  actionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  actionBtnSecondaryText: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },

  teamsList: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    overflow: 'hidden',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderCard,
  },
  teamRowName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },

  standingsCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    overflow: 'hidden',
  },
  standingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bgInteractive,
  },
  standingsHeaderCell: {
    flex: 0.8,
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  standingsTeamCol: { flex: 2.5, paddingRight: 8 },
  standingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderCard,
  },
  standingsTeamName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  standingsCell: { flex: 0.8, fontSize: 14, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  standingsPts: { fontWeight: '900', color: colors.primary },
});
