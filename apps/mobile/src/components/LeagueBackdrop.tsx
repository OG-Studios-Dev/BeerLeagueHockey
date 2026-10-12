import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { LEAGUE_VISUAL_TOKENS as leagueTokens } from '../theme/league';

export default function LeagueBackdrop({ accentColor }: { accentColor: string }) {
  const { reduceTransparency } = useAccessibilityPreferences();

  return (
    <View
      testID="league-backdrop"
      pointerEvents="none"
      style={[styles.backdrop, reduceTransparency && styles.backdropOpaque]}
    >
      {!reduceTransparency ? (
        <>
          <LinearGradient
            testID="league-backdrop-gradient"
            colors={[leagueTokens.canvas, leagueTokens.navy, leagueTokens.ink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            testID="league-atmospheric-glow"
            colors={[`${accentColor}24`, 'rgba(255,255,255,0.03)', 'transparent']}
            start={{ x: 0.05, y: 0 }}
            end={{ x: 0.9, y: 0.62 }}
            style={styles.glow}
          />
          <View testID="league-rink-lines" style={styles.rink}>
            <View style={styles.centerLine} />
            <View style={styles.centerCircle} />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  backdropOpaque: { backgroundColor: leagueTokens.canvas },
  glow: { position: 'absolute', top: -80, left: -60, right: -80, height: 360, borderRadius: 180 },
  rink: { position: 'absolute', width: 250, height: 470, right: -120, top: 120, borderWidth: 1, borderColor: leagueTokens.rinkLine, borderRadius: 125, transform: [{ rotate: '-10deg' }] },
  centerLine: { position: 'absolute', top: '50%', right: 0, left: 0, height: 1, backgroundColor: leagueTokens.rinkLine },
  centerCircle: { position: 'absolute', top: 191, left: 81, width: 86, height: 86, borderWidth: 1, borderColor: leagueTokens.rinkLine, borderRadius: 43 },
});
