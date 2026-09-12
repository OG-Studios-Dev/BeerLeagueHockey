import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../../components/Avatar';
import TeamLogo from '../../components/TeamLogo';
import { supabase } from '../../lib/supabase/client';
import { getGameGoalScorers, mapGameStatus } from '../../lib/supabase/data';
import colors from '../../theme/colors';

type GameInfo = {
  id: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  scheduled_at: string;
  status: string | null;
  location: string | null;
  home_team: { name: string; logo_url: string | null; primary_color: string | null } | null;
  away_team: { name: string; logo_url: string | null; primary_color: string | null } | null;
};

type GoalScorer = {
  player_id: string;
  full_name: string;
  goals: number;
  assists: number;
  team_id: string;
};

type PenaltyRow = {
  player_id: string;
  full_name: string;
  penalty_minutes: number;
  team_id: string;
};

export default function GameRecapScreen({ route, navigation }: any) {
  const { gameId } = route.params;
  const [game, setGame] = React.useState<GameInfo | null>(null);
  const [goalScorers, setGoalScorers] = React.useState<GoalScorer[]>([]);
  const [penalties, setPenalties] = React.useState<PenaltyRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      try {
        // Get game
        const { data } = await supabase
          .from('games')
          .select(`
            id, league_id, home_team_id, away_team_id, home_score, away_score,
            scheduled_at, status, location,
            home_team:teams!games_home_team_id_fkey(name, logo_url, primary_color),
            away_team:teams!games_away_team_id_fkey(name, logo_url, primary_color)
          `)
          .eq('id', gameId)
          .single();

        if (data) {
          const g = data as any;
          setGame({
            ...g,
            home_team: Array.isArray(g.home_team) ? g.home_team[0] : g.home_team,
            away_team: Array.isArray(g.away_team) ? g.away_team[0] : g.away_team,
          });

          // Get goal scorers
          const scorers = await getGameGoalScorers(gameId);
          setGoalScorers(scorers as GoalScorer[]);

          // Get penalties from player_stats
          const { data: penaltyData } = await supabase
            .from('player_stats')
            .select('player_id, penalty_minutes, team_id')
            .eq('game_id', gameId)
            .gt('penalty_minutes', 0);

          if (penaltyData && penaltyData.length > 0) {
            const pIds = penaltyData.map((p: any) => p.player_id);
            const { data: profiles } = await supabase
              .from('profiles')
              .select('id, full_name')
              .in('id', pIds);
            const nameMap = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));

            setPenalties(
              (penaltyData as any[]).map((p) => ({
                player_id: p.player_id,
                full_name: nameMap.get(p.player_id) ?? 'Unknown',
                penalty_minutes: p.penalty_minutes,
                team_id: p.team_id,
              })),
            );
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [gameId]);

  const handleShare = async () => {
    if (!game) return;
    const homeName = game.home_team?.name ?? 'Home';
    const awayName = game.away_team?.name ?? 'Away';
    const score = `${awayName} ${game.away_score ?? 0} - ${game.home_score ?? 0} ${homeName}`;
    const date = new Date(game.scheduled_at).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    try {
      await Share.share({
        message: `Game Result (${date})\n${score}\n\nPowered by Beer League Hockey`,
        title: 'Game Result',
      });
    } catch {
      // User cancelled
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Game Recap</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!game) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Game Recap</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Game not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const homeColor = game.home_team?.primary_color ?? colors.primary;
  const awayColor = game.away_team?.primary_color ?? colors.accentViolet;
  const homeName = game.home_team?.name ?? 'Home';
  const awayName = game.away_team?.name ?? 'Away';
  const isFinal = mapGameStatus(game.status) === 'Final';

  const homeScorers = goalScorers.filter((s) => s.team_id === game.home_team_id);
  const awayScorers = goalScorers.filter((s) => s.team_id === game.away_team_id);
  const homePenalties = penalties.filter((p) => p.team_id === game.home_team_id);
  const awayPenalties = penalties.filter((p) => p.team_id === game.away_team_id);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Game Recap</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Score Hero */}
        <View style={styles.scoreCard}>
          <LinearGradient
            colors={[`${awayColor}18`, 'transparent', `${homeColor}18`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          {isFinal && (
            <View style={styles.finalBadge}>
              <Text style={styles.finalBadgeText}>FINAL</Text>
            </View>
          )}
          <Text style={styles.dateText}>
            {new Date(game.scheduled_at).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </Text>
          <View style={styles.scoreRow}>
            <View style={styles.scoreTeam}>
              <TeamLogo
                teamId={game.away_team_id}
                logoUrl={game.away_team?.logo_url ?? null}
                teamName={awayName}
                primaryColor={awayColor}
                size={52}
              />
              <Text style={styles.scoreTeamName}>{awayName}</Text>
            </View>
            <View style={styles.scoreCenter}>
              <Text style={[styles.bigScore, { color: awayColor }]}>{game.away_score ?? 0}</Text>
              <Text style={styles.scoreDash}>-</Text>
              <Text style={[styles.bigScore, { color: homeColor }]}>{game.home_score ?? 0}</Text>
            </View>
            <View style={styles.scoreTeam}>
              <TeamLogo
                teamId={game.home_team_id}
                logoUrl={game.home_team?.logo_url ?? null}
                teamName={homeName}
                primaryColor={homeColor}
                size={52}
              />
              <Text style={styles.scoreTeamName}>{homeName}</Text>
            </View>
          </View>
          {game.location && (
            <Text style={styles.locationText}>{game.location}</Text>
          )}
        </View>

        {/* Goal Scorers */}
        {goalScorers.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>GOAL SCORERS</Text>
            <View style={styles.twoColRow}>
              <View style={styles.scorerCol}>
                <Text style={[styles.colHeader, { color: awayColor }]}>{awayName}</Text>
                {awayScorers.length > 0 ? (
                  awayScorers.map((s) => (
                    <View key={s.player_id} style={styles.scorerRow}>
                      <Ionicons name="ellipse" size={12} color={colors.textSecondary} />
                      <Text style={styles.scorerName} numberOfLines={1}>{s.full_name}</Text>
                      <Text style={styles.scorerCount}>
                        {s.goals > 1 ? `x${s.goals}` : ''}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noData}>No goals</Text>
                )}
              </View>
              <View style={styles.colDivider} />
              <View style={styles.scorerCol}>
                <Text style={[styles.colHeader, { color: homeColor }]}>{homeName}</Text>
                {homeScorers.length > 0 ? (
                  homeScorers.map((s) => (
                    <View key={s.player_id} style={styles.scorerRow}>
                      <Ionicons name="ellipse" size={12} color={colors.textSecondary} />
                      <Text style={styles.scorerName} numberOfLines={1}>{s.full_name}</Text>
                      <Text style={styles.scorerCount}>
                        {s.goals > 1 ? `x${s.goals}` : ''}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noData}>No goals</Text>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Penalties */}
        {penalties.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>PENALTIES</Text>
            <View style={styles.twoColRow}>
              <View style={styles.scorerCol}>
                <Text style={[styles.colHeader, { color: awayColor }]}>{awayName}</Text>
                {awayPenalties.length > 0 ? (
                  awayPenalties.map((p) => (
                    <View key={p.player_id} style={styles.scorerRow}>
                      <Text style={styles.scorerName} numberOfLines={1}>{p.full_name}</Text>
                      <Text style={styles.penaltyMin}>{p.penalty_minutes} PIM</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noData}>None</Text>
                )}
              </View>
              <View style={styles.colDivider} />
              <View style={styles.scorerCol}>
                <Text style={[styles.colHeader, { color: homeColor }]}>{homeName}</Text>
                {homePenalties.length > 0 ? (
                  homePenalties.map((p) => (
                    <View key={p.player_id} style={styles.scorerRow}>
                      <Text style={styles.scorerName} numberOfLines={1}>{p.full_name}</Text>
                      <Text style={styles.penaltyMin}>{p.penalty_minutes} PIM</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noData}>None</Text>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Share Button */}
        <Pressable style={styles.shareBtn} onPress={handleShare}>
          <Ionicons name="share-outline" size={18} color={colors.textOnPrimary} />
          <Text style={styles.shareBtnText}>Share Result</Text>
        </Pressable>
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
  content: { padding: 16, paddingBottom: 40, gap: 16 },

  scoreCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    padding: 20,
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  finalBadge: {
    backgroundColor: colors.badgeFinalBg,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  finalBadgeText: { fontSize: 12, fontWeight: '800', color: colors.badgeFinalText, letterSpacing: 1 },
  dateText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
  },
  scoreTeam: { flex: 1, alignItems: 'center', gap: 8 },
  scoreTeamName: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  scoreCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bigScore: { fontSize: 48, fontWeight: '900' },
  scoreDash: { fontSize: 28, fontWeight: '300', color: colors.textSecondary },
  locationText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

  sectionCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 16,
    gap: 12,
  },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: colors.textSecondary },
  twoColRow: { flexDirection: 'row', gap: 12 },
  scorerCol: { flex: 1, gap: 6 },
  colHeader: { fontSize: 12, fontWeight: '800', marginBottom: 4 },
  colDivider: { width: 1, backgroundColor: colors.borderCard },
  scorerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scorerName: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  scorerCount: { fontSize: 12, fontWeight: '800', color: colors.primary },
  penaltyMin: { fontSize: 12, fontWeight: '700', color: colors.accentRed },
  noData: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, fontStyle: 'italic' },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  shareBtnText: { fontSize: 15, fontWeight: '800', color: colors.textOnPrimary },
});
