import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import Avatar from './Avatar';
import colors from '../theme/colors';
import { getSurfacePalette } from '../theme/ui';

type StatItem = {
  label: string;
  value: string | number;
};

type PlayerRowProps = {
  rank: number;
  name: string;
  teamShortName: string;
  stats: StatItem[];
  highlight?: boolean;
  avatarUrl?: string | null;
  onPress?: () => void;
};

export default function PlayerRow({
  rank,
  name,
  teamShortName,
  stats,
  highlight = false,
  avatarUrl,
  onPress,
}: PlayerRowProps) {
  const { reduceTransparency } = useAccessibilityPreferences();
  const surfaces = getSurfacePalette(reduceTransparency);
  return (
    <Pressable onPress={onPress} style={[styles.container, { borderColor: surfaces.stroke }, highlight ? styles.highlightContainer : undefined]}>
      <Text style={[styles.rank, highlight ? styles.rankHighlight : undefined]}>{rank}</Text>

      <Avatar uri={avatarUrl ?? null} name={name} size={32} />

      <View style={styles.nameWrap}>
        <Text style={styles.name}>{name}</Text>
        <View style={styles.teamBadge}>
          <Text style={styles.teamBadgeText}>{teamShortName}</Text>
        </View>
      </View>

      <View style={styles.statsWrap}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.statCol}>
            <Text style={styles.statLabel}>{stat.label}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgInteractive,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.borderCard,
    gap: 8,
  },
  highlightContainer: {
    borderColor: colors.primary,
    backgroundColor: colors.bgInteractive,
  },
  rank: {
    width: 24,
    fontSize: 17,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  rankHighlight: {
    color: colors.primary,
  },
  nameWrap: {
    flex: 1,
    marginLeft: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  teamBadge: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.bgInteractive,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  teamBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  statsWrap: {
    flexDirection: 'row',
    gap: 12,
  },
  statCol: {
    minWidth: 36,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  statValue: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
});
