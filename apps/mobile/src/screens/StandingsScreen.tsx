import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../components/CardFocus';
import { useLeague } from '../context/LeagueContext';
import colors from '../theme/colors';
import ScheduleScreen from './ScheduleScreen';

export default function StandingsScreen(props: { navigation: { navigate: (screen: string, params?: unknown) => void } }) {
  const { activeLeague, activeTheme, availableLeagues, setActiveLeague } = useLeague();

  if (!activeLeague) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.instructions}>Choose a league for standings</Text>
        </View>
        <FocusScrollView focusScopeKey="standings:league-select" contentContainerStyle={styles.leagueChoices}>
          {availableLeagues.map((league) => (
            <FocusCard key={league.id} focusId={`standings:league:${league.id}`}>
              <Pressable
                testID={`standings-league-choice-${league.id}`}
                accessibilityRole="button"
                accessibilityLabel={`View ${league.name} standings`}
                onPress={() => void setActiveLeague(league)}
                style={({ pressed }) => [styles.leagueChoice, pressed && styles.pressed]}
              >
                <Text style={styles.leagueName}>{league.name}</Text>
                <Text style={styles.leagueAction}>View standings</Text>
              </Pressable>
            </FocusCard>
          ))}
          {availableLeagues.length === 0 ? (
            <Text style={styles.empty}>Select or discover a league to view its standings.</Text>
          ) : null}
        </FocusScrollView>
      </SafeAreaView>
    );
  }

  return <ScheduleScreen {...props} initialTab="Standings" standalone />;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  instructions: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  leagueChoices: { paddingHorizontal: 16, gap: 10 },
  leagueChoice: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgSurface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pressed: { opacity: 0.72 },
  leagueName: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  leagueAction: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  empty: { color: colors.textSecondary, textAlign: 'center', paddingVertical: 24 },
});
