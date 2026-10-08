import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CheckinStatus } from '../lib/supabase/checkins';
import colors from '../theme/colors';

type QuickCheckinActionsProps = {
  value: CheckinStatus | null;
  onChange: (status: CheckinStatus) => void;
  disabled?: boolean;
  compact?: boolean;
};

const OPTIONS: Array<{
  key: CheckinStatus;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeBackground: string;
  activeText: string;
}> = [
  { key: 'confirmed', label: 'In', icon: 'checkmark', activeBackground: colors.accentGreen, activeText: '#000000' },
  { key: 'tentative', label: 'Maybe', icon: 'help', activeBackground: '#F59E0B', activeText: '#000000' },
  { key: 'out', label: 'Out', icon: 'close', activeBackground: colors.accentRed, activeText: '#FFFFFF' },
];

export default function QuickCheckinActions({
  value,
  onChange,
  disabled = false,
  compact = false,
}: QuickCheckinActionsProps) {
  return (
    <View style={[styles.row, compact ? styles.rowCompact : undefined]}>
      {OPTIONS.map((option) => {
        const selected = value === option.key;
        const textColor = selected ? option.activeText : colors.textSecondary;

        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityLabel={`Check in: ${option.label}`}
            accessibilityState={{ selected, disabled }}
            style={({ pressed }) => [
              styles.button,
              compact ? styles.buttonCompact : undefined,
              selected
                ? { backgroundColor: option.activeBackground, borderColor: option.activeBackground }
                : styles.buttonIdle,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => onChange(option.key)}
            disabled={disabled}
          >
            <Ionicons name={option.icon} size={compact ? 13 : 14} color={textColor} />
            <Text style={[styles.buttonText, compact ? styles.buttonTextCompact : undefined, { color: textColor }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rowCompact: { gap: 6 },
  button: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 84,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  buttonCompact: {
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  buttonIdle: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.glassStroke,
  },
  buttonPressed: {
    transform: [{ scale: 0.985 }],
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  buttonTextCompact: {
    fontSize: 12,
  },
});
