import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { supabase } from './supabase/client';

export const NOTIFICATION_PREFS_KEY = 'blh_notification_prefs';

function asError(error: unknown, fallback: string) {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return new Error(message);
  }
  return new Error(fallback);
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const token = (await Notifications.getExpoPushTokenAsync()).data;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return null;
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ push_token: token })
      .eq('id', user.id);
    if (updateError) return null;
  } catch {
    return null;
  }

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  return token;
}

export async function unregisterPushNotifications(): Promise<{ error: Error | null }> {
  let firstError: Error | null = null;

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (error) {
    firstError = asError(error, 'Unable to cancel notification reminders on this device');
  }

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      firstError ??= asError(userError, 'Unable to verify the notification destination owner');
    } else if (user) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ push_token: null })
        .eq('id', user.id);
      if (updateError) {
        firstError ??= asError(updateError, 'Unable to revoke the notification destination');
      }
    }
  } catch (error) {
    firstError ??= asError(error, 'Unable to revoke the notification destination');
  }

  if (!firstError) {
    try {
      await SecureStore.deleteItemAsync(NOTIFICATION_PREFS_KEY);
    } catch (error) {
      firstError = asError(error, 'Unable to clear notification preferences on this device');
    }
  }

  return { error: firstError };
}

export async function scheduleGameReminder(game: { id: string; scheduledAt: string; homeTeam: string; awayTeam: string }) {
  const gameTime = new Date(game.scheduledAt);
  const twoHoursBefore = new Date(gameTime.getTime() - 2 * 60 * 60 * 1000);
  if (twoHoursBefore <= new Date()) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Game Today!',
      body: `${game.awayTeam} @ ${game.homeTeam} starts in 2 hours`,
      data: { gameId: game.id },
    },
    trigger: { date: twoHoursBefore } as any,
  });
}

export async function cancelAllGameReminders() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
