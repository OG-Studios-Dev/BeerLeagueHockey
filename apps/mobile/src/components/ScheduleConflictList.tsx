import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import type { ConflictWatchGame, ScheduleConflict } from '../lib/scheduleConflicts';
import colors from '../theme/colors';
import { getSurfacePalette } from '../theme/ui';

type ScheduleConflictListProps = {
  conflicts: ScheduleConflict[];
  onOpenGame: (game: ConflictWatchGame) => void;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getSeverityMeta(severity: ScheduleConflict['severity']) {
  if (severity === 'overlap') {
    return {
      icon: 'warning-outline' as const,
      color: colors.accentRed,
      backgroundColor: 'rgba(239, 68, 68, 0.16)',
    };
  }

  if (severity === 'tight') {
    return {
      icon: 'swap-horizontal-outline' as const,
      color: '#F59E0B',
      backgroundColor: 'rgba(245, 158, 11, 0.16)',
    };
  }

  return {
    icon: 'albums-outline' as const,
    color: colors.primary,
    backgroundColor: 'rgba(34, 211, 238, 0.16)',
  };
}

export default function ScheduleConflictList({ conflicts, onOpenGame }: ScheduleConflictListProps) {
  const { reduceTransparency } = useAccessibilityPreferences();
  const surfaces = getSurfacePalette(reduceTransparency);
  return (
    <View style={styles.list}>
      {conflicts.map((conflict) => {
        const severityMeta = getSeverityMeta(conflict.severity);

        return (
          <View key={conflict.key} style={[styles.card, { backgroundColor: surfaces.surface, borderColor: surfaces.stroke }]}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.dateLabel}>{conflict.dateLabel}</Text>
                <Text style={styles.subtitle}>{conflict.subtitle}</Text>
              </View>
              <View style={[styles.severityPill, { backgroundColor: severityMeta.backgroundColor }]}>
                <Ionicons name={severityMeta.icon} size={14} color={severityMeta.color} />
                <Text style={[styles.severityText, { color: severityMeta.color }]}>{conflict.title}</Text>
              </View>
            </View>

            <View style={styles.gamesList}>
              {conflict.games.map((game) => (
                <Pressable key={game.id} style={styles.gameRow} onPress={() => onOpenGame(game)}>
                  <View style={styles.timeWrap}>
                    <Text style={styles.timeText}>{formatTime(game.scheduled_at)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.gameTeamName} numberOfLines={1}>
                      {game.teamName}
                    </Text>
                    <Text style={styles.gameMeta} numberOfLines={1}>
                      {game.leagueName}
                      {game.location ? ` · ${game.location}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 14,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  dateLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  severityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  severityText: {
    fontSize: 12,
    fontWeight: '800',
  },
  gamesList: {
    gap: 10,
  },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 2,
  },
  timeWrap: {
    width: 58,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  gameTeamName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  gameMeta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
