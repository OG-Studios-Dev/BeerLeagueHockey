import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { Division } from '../lib/supabase/data';
import { SelectableControl, SelectableControlGroup } from './SelectableControl';

type Props = {
  divisions: Division[];
  activeDivision: Division | null;
  primaryColor: string;
  onSelect: (division: Division | null) => void;
};

export default function DivisionFilter({ divisions, activeDivision, primaryColor: _primaryColor, onSelect }: Props) {
  if (divisions.length <= 1) return null;

  return (
    <View style={styles.wrapper}>
      <SelectableControlGroup role="radiogroup" accessibilityLabel="Division filter" contentContainerStyle={styles.container}>
        <SelectableControl
          testID="division-filter-all"
          role="radio"
          label="All"
          accessibilityLabel="All divisions"
          selected={activeDivision === null}
          onPress={() => onSelect(null)}
        />
        {divisions.map((division) => (
          <SelectableControl
            key={division.id}
            testID={`division-filter-${division.id}`}
            role="radio"
            label={division.name}
            accessibilityLabel={`${division.name} division`}
            selected={activeDivision?.id === division.id}
            onPress={() => onSelect(division)}
          />
        ))}
      </SelectableControlGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 8 },
  container: { paddingHorizontal: 16, paddingVertical: 4 },
});
