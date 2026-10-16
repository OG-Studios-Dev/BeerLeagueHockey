import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CheckinStatus } from '../lib/supabase/checkins';
import colors from '../theme/colors';
import BeerGuyToggle, { type BeerGuyToggleProps } from './BeerGuyToggle';
import { SelectableControl, SelectableControlGroup, type SelectableControlTone } from './SelectableControl';

type QuickCheckinActionsProps = {
  value: CheckinStatus | null;
  onChange: (status: CheckinStatus) => void;
  disabled?: boolean;
  compact?: boolean;
  beerGuy?: Omit<BeerGuyToggleProps, 'compact'>;
};

const OPTIONS: Array<{
  key: CheckinStatus;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: SelectableControlTone;
  color: string;
}> = [
  { key: 'confirmed', label: 'In', icon: 'checkmark', tone: 'success', color: colors.accentGreen },
  { key: 'tentative', label: 'Maybe', icon: 'help', tone: 'warning', color: '#F59E0B' },
  { key: 'out', label: 'Out', icon: 'close', tone: 'danger', color: colors.accentRed },
];

export default function QuickCheckinActions({
  value,
  onChange,
  disabled = false,
  compact = false,
  beerGuy,
}: QuickCheckinActionsProps) {
  return (
    <View style={styles.clip}>
      <SelectableControlGroup role="radiogroup" accessibilityLabel="Check-in status" horizontal={false} contentContainerStyle={[styles.row, compact && styles.rowCompact]}>
        {OPTIONS.map((option) => {
          const selected = value === option.key;
          return (
            <SelectableControl
              key={option.key}
              role="radio"
              label={option.label}
              accessibilityLabel={`Check in: ${option.label}`}
              selected={selected}
              disabled={disabled}
              tone={option.tone}
              compact={compact}
              onPress={() => onChange(option.key)}
              style={styles.button}
            >
              <Ionicons name={option.icon} size={compact ? 13 : 14} color={selected ? option.color : colors.textSecondary} />
              <Text style={[styles.buttonText, compact && styles.buttonTextCompact, selected && styles.selectedText]}>{option.label}</Text>
            </SelectableControl>
          );
        })}
      </SelectableControlGroup>
      {beerGuy ? (
        <View style={styles.beerGuyWrap}>
          <BeerGuyToggle {...beerGuy} compact={compact} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { width: '100%', overflow: 'hidden' },
  row: { flexWrap: 'wrap' },
  rowCompact: { gap: 6 },
  beerGuyWrap: { marginTop: 8 },
  button: { flexGrow: 1, flexBasis: 0, minWidth: 84 },
  buttonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '800' },
  buttonTextCompact: { fontSize: 12 },
  selectedText: { color: colors.textPrimary },
});
