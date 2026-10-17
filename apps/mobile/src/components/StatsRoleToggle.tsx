import React from 'react';
import { Image, Pressable, StyleSheet, View, type AccessibilityRole } from 'react-native';

import goalieRoleArt from '../../assets/stats-role/goalie-c.png';
import playerRoleArt from '../../assets/stats-role/player-a.png';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { getSurfacePalette } from '../theme/ui';

export type StatsRole = 'player' | 'goalie';

type Props = {
  role: StatsRole;
  onSelectRole: (role: StatsRole) => void;
};

function HockeyPlayerIcon() {
  return <Image testID="stats-role-icon-player" accessible={false} alt="" source={playerRoleArt} resizeMode="contain" style={styles.roleArtwork} />;
}

function GoalieMaskIcon() {
  return <Image testID="stats-role-icon-goalie" accessible={false} alt="" source={goalieRoleArt} resizeMode="contain" style={styles.roleArtwork} />;
}

export default function StatsRoleToggle({ role, onSelectRole }: Props) {
  const { reduceTransparency } = useAccessibilityPreferences();
  const surfaces = getSurfacePalette(reduceTransparency);
  return (
    <View
      testID="stats-role-toggle"
      accessibilityRole={'tablist' as AccessibilityRole}
      accessibilityLabel="Stats role"
      style={[styles.group, reduceTransparency && { backgroundColor: surfaces.surface, borderColor: surfaces.stroke }]}
    >
      <Pressable
        testID="stats-role-option-player"
        accessibilityRole="tab"
        accessibilityLabel="Player stats"
        accessibilityState={{ selected: role === 'player' }}
        aria-selected={role === 'player'}
        onPress={() => onSelectRole('player')}
        style={({ pressed }) => [
          styles.option,
          role === 'player' ? styles.playerSelected : styles.inactive,
          reduceTransparency && { backgroundColor: role === 'player' ? surfaces.elevated : surfaces.interactive },
          pressed && !reduceTransparency && styles.pressed,
          pressed && reduceTransparency && { opacity: 1, backgroundColor: role === 'player' ? surfaces.interactive : surfaces.surface, borderColor: role === 'player' ? '#C8B8FF' : '#61E2E8' },
        ]}
      >
        <HockeyPlayerIcon />
      </Pressable>
      <Pressable
        testID="stats-role-option-goalie"
        accessibilityRole="tab"
        accessibilityLabel="Goalie stats"
        accessibilityState={{ selected: role === 'goalie' }}
        aria-selected={role === 'goalie'}
        onPress={() => onSelectRole('goalie')}
        style={({ pressed }) => [
          styles.option,
          role === 'goalie' ? styles.goalieSelected : styles.inactive,
          reduceTransparency && { backgroundColor: role === 'goalie' ? surfaces.elevated : surfaces.interactive },
          pressed && !reduceTransparency && styles.pressed,
          pressed && reduceTransparency && { opacity: 1, backgroundColor: role === 'goalie' ? surfaces.interactive : surfaces.surface, borderColor: role === 'goalie' ? '#C8B8FF' : '#61E2E8' },
        ]}
      >
        <GoalieMaskIcon />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    width: 92,
    maxWidth: 92,
    minWidth: 92,
    height: 44,
    minHeight: 44,
    flexDirection: 'row',
    borderColor: 'rgba(126,184,215,0.34)',
    borderRadius: 22,
    backgroundColor: 'rgba(4,14,25,0.72)',
  },
  option: {
    width: 44,
    minWidth: 44,
    height: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 20,
  },
  inactive: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  playerSelected: {
    borderColor: '#61E2E8',
    backgroundColor: 'rgba(97,226,232,0.18)',
  },
  goalieSelected: {
    borderColor: '#A78BFA',
    backgroundColor: 'rgba(142,127,255,0.24)',
  },
  pressed: { opacity: 0.7 },
  roleArtwork: { width: 36, height: 36 },
});
