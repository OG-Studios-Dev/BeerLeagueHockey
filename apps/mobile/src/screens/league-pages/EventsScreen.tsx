import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FocusCard } from '../../components/CardFocus';
import { eventGroups, normalizeTimeZone } from '../../lib/eventsContactModel';
import type { LeagueEvent } from '../../lib/leagueContent';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { commonStyles, LeaguePageFrame, PageHeader, PageLoadState, useLeaguePageScope } from './LeaguePageCommon';
import { useLeagueContent } from './ContentPageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'Events'>;

function EventCard({ event, timeZone }: { event: LeagueEvent; timeZone: string }) {
  const date = new Date(event.startTime);
  const when = date.toLocaleString('en-CA', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return <FocusCard focusId={`league-event:${event.id}`} style={[commonStyles.card, styles.card]}>
    <View style={styles.cardTop}><Text style={styles.type}>{event.eventType}</Text><Ionicons name="calendar-outline" size={20} color={colors.textInteractive} /></View>
    <Text style={styles.eventTitle}>{event.title}</Text>
    <Text style={styles.when}>{when}</Text>
    {event.endTime ? <Text style={styles.meta}>Ends {new Date(event.endTime).toLocaleString('en-CA', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</Text> : null}
    <Text style={styles.meta}>{event.location ?? 'Location not provided'}</Text>
    {event.description ? <Text style={styles.description}>{event.description}</Text> : null}
  </FocusCard>;
}

export default function EventsScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const page = useLeagueContent(scope, { view: 'events' });
  if (!page.data) return <LeaguePageFrame onAccessibilityEscape={() => navigation.goBack()}><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;
  const data = page.data;
  const timeZone = normalizeTimeZone(data.timeZone);
  const groups = eventGroups(data.events, data.generatedAt);
  return <LeaguePageFrame onAccessibilityEscape={() => navigation.goBack()}>
    <PageHeader eyebrow="League calendar" title="Events" detail={`${data.total} published event${data.total === 1 ? '' : 's'} · Times shown in ${timeZone}${timeZone === 'UTC' && data.timeZone !== 'UTC' ? ' (league timezone unavailable)' : ''}`} />
    {data.events.length === 0 ? <View style={styles.empty}><Ionicons name="calendar-outline" size={54} color={colors.textInteractive} /><Text style={styles.emptyTitle}>No published events</Text><Text style={styles.meta}>This league has not published any events in the current window.</Text></View> : null}
    {([['Happening now', groups.happeningNow], ['Upcoming', groups.upcoming], ['Recent', groups.recent]] as const).map(([title, events]) => events.length ? <View key={title} style={commonStyles.section}><Text style={commonStyles.sectionTitle}>{title}</Text>{events.map(event => <EventCard key={event.id} event={event} timeZone={timeZone} />)}</View> : null)}
  </LeaguePageFrame>;
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  type: { color: colors.textInteractive, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  eventTitle: { color: colors.textPrimary, fontSize: 20, lineHeight: 26, fontWeight: '900', marginTop: 7 },
  when: { color: colors.textPrimary, fontSize: 14, lineHeight: 21, fontWeight: '800', marginTop: 8 },
  meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 4 },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 10 },
  empty: { minHeight: 260, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', marginTop: 12 },
});
