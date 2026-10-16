import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../components/CardFocus';
import { cutIceContentEdges } from '../navigation/cutIceSafeAreaPolicy';
import colors from '../theme/colors';

type PolicyPageProps = {
  children: React.ReactNode;
  eyebrow: string;
  navigation: { goBack: () => void };
  summary: string;
  title: string;
  updated?: string;
};

type PolicySectionProps = {
  children: React.ReactNode;
  focusId: string;
  title: string;
};

export function PolicyPage({ children, eyebrow, navigation, summary, title, updated }: PolicyPageProps) {
  return (
    <SafeAreaView
      edges={cutIceContentEdges(['top', 'left', 'right', 'bottom'])}
      onAccessibilityEscape={() => navigation.goBack()}
      style={styles.safeArea}
    >
      <FocusScrollView contentContainerStyle={styles.content}>
        <FocusCard focusId={`policy:${title}:header`} style={styles.hero}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text accessibilityRole="header" style={styles.pageTitle}>{title}</Text>
          {updated ? <Text style={styles.updated}>{updated}</Text> : null}
          <Text style={styles.summary}>{summary}</Text>
        </FocusCard>
        {children}
      </FocusScrollView>
    </SafeAreaView>
  );
}

export function PolicySection({ children, focusId, title }: PolicySectionProps) {
  return (
    <FocusCard focusId={focusId} style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </FocusCard>
  );
}

export function PolicyParagraph({ children }: { children: React.ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

export function PolicyBullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.bulletMark}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

export const policyPageStyles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
    width: '100%',
  },
  actionText: {
    color: colors.textOnPrimary,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
    textAlign: 'center',
  },
  error: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderColor: colors.accentRed,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    padding: 12,
  },
  errorText: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 21,
  },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    alignSelf: 'center',
    maxWidth: 720,
    padding: 16,
    paddingBottom: 28,
    width: '100%',
  },
  hero: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.glassStroke,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    width: '100%',
  },
  eyebrow: {
    color: colors.textInteractive,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  pageTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 38,
    marginTop: 6,
  },
  updated: {
    color: colors.textInteractive,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 8,
  },
  summary: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
  },
  section: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.glassStroke,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
    width: '100%',
  },
  sectionTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 25,
  },
  sectionBody: { marginTop: 8, width: '100%' },
  paragraph: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 6,
  },
  bulletRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginTop: 7,
    width: '100%',
  },
  bulletMark: {
    color: colors.textInteractive,
    fontSize: 16,
    lineHeight: 23,
    marginRight: 9,
  },
  bulletText: {
    color: colors.textSecondary,
    flex: 1,
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 23,
  },
});