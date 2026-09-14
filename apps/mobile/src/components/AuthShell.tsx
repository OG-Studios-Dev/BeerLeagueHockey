import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import hockeyLifeLogo from '../../assets/hockey-life-logo.png';
import colors from '../theme/colors';
import { ui } from '../theme/ui';
import BrandAtmosphere from './BrandAtmosphere';
import GlassSurface from './GlassSurface';

type AuthShellProps = {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  contentStyle?: StyleProp<ViewStyle>;
};

export default function AuthShell({
  children,
  title,
  subtitle,
  eyebrow = 'HOCKEY LIFE',
  contentStyle,
}: AuthShellProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <BrandAtmosphere intensity="medium" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.content, contentStyle]}>
          <View style={styles.brandRow}>
            <Image source={hockeyLifeLogo} style={styles.logo} alt="Hockey Life logo" accessibilityIgnoresInvertColors />
            <View style={styles.brandCopy}>
              <Text style={styles.eyebrow}>{eyebrow}</Text>
              <Text style={styles.kicker}>Built for the bench.</Text>
            </View>
          </View>
          <GlassSurface style={styles.panel} elevated>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            {children}
          </GlassSurface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingVertical: 24 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    marginBottom: 18,
  },
  logo: { width: 54, height: 54 },
  brandCopy: { flex: 1, gap: 3 },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  kicker: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  panel: {
    padding: 20,
    borderRadius: ui.radius.panel,
    shadowColor: colors.brandRink,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 6,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    marginBottom: 20,
  },
});
