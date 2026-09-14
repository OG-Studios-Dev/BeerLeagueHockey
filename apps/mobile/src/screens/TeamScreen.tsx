import React from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../components/Avatar';
import BrandAtmosphere from '../components/BrandAtmosphere';
import GuestBanner from '../components/GuestBanner';
import TeamLogo from '../components/TeamLogo';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useLeague } from '../context/LeagueContext';
import {
  getActiveSeasonMembershipsForUser,
  getActiveSeasonRoster,
  getActiveSeasonTeamForUser,
  getTeamActiveSeason,
  type ActiveTeamMembership,
  type TeamRosterMember,
} from '../lib/supabase/team';
import { navigateToPlayerCard } from '../navigation/playerCard';
import { TeamStackParamList } from '../navigation/types';
import colors from '../theme/colors';
import { supabase } from '../lib/supabase/client';

type TeamLoadState = 'idle' | 'ready' | 'no-active-season' | 'no-team' | 'error';
type Props = NativeStackScreenProps<TeamStackParamList, 'TeamList'>;

export default function TeamScreen({ navigation }: Props) {
  const { activeLeague, activeTheme, isGuestLeague, availableLeagues, setActiveLeague } = useLeague();
  const { reduceTransparency } = useAccessibilityPreferences();
  const [roster, setRoster] = React.useState<TeamRosterMember[]>([]);
  const [teamName, setTeamName] = React.useState('My Team');
  const [teamColor, setTeamColor] = React.useState<string | null>(null);
  const [teamLogoUrl, setTeamLogoUrl] = React.useState<string | null>(null);
  const [userTeamId, setUserTeamId] = React.useState<string | null>(null);
  const [seasonName, setSeasonName] = React.useState<string | null>(null);
  const [loadState, setLoadState] = React.useState<TeamLoadState>('idle');
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [globalTeams, setGlobalTeams] = React.useState<ActiveTeamMembership[]>([]);
  const [globalLoading, setGlobalLoading] = React.useState(false);
  const [globalError, setGlobalError] = React.useState<string | null>(null);
  const publicSurface = reduceTransparency
    ? { backgroundColor: '#0C1B31', borderColor: '#41607F' }
    : { backgroundColor: 'rgba(10, 22, 40, 0.30)', borderColor: 'rgba(125, 190, 255, 0.22)' };

  React.useEffect(() => {
    let cancelled = false;

    if (!activeLeague) {
      setRoster([]);
      setUserTeamId(null);
      setSeasonName(null);
      setTeamColor(null);
      setTeamLogoUrl(null);
      setLoadError(null);
      setLoadState('idle');
      setLoading(false);
      if (availableLeagues.length === 0) {
        setGlobalTeams([]);
        setGlobalError(null);
        setGlobalLoading(false);
        return () => { cancelled = true; };
      }

      setGlobalLoading(true);
      setGlobalError(null);
      void (async () => {
        try {
          const { data } = await supabase.auth.getUser();
          if (cancelled) return;
          const userId = data.user?.id;
          if (!userId) {
            setGlobalTeams([]);
            setGlobalLoading(false);
            return;
          }

          const result = await getActiveSeasonMembershipsForUser(userId, availableLeagues);
          if (cancelled) return;
          setGlobalTeams(result.data);
          setGlobalError(result.error);
          setGlobalLoading(false);
        } catch {
          if (cancelled) return;
          setGlobalTeams([]);
          setGlobalError('We could not load your active team assignments.');
          setGlobalLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }

    setLoading(true);
    setLoadError(null);
    setLoadState('idle');
    setRoster([]);
    setUserTeamId(null);
    setSeasonName(null);
    setTeamName('My Team');
    setTeamColor(null);
    setTeamLogoUrl(null);

    void (async () => {
      try {
        const seasonResult = await getTeamActiveSeason(activeLeague.id);
        if (cancelled) return;
        if (seasonResult.error) {
          setLoadError(seasonResult.error);
          setLoadState('error');
          setLoading(false);
          return;
        }
        if (!seasonResult.season) {
          setLoadState('no-active-season');
          setLoading(false);
          return;
        }

        setSeasonName(seasonResult.season.name);
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        const userId = data.user?.id;
        if (!userId) {
          setLoadState('no-team');
          setLoading(false);
          return;
        }

        const userTeam = await getActiveSeasonTeamForUser(userId, activeLeague.id, seasonResult.season.id);
        if (cancelled) return;
        if (!userTeam) {
          setLoadState('no-team');
          setLoading(false);
          return;
        }

        const members = await getActiveSeasonRoster(userTeam.team_id, activeLeague.id, seasonResult.season.id);
        if (cancelled) return;
        setTeamName(userTeam.team_name);
        setTeamColor(userTeam.primary_color);
        setTeamLogoUrl(userTeam.logo_url);
        setUserTeamId(userTeam.team_id);
        setRoster(members);
        setLoadState('ready');
        setLoading(false);
      } catch {
        if (cancelled) return;
        setLoadError('We could not load your active-season team.');
        setLoadState('error');
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeLeague, availableLeagues]);

  if (!activeLeague && availableLeagues.length === 0) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Select a league to see your team</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!activeLeague) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]} edges={['top', 'left', 'right']}>
        <BrandAtmosphere intensity="low" />
        <GuestBanner />
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.globalIntro}>
            Every BLH team you play on, across every league, in one place.
          </Text>

          {globalLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : globalError ? (
            <View testID="team-list-error-state" style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>Unable to load My Teams</Text>
              <Text style={styles.emptyBody}>{globalError}</Text>
            </View>
          ) : globalTeams.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No active team assignments found yet</Text>
            </View>
          ) : (
            globalTeams.map((team) => (
              <Pressable
                key={`${team.leagueId}-${team.teamId}`}
                testID={`team-list-global-card-${team.leagueId}-${team.teamId}`}
                accessibilityRole="button"
                accessibilityLabel={`Open ${team.teamName}`}
                style={[styles.globalTeamCard, publicSurface]}
                onPress={() => {
                  const nextLeague = availableLeagues.find((league) => league.id === team.leagueId);
                  if (nextLeague) {
                    void setActiveLeague(nextLeague);
                  }
                  navigation.navigate('TeamDetail', { teamId: team.teamId, leagueId: team.leagueId });
                }}
              >
                <View style={styles.globalTeamHeader}>
                  <View style={styles.globalTeamIdentity}>
                    <TeamLogo
                      teamId={team.teamId}
                      logoUrl={team.teamLogoUrl}
                      teamName={team.teamName}
                      primaryColor={team.teamPrimaryColor ?? colors.primary}
                      size={52}
                    />
                    <View style={styles.globalTeamCopy}>
                      <Text style={styles.globalTeamName}>{team.teamName}</Text>
                      <Text style={styles.globalTeamMeta}>
                        {team.leagueName} · {team.seasonName}
                        {team.leagueCity ? ` · ${team.leagueCity}` : ''}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.globalPill,
                      { backgroundColor: (team.teamPrimaryColor ?? colors.primary) + '22' },
                    ]}
                  >
                    <Text style={[styles.globalPillText, { color: team.teamPrimaryColor ?? colors.primary }]}>
                      {team.position ?? 'Skater'}
                      {team.jerseyNumber != null ? ` · #${team.jerseyNumber}` : ''}
                    </Text>
                  </View>
                </View>

                <View style={styles.globalTeamFooter}>
                  <Text style={styles.globalTeamFooterText}>Open roster, record, and upcoming games</Text>
                  <Text style={styles.globalTeamLink}>View team</Text>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={activeTheme.primaryColor} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadState === 'error') {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <View testID="team-list-active-error-state" style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Unable to load team</Text>
          <Text style={styles.emptyBody}>{loadError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadState === 'no-active-season') {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <View testID="team-list-no-active-season-state" style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No active season</Text>
          <Text style={styles.emptyBody}>Your team roster will appear when this league activates a season.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadState === 'no-team') {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <GuestBanner />
        <View testID="team-list-no-assignment-state" style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No active team assignment</Text>
          <Text style={styles.emptyBody}>{seasonName ? `You are not on a roster for ${seasonName}.` : 'You are not on this active-season roster.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (roster.length === 0) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No roster found for this league</Text>
        </View>
      </SafeAreaView>
    );
  }

  const primaryColor = teamColor ?? activeTheme.primaryColor;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]} edges={['top', 'left', 'right']}>
      <BrandAtmosphere accentColor={primaryColor} secondaryColor={activeTheme.secondaryColor} intensity="low" />
      <GuestBanner />
      <FlatList
        data={roster}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <Pressable
              testID="team-list-identity-card"
              accessibilityRole="button"
              accessibilityLabel={`Open ${teamName} team details`}
              onPress={() => {
                if (!isGuestLeague && userTeamId) {
                  navigation.navigate('TeamDetail', { teamId: userTeamId, leagueId: activeLeague.id });
                }
              }}
              disabled={!userTeamId || isGuestLeague}
              style={[styles.teamHeaderCard, publicSurface]}
            >
              <TeamLogo
                teamId={userTeamId}
                logoUrl={teamLogoUrl}
                teamName={teamName}
                primaryColor={primaryColor}
                size={80}
              />
              <View style={styles.teamHeaderInfo}>
                <Text style={styles.teamHeaderName}>{teamName}</Text>
                <Text style={styles.teamHeaderSub}>{activeLeague.name} · {seasonName}</Text>
                <Text style={styles.teamHeaderSub}>{roster.length} active {roster.length === 1 ? 'player' : 'players'}</Text>
              </View>
            </Pressable>
            <View style={styles.cardHeader}>
              <Text style={styles.cardHeaderText}>Roster</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`team-list-player-${item.player_id}`}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.player_name}'s player card`}
            style={({ pressed }) => [
              styles.playerRow,
              publicSurface,
              pressed && styles.playerRowPressed,
            ]}
            onPress={() => navigateToPlayerCard(navigation, { playerId: item.player_id, leagueId: activeLeague?.id ?? null })}
          >
            <Text style={[styles.jersey, { color: primaryColor }]}>
              {item.jersey_number != null ? `#${item.jersey_number}` : '—'}
            </Text>
            <Avatar
              uri={item.avatar_url ?? null}
              name={item.player_name}
              size={40}
            />
            <Text style={styles.playerName}>{item.player_name}</Text>
            <View style={styles.positionPill}>
              <Text style={styles.positionText}>{item.is_goalie ? 'G' : (item.position ?? '—')}</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  emptyBody: { marginTop: 8, fontSize: 13, lineHeight: 19, color: colors.textSecondary, textAlign: 'center' },
  globalIntro: {
    marginTop: -2,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  globalTeamCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    minHeight: 44,
  },
  globalTeamHeader: { gap: 12 },
  globalTeamIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  globalTeamCopy: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
  globalTeamName: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
  globalTeamMeta: { fontSize: 12, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },
  globalPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  globalPillText: { fontSize: 12, fontWeight: '800' },
  globalTeamFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  globalTeamFooterText: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: 'auto', fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  globalTeamLink: { fontSize: 13, color: colors.primary, fontWeight: '800' },
  teamHeaderCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12,
  },
  teamHeaderInfo: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
  teamHeaderName: { fontSize: 26, lineHeight: 31, fontWeight: '900', color: colors.textPrimary },
  teamHeaderSub: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', marginTop: 4 },
  cardHeader: { marginTop: 4, marginBottom: 8 },
  cardHeaderText: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  playerRow: {
    minHeight: 44, borderRadius: 14, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10,
  },
  playerRowPressed: { backgroundColor: colors.bgInteractive },
  jersey: { width: 36, fontSize: 15, fontWeight: '800' },
  playerName: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: 'auto', fontSize: 15, lineHeight: 20, fontWeight: '700', color: colors.textPrimary },
  positionPill: {
    backgroundColor: colors.bgInteractive, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.borderCard,
  },
  positionText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
});
