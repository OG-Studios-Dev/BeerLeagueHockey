import React from 'react';
import { Image, type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';

import humpMask from '../../assets/season-completion-mask.png';
import colors from '../theme/colors';

export default function SeasonCompletionHump({ percentage, playoffMode, accentColor, reduceTransparency }: {
  percentage: number; playoffMode: boolean; accentColor: string; reduceTransparency: boolean;
}) {
  const [width, setWidth] = React.useState(800);
  const fill = playoffMode ? 100 : Math.max(0, Math.min(100, percentage));
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.max(1, event.nativeEvent.layout.width));
  return <View
    accessibilityRole="progressbar"
    accessibilityLabel="Season Completion"
    accessibilityValue={{ min: 0, max: 100, now: playoffMode ? 100 : percentage, text: playoffMode ? 'Playoffs' : `${percentage}%` }}
    onLayout={onLayout}
    style={styles.container}
  >
    <Image source={humpMask} resizeMode="stretch" tintColor={reduceTransparency ? colors.textSecondary : colors.bgInteractive} style={[styles.mask, { width }]} />
    <View style={[styles.fillClip, { width: `${fill}%` }]}>
      <Image source={humpMask} resizeMode="stretch" tintColor={accentColor} style={[styles.mask, { width, opacity: reduceTransparency ? 0.52 : 0.28 }]} />
    </View>
    <View pointerEvents="none" style={styles.labelWrap}><Text style={[styles.label, playoffMode && { color: accentColor }]}>{playoffMode ? 'PLAYOFFS' : `${percentage}%`}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', aspectRatio: 800 / 180, position: 'relative', overflow: 'hidden' },
  mask: { position: 'absolute', left: 0, top: 0, height: '100%' },
  fillClip: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  labelWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingTop: 26 },
  label: { color: colors.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
});
