import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  formatMembershipDiagnostics,
  type MembershipDiagnostics,
  type MembershipLoadStatus,
} from '../lib/membershipDiagnostics';
import colors from '../theme/colors';

type Props = {
  diagnostics: MembershipDiagnostics;
  status: MembershipLoadStatus;
  onRetry?: () => void;
  initiallyExpanded?: boolean;
};

export default function MembershipDiagnosticsCard({
  diagnostics,
  status,
  onRetry,
  initiallyExpanded = false,
}: Props) {
  const [expanded, setExpanded] = React.useState(initiallyExpanded);
  const diagnosticText = React.useMemo(
    () => formatMembershipDiagnostics(diagnostics, status),
    [diagnostics, status],
  );
  const isLoading = status === 'loading';
  const canRetry = onRetry != null && (status === 'error' || status === 'incomplete');

  return (
    <View style={styles.card} accessibilityLabel="League status diagnostics">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Hide league diagnostics' : 'Show league diagnostics'}
        accessibilityState={{ expanded }}
        style={styles.header}
        onPress={() => setExpanded((current) => !current)}
      >
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>TestFlight diagnostics</Text>
          <Text style={styles.title}>League sign-in status</Text>
        </View>
        {isLoading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        <Text style={styles.toggle}>{expanded ? 'Hide' : 'View'}</Text>
      </Pressable>

      {expanded ? (
        <ScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.body}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <Text style={styles.help}>
            Safe to screenshot or copy. It contains status facts only, never passwords, tokens, email, or a full user ID.
          </Text>
          <Text selectable style={styles.diagnosticText}>{diagnosticText}</Text>
          {canRetry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry league membership lookup"
              accessibilityState={{ disabled: isLoading, busy: isLoading }}
              disabled={isLoading}
              style={styles.retryButton}
              onPress={onRetry}
            >
              <Text style={styles.retryText}>Retry League Check</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgSurface,
    overflow: 'hidden',
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', marginTop: 2 },
  toggle: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  body: { borderTopWidth: 1, borderTopColor: colors.borderCard, padding: 14, gap: 10 },
  bodyScroll: { maxHeight: 320 },
  help: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  diagnosticText: {
    color: colors.textPrimary,
    backgroundColor: colors.bgInteractive,
    borderRadius: 10,
    padding: 12,
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  retryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.bgInteractive,
  },
  retryText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
});
