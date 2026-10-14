import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

type Props = {
  currentIndex: number;
  pageCount: number;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel: string;
  nextLabel: string;
  positionLabel: string;
  loop?: boolean;
  testID?: string;
};

const MAX_VISIBLE_DOTS = 7;

export function getPagerDotWindow(pageCount: number, currentIndex: number, maxVisible = MAX_VISIBLE_DOTS): number[] {
  const count = Math.max(0, Math.floor(pageCount));
  const windowSize = Math.max(1, Math.floor(maxVisible));
  if (count <= windowSize) return Array.from({ length: count }, (_, index) => index);
  const safeIndex = Math.max(0, Math.min(count - 1, Math.floor(currentIndex)));
  const half = Math.floor(windowSize / 2);
  const start = Math.max(0, Math.min(count - windowSize, safeIndex - half));
  return Array.from({ length: windowSize }, (_, offset) => start + offset);
}

export default function CarouselPager({
  currentIndex,
  pageCount,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  positionLabel,
  loop = false,
  testID = 'carousel-pager',
}: Props) {
  if (pageCount <= 1) return null;
  const safeIndex = Math.max(0, Math.min(pageCount - 1, currentIndex));
  const previousDisabled = !loop && safeIndex === 0;
  const nextDisabled = !loop && safeIndex === pageCount - 1;
  const dots = getPagerDotWindow(pageCount, safeIndex);
  const runPrevious = () => { if (!previousDisabled) onPrevious(); };
  const runNext = () => { if (!nextDisabled) onNext(); };

  return (
    <View testID={testID} style={styles.controls}>
      <Pressable
        testID={`${testID}-previous`}
        accessibilityRole="button"
        accessibilityLabel={previousLabel}
        accessibilityState={{ disabled: previousDisabled }}
        disabled={previousDisabled}
        onPress={runPrevious}
        style={[styles.arrow, previousDisabled && styles.disabled]}
      >
        <Ionicons name="chevron-back" size={20} color={previousDisabled ? '#68778C' : '#DCE4F0'} />
      </Pressable>
      <View
        testID={`${testID}-position`}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={positionLabel}
        accessibilityActions={[
          { name: 'increment', label: nextLabel },
          { name: 'decrement', label: previousLabel },
        ]}
        accessibilityValue={{ min: 1, max: pageCount, now: safeIndex + 1, text: `${safeIndex + 1} of ${pageCount}` }}
        aria-valuemin={1}
        aria-valuemax={pageCount}
        aria-valuenow={safeIndex + 1}
        aria-valuetext={`${safeIndex + 1} of ${pageCount}`}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') runNext();
          if (event.nativeEvent.actionName === 'decrement') runPrevious();
        }}
        style={styles.position}
      >
        {dots.map((index) => (
          <View
            key={index}
            testID={`${testID}-dot-${index}`}
            style={[styles.dot, index === safeIndex && styles.dotActive]}
          />
        ))}
      </View>
      <Pressable
        testID={`${testID}-next`}
        accessibilityRole="button"
        accessibilityLabel={nextLabel}
        accessibilityState={{ disabled: nextDisabled }}
        disabled={nextDisabled}
        onPress={runNext}
        style={[styles.arrow, nextDisabled && styles.disabled]}
      >
        <Ionicons name="chevron-forward" size={20} color={nextDisabled ? '#68778C' : '#DCE4F0'} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    width: '100%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  arrow: {
    width: 44,
    height: 44,
    minHeight: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  position: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#536276' },
  dotActive: { width: 24, backgroundColor: '#C8B8FF' },
});
