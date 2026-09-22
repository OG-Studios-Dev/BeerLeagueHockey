import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../components/CardFocus';

import { useLeague } from '../context/LeagueContext';
import {
  NOTIFICATION_PREFS_KEY,
  registerForPushNotifications,
  scheduleGameReminder,
  unregisterPushNotifications,
} from '../lib/notifications';
import { getSchedule, getCurrentSeason, mapGameStatus } from '../lib/supabase/data';
import { supabase } from '../lib/supabase/client';
import colors from '../theme/colors';

type NotifPrefs = {
  gameReminders: boolean;
};

const DEFAULT_PREFS: NotifPrefs = {
  gameReminders: false,
};

export default function NotificationSettingsScreen({ navigation }: { navigation: any }) {
  const { activeLeague } = useLeague();
  const [prefs, setPrefs] = React.useState<NotifPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    SecureStore.getItemAsync(NOTIFICATION_PREFS_KEY)
      .then((val) => {
        if (val) setPrefs({ gameReminders: JSON.parse(val).gameReminders === true });
      })
      .finally(() => setLoading(false));
  }, []);

  async function savePrefs(updated: NotifPrefs) {
    setPrefs(updated);
    await SecureStore.setItemAsync(NOTIFICATION_PREFS_KEY, JSON.stringify(updated));
  }

  async function handleGameRemindersToggle(val: boolean) {
    setErrorMessage(null);
    if (val) {
      const token = await registerForPushNotifications();
      if (!token) {
        setErrorMessage('Game Reminders were not enabled. Allow notifications and try again.');
        return;
      }
      // Schedule reminders for upcoming games
      if (activeLeague) {
        try {
          const season = await getCurrentSeason(activeLeague.id);
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: rosterData } = await supabase
              .from('team_rosters')
              .select('team_id')
              .eq('player_id', user.id)
              .eq('league_id', activeLeague.id)
              .eq('status', 'active')
              .maybeSingle();
            if (rosterData?.team_id) {
              const games = await getSchedule(activeLeague.id, season?.id ?? null, null);
              const upcomingGames = games.filter(g => mapGameStatus(g.status) === 'Upcoming');
              for (const g of upcomingGames) {
                await scheduleGameReminder({
                  id: g.id,
                  scheduledAt: g.scheduled_at,
                  homeTeam: g.home_team?.name ?? 'Home',
                  awayTeam: g.away_team?.name ?? 'Away',
                });
              }
            }
          }
        } catch (_) {}
      }
    } else {
      const { error } = await unregisterPushNotifications();
      if (error) {
        setErrorMessage(`Game Reminders are still enabled: ${error.message}`);
        return;
      }
    }
    await savePrefs({ ...prefs, gameReminders: val });
  }

  const rows: { key: keyof NotifPrefs; label: string; subtitle: string; icon: string; onToggle: (val: boolean) => Promise<void> }[] = [
    {
      key: 'gameReminders',
      label: 'Game Reminders',
      subtitle: 'Local alerts 2 hours before currently listed upcoming team games',
      icon: 'notifications-outline',
      onToggle: handleGameRemindersToggle,
    },
  ];

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      <FocusScrollView contentContainerStyle={styles.content}>
        <FocusCard focusId="notification-settings:preferences" style={styles.card}>
          {rows.map((row, idx) => (
            <View key={row.key} style={[styles.row, idx < rows.length - 1 && styles.rowBorder]}>
              <View style={styles.rowIcon}>
                <Ionicons name={row.icon as any} size={20} color={colors.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
              </View>
              <Switch
                accessibilityLabel={row.label}
                accessibilityHint="Turns reminders for currently listed upcoming team games on or off"
                value={prefs[row.key]}
                onValueChange={async (val) => {
                  await row.onToggle(val);
                }}
                trackColor={{ false: colors.bgInteractive, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </FocusCard>
        {errorMessage ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}
      </FocusScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16 },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderCard },
  rowIcon: { width: 28, alignItems: 'center' },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  rowSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  errorBanner: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accentRed,
    backgroundColor: colors.bgSurface,
  },
  errorText: { color: colors.accentRed, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
