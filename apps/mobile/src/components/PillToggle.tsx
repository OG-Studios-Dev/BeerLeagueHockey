import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  SelectableControl,
  SelectableControlGroup,
  type SelectableControlRole,
} from './SelectableControl';

type PillToggleProps<T extends string> = {
  options: readonly T[];
  selected: T;
  onChange: (next: T) => void;
  role?: SelectableControlRole;
  accessibilityLabel?: string;
};

export default function PillToggle<T extends string>({
  options,
  selected,
  onChange,
  role = 'button',
  accessibilityLabel = 'Options',
}: PillToggleProps<T>) {
  const groupRole = role === 'tab' ? 'tablist' : role === 'radio' ? 'radiogroup' : 'group';
  return (
    <View style={styles.frame}>
      <SelectableControlGroup role={groupRole} accessibilityLabel={accessibilityLabel} contentContainerStyle={styles.group}>
        {options.map((option) => (
          <SelectableControl
            key={option}
            label={option}
            accessibilityLabel={option}
            role={role}
            selected={option === selected}
            onPress={() => onChange(option)}
            style={styles.option}
          />
        ))}
      </SelectableControlGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden' },
  group: { paddingHorizontal: 0 },
  option: { flexGrow: 1, minWidth: 88 },
});
