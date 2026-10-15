import React from 'react';
import { Pressable, StyleSheet, View, type AccessibilityRole } from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { getSurfacePalette } from '../theme/ui';

export type StatsRole = 'player' | 'goalie';

type Props = {
  role: StatsRole;
  onSelectRole: (role: StatsRole) => void;
};

function HockeyPlayerIcon() {
  return (
    <View testID="stats-role-icon-player" accessible={false} style={styles.iconFrame}>
      <View style={styles.stickShaft} />
      <View style={styles.stickBlade} />
      <View style={styles.puck} />
    </View>
  );
}

function GoalieMaskIcon() {
  return (
    <View testID="stats-role-icon-goalie" accessible={false} style={styles.mask}>
      <View style={styles.maskBrow} />
      <View style={[styles.maskVent, styles.maskVentLeft]} />
      <View style={[styles.maskVent, styles.maskVentRight]} />
      <View style={styles.maskNose} />
      <View style={styles.maskCage} />
    </View>
  );
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
  iconFrame: { width: 25, height: 25 },
  stickShaft: {
    position: 'absolute',
    left: 10,
    top: 0,
    width: 3,
    height: 22,
    borderRadius: 2,
    backgroundColor: '#61E2E8',
    transform: [{ rotate: '-32deg' }],
  },
  stickBlade: {
    position: 'absolute',
    left: 13,
    bottom: 3,
    width: 10,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#61E2E8',
    transform: [{ rotate: '10deg' }],
  },
  puck: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 7,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#F4F8FB',
  },
  mask: {
    width: 23,
    height: 25,
    borderWidth: 2,
    borderColor: '#C8B8FF',
    borderRadius: 10,
  },
  maskBrow: {
    position: 'absolute',
    left: 3,
    right: 3,
    top: 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#C8B8FF',
  },
  maskVent: {
    position: 'absolute',
    top: 10,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C8B8FF',
  },
  maskVentLeft: { left: 4 },
  maskVentRight: { right: 4 },
  maskNose: {
    position: 'absolute',
    left: 9,
    top: 13,
    width: 2,
    height: 4,
    backgroundColor: '#C8B8FF',
  },
  maskCage: {
    position: 'absolute',
    left: 5,
    right: 5,
    bottom: 4,
    height: 3,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#C8B8FF',
  },
});
