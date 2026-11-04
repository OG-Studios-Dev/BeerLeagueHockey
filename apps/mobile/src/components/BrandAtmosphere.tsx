import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import colors from '../theme/colors';

type BrandAtmosphereProps = {
  accentColor?: string;
  secondaryColor?: string;
  intensity?: 'low' | 'medium' | 'high';
};

const OPACITY_MAP = {
  low: { top: '18', bottom: '12', orb: '10' },
  medium: { top: '28', bottom: '1A', orb: '14' },
  high: { top: '38', bottom: '24', orb: '1C' },
} as const;

const GRID_LINES = [12.5, 25, 37.5, 50, 62.5, 75, 87.5];

export default function BrandAtmosphere({
  accentColor = colors.brandRink,
  secondaryColor = colors.brandArena,
  intensity = 'medium',
}: BrandAtmosphereProps) {
  const { reduceTransparency } = useAccessibilityPreferences();
  const opacity = OPACITY_MAP[intensity];

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <LinearGradient
        colors={[colors.bgBase, '#08111E', '#050911']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[`${accentColor}${reduceTransparency ? '12' : opacity.top}`, 'transparent']}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.8, y: 0.65 }}
        style={styles.topGlow}
      />
      <LinearGradient
        colors={[`${secondaryColor}${reduceTransparency ? '0C' : opacity.bottom}`, 'transparent']}
        start={{ x: 0.2, y: 0.15 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.bottomGlow}
      />
      {!reduceTransparency ? (
        <>
          <View style={[styles.orb, styles.orbLeft, { backgroundColor: `${accentColor}${opacity.orb}` }]} />
          <View style={[styles.orb, styles.orbRight, { backgroundColor: `${secondaryColor}${opacity.orb}` }]} />
        </>
      ) : null}
      <View style={styles.grid}>
        {GRID_LINES.map((position) => (
          <React.Fragment key={position}>
            <View style={[styles.gridVertical, { left: `${position}%` }]} />
            <View style={[styles.gridHorizontal, { top: `${position}%` }]} />
          </React.Fragment>
        ))}
      </View>
      <View style={styles.rink}>
        <View style={styles.centerLine} />
        <View style={styles.centerCircle} />
        <View style={[styles.faceoffCircle, styles.faceoffTop]} />
        <View style={[styles.faceoffCircle, styles.faceoffBottom]} />
      </View>
      <View style={styles.sheen} />
    </View>
  );
}

const styles = StyleSheet.create({
  topGlow: {
    position: 'absolute',
    top: -70,
    left: -32,
    width: 300,
    height: 240,
    borderRadius: 999,
  },
  bottomGlow: {
    position: 'absolute',
    right: -50,
    bottom: -120,
    width: 340,
    height: 260,
    borderRadius: 999,
  },
  orb: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 999,
  },
  orbLeft: {
    top: '26%',
    left: -100,
  },
  orbRight: {
    right: -86,
    bottom: '18%',
  },
  sheen: {
    position: 'absolute',
    top: 112,
    left: -40,
    right: -40,
    height: 1,
    backgroundColor: colors.glassHighlight,
    transform: [{ rotate: '-7deg' }],
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
  },
  gridVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(96, 165, 250, 0.09)',
  },
  gridHorizontal: {
    position: 'absolute',
    right: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(96, 165, 250, 0.09)',
  },
  rink: {
    position: 'absolute',
    width: 230,
    height: 420,
    right: -92,
    top: '18%',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.12)',
    borderRadius: 110,
    transform: [{ rotate: '-12deg' }],
    overflow: 'hidden',
  },
  centerLine: {
    position: 'absolute',
    top: '50%',
    right: 0,
    left: 0,
    height: 1,
    backgroundColor: 'rgba(34, 211, 238, 0.14)',
  },
  centerCircle: {
    position: 'absolute',
    width: 78,
    height: 78,
    left: 75,
    top: 170,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.14)',
    borderRadius: 39,
  },
  faceoffCircle: {
    position: 'absolute',
    width: 48,
    height: 48,
    left: 90,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.1)',
    borderRadius: 24,
  },
  faceoffTop: { top: 52 },
  faceoffBottom: { bottom: 52 },
});
