import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BeerGuyAssignment } from '../lib/supabase/beerGuy';
import colors from '../theme/colors';

export type BeerGuyToggleProps = {
  assignment: BeerGuyAssignment | null;
  currentUserId: string | null;
  callerEligible: boolean | null;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  compact?: boolean;
  onToggle: () => void;
};

export default function BeerGuyToggle({
  assignment,
  currentUserId,
  callerEligible,
  loading = false,
  busy = false,
  error = null,
  compact = false,
  onToggle,
}: BeerGuyToggleProps) {
  const checked = Boolean(currentUserId && assignment?.player_id === currentUserId);
  const heldByOther = Boolean(assignment?.player_id && !checked);
  const disabled = loading || busy || callerEligible !== true || heldByOther;
  const holderName = assignment?.player_name?.trim() || 'another player';
  const accessibilityLabel = heldByOther ? `Beer Guy, assigned to ${holderName}` : 'Beer Guy';
  const accessibilityHint = checked
    ? 'Clear Beer Guy. You will remain checked in as In.'
    : heldByOther
      ? `${holderName} already has Beer Guy for this game.`
      : callerEligible === true
        ? 'Claim Beer Guy and check in as In.'
        : 'Beer Guy is unavailable for this game.';
  const detail = busy
    ? 'Updating…'
    : error
      ? error
      : checked
        ? 'You’re Beer Guy'
        : heldByOther
          ? `Assigned to ${holderName}`
          : loading
            ? 'Checking assignment…'
            : callerEligible === true
              ? 'Claim beer duty'
              : 'Not eligible';

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ checked, disabled, busy }}
        disabled={disabled}
        onPress={() => { if (!disabled) onToggle(); }}
        style={({ pressed }) => [
          styles.control,
          compact && styles.controlCompact,
          checked && styles.controlChecked,
          heldByOther && styles.controlAssigned,
          pressed && !disabled && styles.controlPressed,
          disabled && styles.controlDisabled,
        ]}
      >
        <Ionicons
          name="beer-outline"
          size={compact ? 17 : 19}
          color={checked ? colors.brandGold : colors.textSecondary}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.copy}>
          <Text style={[styles.label, compact && styles.labelCompact, checked && styles.labelChecked]}>Beer Guy</Text>
          <Text accessibilityLiveRegion={error ? 'polite' : undefined} style={[styles.detail, error && styles.error]}>
            {detail}
          </Text>
        </View>
        <View accessible={false} style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? <Ionicons name="checkmark" size={14} color="#07111F" accessible={false} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  control: {
    minHeight: 44,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    backgroundColor: colors.bgInteractive,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  controlCompact: { paddingHorizontal: 10, gap: 7 },
  controlChecked: { borderColor: colors.brandGold, backgroundColor: 'rgba(212,175,55,0.14)' },
  controlAssigned: { borderColor: colors.glassStrokeStrong },
  controlPressed: { opacity: 0.72 },
  controlDisabled: { opacity: 0.58 },
  copy: { flex: 1, minWidth: 0 },
  label: { color: colors.textPrimary, fontSize: 13, lineHeight: 17, fontWeight: '900' },
  labelCompact: { fontSize: 12 },
  labelChecked: { color: colors.brandGold },
  detail: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  error: { color: colors.accentRed },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { borderColor: colors.brandGold, backgroundColor: colors.brandGold },
});
