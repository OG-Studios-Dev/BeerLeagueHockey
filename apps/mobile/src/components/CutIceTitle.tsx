import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMobileShellData } from '../navigation/MobileShellDataContext';
import { resolveCutIcePalette, splitCutIceTitle } from './cutIceTitleModel';

export default function CutIceTitle({ title, onBack }: { title: string; onBack?: () => void }) {
  const { titleAccent } = useMobileShellData();
  const palette = resolveCutIcePalette(titleAccent);
  const parts = splitCutIceTitle(title);

  return (
    <View testID="cut-ice-title" accessibilityRole="header" accessibilityLabel={title} style={styles.frame}>
      <LinearGradient
        colors={['rgba(12,32,43,0.98)', 'rgba(6,19,28,0.96)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.blade, { backgroundColor: palette.source, shadowColor: palette.source }]} />
      <View style={[styles.slash, { borderLeftColor: `${palette.source}55`, backgroundColor: `${palette.source}0E` }]} />
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color="#F6FBFF" />
        </Pressable>
      ) : null}
      <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.title}>
        {parts.base ? `${parts.base.toUpperCase()} ` : ''}
        <Text style={{ color: palette.readable }}>{parts.accent.toUpperCase()}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 62,
    flexDirection: 'row', alignItems: 'center',
    overflow: 'hidden',
    paddingHorizontal: 22,
    backgroundColor: '#06131C',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(122,182,205,0.18)',
  },
  blade: {
    position: 'absolute', left: 10, top: 10, bottom: 10, width: 4,
    transform: [{ skewX: '-10deg' }], shadowOpacity: 0.72, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
  },
  slash: {
    position: 'absolute', right: -32, top: -10, width: 150, height: 82,
    borderLeftWidth: 1, transform: [{ skewX: '-25deg' }],
  },
  title: {
    flex: 1, color: '#F6FBFF', fontSize: 29, lineHeight: 34, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: -0.7, textTransform: 'uppercase', textShadowColor: '#000000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0,
  },
  backButton: { width: 44, height: 44, marginLeft: -10, marginRight: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
});
