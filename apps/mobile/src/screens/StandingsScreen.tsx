import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLeague } from '../context/LeagueContext';
import ScheduleScreen from './ScheduleScreen';

export default function StandingsScreen(props: { navigation: { navigate: (screen: string, params?: unknown) => void } }) {
  const { activeLeague, activeTheme } = useLeague();

  if (!activeLeague) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Hockey Life access required</Text>
          <Text style={styles.emptyBody}>Your account does not have an accessible Hockey Life membership.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return <ScheduleScreen {...props} initialTab="Standings" standalone />;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 8 },
  emptyTitle: { color: '#F8FAFC', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  emptyBody: { color: '#94A3B8', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
