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
import { cancelAllGameReminders, registerForPushNotifications, scheduleGameReminder } from '../lib/notifications';
import { getSchedule, getCurrentSeason, mapGameStatus } from '../lib/supabase/data';
import { supabase } from '../lib/supabase/client';
import colors from '../theme/colors';

const PREFS_KEY = 'blh_notification_prefs';

type NotifPrefs = {
  gameReminders: boolean;
  checkinReminders: boolean;
  scoreAlerts: boolean;
  leagueAnnouncements: boolean;
};

const DEFAULT_PREFS: NotifPrefs = {
  gameReminders: false,
  checkinReminders: false,
  scoreAlerts: false,
  leagueAnnouncements: false,
};

export default function NotificationSettingsScreen({ navigation }: { navigation: any }) {
  const { activeLeague } = useLeague();
  const [prefs, setPrefs] = React.useState<NotifPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    SecureStore.getItemAsync(PREFS_KEY)
      .then((val) => {
        if (val) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(val) });
      })
      .finally(() => setLoading(false));
  }, []);

  async function savePrefs(updated: NotifPrefs) {
    setPrefs(updated);
    await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(updated));
  }

  async function handleGameRemindersToggle(val: boolean) {
    if (val) {
      const token = await registerForPushNotifications();
      if (!token && val) {
        // permission denied but local still works
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
      await cancelAllGameReminders();
    }
    await savePrefs({ ...prefs, gameReminders: val });
  }

  const rows: { key: keyof NotifPrefs; label: string; subtitle: string; icon: string; onToggle?: (val: boolean) => Promise<void> }[] = [
    {
      key: 'gameReminders',
      label: 'Game Reminders',
      subtitle: '2 hours before each game',
      icon: 'notifications-outline',
      onToggle: handleGameRemindersToggle,
    },
    {
      key: 'checkinReminders',
      label: 'Check-in Reminders',
      subtitle: 'Reminder to check in 24h before game',
      icon: 'checkmark-circle-outline',
    },
    {
      key: 'scoreAlerts',
      label: 'Score Alerts',
      subtitle: 'When your team\'s game goes final',
      icon: 'trophy-outline',
    },
    {
      key: 'leagueAnnouncements',
      label: 'League Announcements',
      subtitle: 'New posts and updates from your league',
      icon: 'megaphone-outline',
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
                value={prefs[row.key]}
                onValueChange={async (val) => {
                  if (row.onToggle) {
                    await row.onToggle(val);
                  } else {
                    await savePrefs({ ...prefs, [row.key]: val });
                  }
                }}
                trackColor={{ false: colors.bgInteractive, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </FocusCard>
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
});
