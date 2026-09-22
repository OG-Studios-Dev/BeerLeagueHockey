import * as Calendar from 'expo-calendar';
import { Alert } from 'react-native';

export async function addGameToCalendar(game: {
  homeTeam: string;
  awayTeam: string;
  scheduledAt: string; // ISO string
  location: string | null;
}) {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission denied', 'Calendar access is needed to add games.');
    return false;
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  // Use default calendar or first writable one
  const defaultCalendar =
    calendars.find((c) => c.allowsModifications && c.type === 'local') ?? calendars[0];
  if (!defaultCalendar) return false;

  const startDate = new Date(game.scheduledAt);
  const endDate = new Date(startDate.getTime() + 90 * 60 * 1000); // 90 min game

  await Calendar.createEventAsync(defaultCalendar.id, {
    title: `${game.awayTeam} @ ${game.homeTeam}`,
    startDate,
    endDate,
    location: game.location ?? undefined,
    notes: 'Hockey Life game',
    alarms: [{ relativeOffset: -120 }, { relativeOffset: -30 }], // 2h and 30min reminders
  });

  Alert.alert('Added!', `Game added to your calendar with reminders.`);
  return true;
}
