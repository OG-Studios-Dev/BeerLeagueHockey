import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import colors from '../theme/colors';

type PillToggleProps<T extends string> = {
  options: readonly T[];
  selected: T;
  onChange: (next: T) => void;
};

export default function PillToggle<T extends string>({ options, selected, onChange }: PillToggleProps<T>) {
  return (
    <View style={styles.container}>
      {options.map((option) => {
        const isSelected = option === selected;

        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={option}
            accessibilityState={{ selected: isSelected }}
            aria-pressed={isSelected}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.pill,
              isSelected ? styles.pillSelected : styles.pillUnselected,
              pressed && styles.pillPressed,
            ]}
          >
            {isSelected ? (
              <LinearGradient
                colors={[colors.brandRink, colors.brandArena]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Text maxFontSizeMultiplier={1.3} style={[styles.label, isSelected ? styles.labelSelected : styles.labelUnselected]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 999,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    gap: 6,
  },
  pill: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pillSelected: {
    borderWidth: 0,
  },
  pillUnselected: {
    backgroundColor: colors.glassHighlight,
  },
  pillPressed: {
    transform: [{ scale: 0.985 }],
  },
  label: {
    fontWeight: '800',
    fontSize: 13,
  },
  labelSelected: {
    color: colors.textPrimary,
  },
  labelUnselected: {
    color: colors.textSecondary,
  },
});
