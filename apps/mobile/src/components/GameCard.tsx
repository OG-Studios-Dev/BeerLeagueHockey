import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { addGameToCalendar } from '../lib/calendar';
import colors from '../theme/colors';
import { getHomeVisualPreferences } from '../theme/home';
import { ui } from '../theme/ui';
import GlassSurface from './GlassSurface';

export type GameStatus = 'Upcoming' | 'Live' | 'Final';

type GameCardProps = {
  gameId?: string;
  homeTeam: string;
  awayTeam: string;
  dateLabel: string;
  timeLabel: string;
  rinkName: string;
  status: GameStatus;
  homeScore?: number;
  awayScore?: number;
  scheduledAt?: string;
  location?: string | null;
  compact?: boolean;
  visualVariant?: 'default' | 'homeEditorial';
  reduceTransparency?: boolean;
  onPress?: () => void;
};

function getStatusStyle(status: GameStatus) {
  if (status === 'Live') {
    return { backgroundColor: colors.badgeLiveBg, textColor: colors.badgeLiveText };
  }
  if (status === 'Final') {
    return { backgroundColor: colors.badgeFinalBg, textColor: colors.badgeFinalText };
  }
  return { backgroundColor: colors.badgeUpcomingBg, textColor: colors.badgeUpcomingText };
}

export default function GameCard({
  gameId,
  homeTeam,
  awayTeam,
  dateLabel,
  timeLabel,
  rinkName,
  status,
  homeScore,
  awayScore,
  scheduledAt,
  location,
  compact = false,
  visualVariant = 'default',
  reduceTransparency = false,
  onPress,
}: GameCardProps) {
  const statusStyle = getStatusStyle(status);
  const isHomeEditorial = visualVariant === 'homeEditorial';
  const homeVisuals = getHomeVisualPreferences(reduceTransparency, false);
  const showScore =
    (status === 'Final' || status === 'Live') &&
    typeof homeScore === 'number' &&
    typeof awayScore === 'number';

  async function handleAddToCalendar() {
    if (!scheduledAt) return;
    await addGameToCalendar({
      homeTeam,
      awayTeam,
      scheduledAt,
      location: location ?? null,
    });
  }

  const cardContent = (
    <GlassSurface
      style={[
        styles.card,
        isHomeEditorial
          ? { backgroundColor: homeVisuals.surface, borderColor: homeVisuals.stroke }
          : undefined,
      ]}
    >
      <LinearGradient
        colors={isHomeEditorial
          ? [homeVisuals.surfaceTop, homeVisuals.surfaceBottom]
          : ['rgba(255,255,255,0.08)', 'transparent', 'rgba(79,216,255,0.08)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cardGlow}
      />
      <View style={[styles.dateStrip, compact ? styles.compactDateStrip : undefined]}>
        <LinearGradient
          colors={isHomeEditorial
            ? [homeVisuals.surfaceTop, homeVisuals.surfaceBottom]
            : ['rgba(79,216,255,0.18)', 'rgba(108,124,255,0.08)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.dateText}>{dateLabel}</Text>
        <Text style={styles.timeText}>{timeLabel}</Text>
      </View>

      <View style={[styles.mainContent, compact ? styles.compactMainContent : undefined]}>
        <View style={styles.topRow}>
          <View style={[styles.badge, { backgroundColor: statusStyle.backgroundColor }]}>
            <Text style={[styles.badgeText, { color: statusStyle.textColor }]}>{status}</Text>
          </View>
          <Text style={styles.rinkText} numberOfLines={isHomeEditorial ? undefined : 1}>{rinkName}</Text>
        </View>

        <View style={styles.teamsWrap}>
          <View style={styles.teamRow}>
            <Text
              style={[styles.teamName, compact ? styles.compactTeamName : undefined]}
              numberOfLines={isHomeEditorial ? undefined : 1}
            >
              {awayTeam}
            </Text>
            {showScore ? <Text style={[styles.score, compact ? styles.compactScore : undefined]}>{awayScore}</Text> : null}
          </View>
          <View style={styles.teamRow}>
            <Text
              style={[styles.teamName, compact ? styles.compactTeamName : undefined]}
              numberOfLines={isHomeEditorial ? undefined : 1}
            >
              {homeTeam}
            </Text>
            {showScore ? <Text style={[styles.score, compact ? styles.compactScore : undefined]}>{homeScore}</Text> : null}
          </View>
        </View>

        {status === 'Upcoming' && scheduledAt && !compact && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${awayTeam} at ${homeTeam} to calendar`}
            hitSlop={4}
            style={styles.calendarBtn}
            onPress={handleAddToCalendar}
          >
            <Ionicons name="calendar-outline" size={13} color={colors.primary} />
            <Text style={styles.calendarBtnText}>Add to Calendar</Text>
          </Pressable>
        )}
      </View>
    </GlassSurface>
  );

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.shadowWrap,
        compact ? styles.compactShadowWrap : undefined,
        isHomeEditorial ? styles.homeEditorialShadowWrap : undefined,
        pressed && styles.shadowWrapPressed,
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      {cardContent}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    marginVertical: 4,
    borderRadius: ui.radius.card,
    shadowColor: colors.brandRink,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  compactShadowWrap: {
    marginVertical: 3,
  },
  homeEditorialShadowWrap: {
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 0,
  },
  shadowWrapPressed: {
    transform: [{ scale: 0.988 }],
  },
  card: {
    flexDirection: 'row',
    borderRadius: ui.radius.card,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    overflow: 'hidden',
    minWidth: 0,
  },
  cardGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  dateStrip: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: colors.glassStroke,
    overflow: 'hidden',
  },
  compactDateStrip: {
    width: 62,
    paddingVertical: 8,
  },
  dateText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 12,
  },
  timeText: {
    color: colors.textSecondary,
    marginTop: 4,
    fontWeight: '600',
    fontSize: 11,
  },
  mainContent: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  compactMainContent: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  rinkText: {
    flex: 1,
    fontSize: 11,
    color: colors.textSecondary,
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  teamsWrap: {
    gap: 6,
    minWidth: 0,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  teamName: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 1,
    minWidth: 0,
    marginRight: 8,
  },
  compactTeamName: {
    fontSize: 14,
  },
  score: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textPrimary,
    minWidth: 22,
    textAlign: 'right',
  },
  compactScore: {
    fontSize: 20,
  },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    minHeight: ui.minTouchTarget,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.glassHighlight,
  },
  calendarBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
  },
});
