import React from 'react';
import { StyleSheet } from 'react-native';

import { SelectableControl, SelectableControlGroup } from './SelectableControl';

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
    <SelectableControlGroup
      role="radiogroup"
      accessibilityLabel={accessibilityLabel}
      horizontal={false}
      contentContainerStyle={styles.group}
    >
      {options.map((option) => (
        <SelectableControl
          key={option.value}
          role="radio"
          label={option.label}
          accessibilityLabel={option.label}
          selected={selectedValue === option.value}
          onPress={() => onSelect(option.value)}
        />
      ))}
    </SelectableControlGroup>
  );
}

const styles = StyleSheet.create({
  group: { flexWrap: 'wrap' },
});
