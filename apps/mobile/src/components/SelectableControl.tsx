import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import colors from '../theme/colors';

export type SelectableControlRole = 'button' | 'tab' | 'radio' | 'checkbox';
export type SelectableControlGroupRole = 'tablist' | 'radiogroup' | 'group';
export type SelectableControlTone = 'default' | 'success' | 'warning' | 'danger';

type ControlProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  role?: SelectableControlRole;
  disabled?: boolean;
  tone?: SelectableControlTone;
  compact?: boolean;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

type GroupProps = {
  accessibilityLabel: string;
  children: React.ReactNode;
  role?: SelectableControlGroupRole;
  horizontal?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

const toneStyles: Record<Exclude<SelectableControlTone, 'default'>, ViewStyle> = {
  success: { borderColor: 'rgba(34,197,94,0.7)' },
  warning: { borderColor: 'rgba(245,158,11,0.75)' },
  danger: { borderColor: 'rgba(239,68,68,0.72)' },
};

export function SelectableControlGroup({
  accessibilityLabel,
  children,
  role = 'radiogroup',
  horizontal = true,
  style,
  contentContainerStyle,
  testID,
}: GroupProps) {
  const accessibilityRole = role as AccessibilityRole;
  if (!horizontal) {
    return (
      <View testID={testID} accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel} style={[styles.group, style, contentContainerStyle]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      testID={testID}
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      style={style}
      contentContainerStyle={[styles.group, contentContainerStyle]}
    >
      {children}
    </ScrollView>
  );
}

export function SelectableControl({
  label,
  selected,
  onPress,
  accessibilityLabel = label,
  role = 'radio',
  disabled = false,
  tone = 'default',
  compact = false,
  children,
  style,
  textStyle,
  testID,
}: ControlProps) {
  const [focused, setFocused] = React.useState(false);
  const isSelected = selected === true;
  const isStateful = selected !== undefined;
  const isCheckable = role === 'radio' || role === 'checkbox';
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: isStateful ? isSelected : undefined, disabled, ...(isCheckable ? { checked: isStateful ? isSelected : undefined } : {}) }}
      aria-selected={role === 'tab' && isStateful ? isSelected : undefined}
      aria-checked={(role === 'radio' || role === 'checkbox') && isStateful ? isSelected : undefined}
      aria-pressed={role === 'button' && isStateful ? isSelected : undefined}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => { if (!disabled) onPress(); }}
      style={({ pressed }) => [
        styles.control,
        compact && styles.compact,
        style,
        isSelected ? styles.selected : styles.inactive,
        isSelected && tone !== 'default' && toneStyles[tone],
        focused && styles.focused,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {children ?? <Text maxFontSizeMultiplier={1.3} style={[styles.label, textStyle, isSelected ? styles.labelSelected : styles.labelInactive]}>{label}</Text>}
      {isSelected ? <Text testID={testID ? `${testID}-selected-mark` : undefined} accessible={false} style={styles.selectedMark}>✓</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    minWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  control: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  compact: { paddingHorizontal: 11 },
  inactive: {
    backgroundColor: colors.bgInteractive,
    borderColor: colors.glassStrokeStrong,
    borderWidth: 1,
  },
  selected: {
    backgroundColor: 'rgba(142,127,255,0.28)',
    borderColor: '#A78BFA',
    borderWidth: 1,
  },
  focused: {
    borderWidth: 2,
    borderColor: '#C8B8FF',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  label: { fontSize: 12, lineHeight: 17, fontWeight: '800', textAlign: 'center' },
  labelInactive: { color: colors.textSecondary },
  labelSelected: { color: colors.textPrimary },
  selectedMark: { color: '#F7FBFF', fontSize: 11, lineHeight: 14, fontWeight: '900' },
});
