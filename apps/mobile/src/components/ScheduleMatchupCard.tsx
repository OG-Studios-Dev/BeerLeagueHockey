import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { buildGamePresentation, resolveGameAccentColors } from '../lib/gamePresentation';
import type { GameRow } from '../lib/supabase/data';
import { getHomeVisualPreferences, HOME_VISUAL_TOKENS as homeTokens } from '../theme/home';
import TeamLogo from './TeamLogo';

type Props = {
  game: GameRow;
  timezone: string | null;
  leagueColor: string | null;
  reduceTransparency: boolean;
  onOpenGame: (gameId: string) => void;
  onAddToCalendar?: (game: GameRow) => void;
};

function teamName(game: GameRow, side: 'away' | 'home') {
  return game[`${side}_team`]?.name?.trim() || 'Team unavailable';
}

function accessibilityLabel(game: GameRow, timezone: string | null) {
  const facts = buildGamePresentation(game, timezone);
  const away = teamName(game, 'away');
  const home = teamName(game, 'home');
  const matchup = facts.showScore
    ? `${away} ${facts.awayScoreLabel ?? 'score unavailable'}. ${home} ${facts.homeScoreLabel ?? 'score unavailable'}.`
    : `${away} at ${home}.`;
  return `${facts.statusLabel}. ${matchup} ${facts.dateLabel ?? 'Date unavailable'}. ${facts.timeLabel ?? 'Time unavailable'}. ${facts.locationLabel ?? 'Venue unavailable'}.`;
}

export default function ScheduleMatchupCard({
  game,
  timezone,
  leagueColor,
  reduceTransparency,
  onOpenGame,
  onAddToCalendar,
}: Props) {
  const facts = buildGamePresentation(game, timezone);
  const preferences = getHomeVisualPreferences(reduceTransparency, false);
  const accents = resolveGameAccentColors(
    game.away_team?.primary_color,
    game.home_team?.primary_color,
    leagueColor,
  );
  const teams = [
    {
      side: 'away' as const,
      id: game.away_team_id,
      team: game.away_team,
      name: teamName(game, 'away'),
      score: facts.awayScoreLabel,
      accent: accents.away,
    },
    {
      side: 'home' as const,
      id: game.home_team_id,
      team: game.home_team,
      name: teamName(game, 'home'),
      score: facts.homeScoreLabel,
      accent: accents.home,
    },
  ];

  return (
    <View
      testID={`schedule-matchup-card-${game.id}`}
      style={[styles.card, { backgroundColor: preferences.surface, borderColor: preferences.stroke }]}
    >
      <View accessible={false} style={styles.accentRow}>
        <View style={[styles.accentHalf, { backgroundColor: accents.away }]} />
        <View style={[styles.accentHalf, { backgroundColor: accents.home }]} />
      </View>
      <Pressable
        testID={`schedule-matchup-card-body-${game.id}`}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel(game, timezone)}
        accessibilityHint="Opens game details"
        onPress={() => onOpenGame(game.id)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View testID="schedule-matchup-facts" style={styles.facts}>
          <Text style={styles.fact}>{facts.dateLabel ?? 'Date unavailable'}</Text>
          <Text style={[styles.fact, facts.statusLabel === 'Live' && styles.live]}>{facts.statusLabel}</Text>
          <Text style={styles.fact}>{facts.timeLabel ?? 'Time unavailable'}</Text>
          <Text testID="schedule-matchup-venue" style={styles.venue}>{facts.locationLabel ?? 'Venue unavailable'}</Text>
        </View>
        <View style={styles.teams}>
          {teams.map(({ side, id, team, name, score, accent }) => (
            <View key={side} testID={`schedule-team-row-${side}`} style={styles.teamRow}>
              <View accessible={false} style={[styles.rail, { backgroundColor: accent }]} />
              <TeamLogo
                decorative
                transparentBacking
                teamId={id}
                logoUrl={team?.logo_url ?? null}
                teamName={name}
                primaryColor={accent}
                size={44}
              />
              <Text testID={`schedule-team-name-${side}`} style={styles.teamName}>{name}</Text>
              {facts.showScore ? <Text testID={`schedule-team-score-${side}`} style={styles.score}>{score ?? '—'}</Text> : null}
            </View>
          ))}
        </View>
      </Pressable>
      {facts.canUseCalendar && onAddToCalendar ? (
        <View style={styles.actionRow}>
          <Pressable
            testID={`schedule-calendar-${game.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Add ${teamName(game, 'away')} at ${teamName(game, 'home')} to calendar`}
            onPress={() => onAddToCalendar(game)}
            style={({ pressed }) => [styles.calendarButton, pressed && styles.pressed]}
          >
            <Text style={styles.calendarText}>Add to calendar</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 0,
    borderRadius: homeTokens.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: 12,
  },
  accentRow: { height: 3, flexDirection: 'row' },
  accentHalf: { flex: 1, opacity: 0.82 },
  body: { minHeight: homeTokens.minTouchTarget },
  pressed: { opacity: 0.82 },
  facts: {
    minHeight: 44,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: homeTokens.stroke,
  },
  fact: { color: homeTokens.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  live: { color: '#FB7185' },
  venue: { width: '100%', color: homeTokens.text, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  teams: { paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  teamRow: { minHeight: 56, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rail: { alignSelf: 'stretch', width: 3, borderRadius: 2, opacity: 0.78 },
  teamName: { flex: 1, minWidth: 0, flexShrink: 1, color: homeTokens.text, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  score: { minWidth: 34, color: homeTokens.text, fontSize: 22, lineHeight: 28, fontWeight: '900', textAlign: 'right' },
  actionRow: { alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: homeTokens.stroke, paddingHorizontal: 10, paddingVertical: 4 },
  calendarButton: { minWidth: 132, minHeight: homeTokens.minTouchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12 },
  calendarText: { color: homeTokens.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800' },
});
