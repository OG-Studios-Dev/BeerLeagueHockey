import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import colors from '../theme/colors';
import { ui } from '../theme/ui';

export type AccessibleChoice<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  accessibilityLabel: string;
  options: readonly AccessibleChoice<T>[];
  selectedValue: T;
  onSelect: (value: T) => void;
};

export default function AccessibleChoiceGroup<T extends string>({
  accessibilityLabel,
  options,
  selectedValue,
  onSelect,
}: Props<T>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={styles.group}>
      {options.map((option) => {
        const selected = selectedValue === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            hitSlop={4}
            onPress={() => onSelect(option.value)}
            style={[styles.choice, selected && styles.choiceSelected]}
          >
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choice: {
    minHeight: ui.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
  },
  choiceSelected: {
    borderColor: colors.primary + '50',
    backgroundColor: colors.primary + '1A',
  },
  choiceText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  choiceTextSelected: {
    color: colors.primary,
  },
});
