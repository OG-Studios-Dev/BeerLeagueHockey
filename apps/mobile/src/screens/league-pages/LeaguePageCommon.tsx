import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusScrollView } from '../../components/CardFocus';

import { useLeague } from '../../context/LeagueContext';
import { getLeaguePage, type LeaguePageKind, type LeaguePageResponse, type PageDivision, type PageSeason } from '../../lib/leaguePages';
import { commitLatestPageResult, createLatestRequestGate } from '../../lib/leaguePagesModel';
import colors from '../../theme/colors';

type Scope = { leagueId: string; leagueSlug: string };

export function useLeaguePageScope(initial: Scope): Scope {
  const { activeLeague } = useLeague();
  return activeLeague ? { leagueId: activeLeague.id, leagueSlug: activeLeague.slug } : initial;
}

export function useLeaguePage<P extends LeaguePageKind>(scope: Scope, page: P) {
  const scopeKey = `${scope.leagueId}:${scope.leagueSlug}`;
  const [selection, setSelection] = React.useState<{ scopeKey: string; seasonId: string | null }>(() => ({ scopeKey, seasonId: null }));
  const [defaultSeason, setDefaultSeason] = React.useState<{ scopeKey: string; seasonId: string | null } | null>(null);
  const [result, setResult] = React.useState<{
    requestScope: string;
    data: Extract<LeaguePageResponse, { page: P }> | null;
    error: string | null;
    loading: boolean;
  } | null>(null);
  const [retryKey, setRetryKey] = React.useState(0);
  const [gate] = React.useState(createLatestRequestGate);
  const seasonId = selection.scopeKey === scopeKey ? selection.seasonId : null;
  const requestScope = `${scopeKey}:${page}:${seasonId ?? 'default'}:${retryKey}`;
  const currentResult = result?.requestScope === requestScope ? result : null;
  const defaultSeasonId = defaultSeason?.scopeKey === scopeKey ? defaultSeason.seasonId : null;

  React.useEffect(() => {
    const request = gate.begin(requestScope);
    setResult({ requestScope, data: null, error: null, loading: true });
    void getLeaguePage(scope.leagueSlug, page, seasonId)
      .then((response) => {
        commitLatestPageResult(gate, request, requestScope, () => {
          if (response.league.id !== scope.leagueId) throw new TypeError('League page route identity mismatch');
          if (seasonId && response.selectedSeason?.id !== seasonId) throw new TypeError('League page season identity mismatch');
          if (seasonId === null) setDefaultSeason({ scopeKey, seasonId: response.selectedSeason?.id ?? null });
          setResult({ requestScope, data: response as Extract<LeaguePageResponse, { page: P }>, error: null, loading: false });
        });
      })
      .catch((reason: unknown) => {
        commitLatestPageResult(gate, request, requestScope, () => {
          setResult({ requestScope, data: null, error: reason instanceof Error ? reason.message : 'Unable to load this league page.', loading: false });
        });
      });
    return () => gate.invalidate();
  }, [gate, page, requestScope, scope.leagueId, scope.leagueSlug, scopeKey, seasonId]);

  return {
    data: currentResult?.data ?? null,
    error: currentResult?.error ?? null,
    loading: currentResult?.loading ?? true,
    seasonId,
    defaultSeasonId,
    selectSeason: (nextSeasonId: string) => setSelection({ scopeKey, seasonId: nextSeasonId }),
    retry: () => setRetryKey((value) => value + 1),
  };
}

export function LeaguePageFrame({ children, scrollable = true, onAccessibilityEscape }: { children: React.ReactNode; scrollable?: boolean; onAccessibilityEscape?: () => void }) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe} onAccessibilityEscape={onAccessibilityEscape}>
      {scrollable ? (
        <FocusScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </FocusScrollView>
      ) : children}
    </SafeAreaView>
  );
}

export function PageHeader({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

export function PageLoadState({ loading, error, noSeason, retry }: { loading: boolean; error: string | null; noSeason: boolean; retry: () => void }) {
  if (loading) return <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.detail}>Loading league page…</Text></View>;
  if (error) return (
    <View accessibilityRole="alert" style={styles.state}>
      <Text style={styles.stateTitle}>Couldn’t load this page</Text>
      <Text style={styles.detail}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Retry</Text></Pressable>
    </View>
  );
  if (noSeason) return (
    <View style={styles.state}>
      <Text style={styles.stateTitle}>No season available</Text>
      <Text style={styles.detail}>This league has not published a season for this page yet.</Text>
    </View>
  );
  return null;
}

export function FilterChips<T extends { id: string; name: string }>({ items, selectedId, allLabel, onSelect }: {
  items: T[]; selectedId: string | null; allLabel?: string; onSelect: (id: string | null) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {allLabel ? <Chip label={allLabel} selected={!selectedId} onPress={() => onSelect(null)} /> : null}
      {items.map((item) => <Chip key={item.id} label={item.name} selected={selectedId === item.id} onPress={() => onSelect(item.id)} />)}
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function SeasonPicker({ seasons, selected, onSelect }: { seasons: PageSeason[]; selected: string | null; onSelect: (id: string) => void }) {
  if (seasons.length < 2) return null;
  return <View style={styles.controlBlock}><Text style={styles.controlLabel}>Season</Text><FilterChips items={seasons} selectedId={selected} onSelect={(id) => id && onSelect(id)} /></View>;
}

export function DivisionPicker({ divisions, selected, onSelect }: { divisions: PageDivision[]; selected: string | null; onSelect: (id: string | null) => void }) {
  if (divisions.length < 2) return null;
  return <View style={styles.controlBlock}><Text style={styles.controlLabel}>Division</Text><FilterChips items={divisions} selectedId={selected} allLabel="All Divisions" onSelect={onSelect} /></View>;
}

export const commonStyles = StyleSheet.create({
  section: { marginTop: 24 },
  sectionTitle: { color: colors.textPrimary, fontSize: 21, fontWeight: '900', marginBottom: 10 },
  sectionDetail: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: colors.bgSurface, borderColor: colors.glassStroke, borderWidth: 1, borderRadius: 18, padding: 14 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 18 },
  primaryButtonText: { color: colors.textOnPrimary, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.bgInteractive, borderColor: colors.glassStroke, borderWidth: 1, paddingHorizontal: 16 },
  secondaryButtonText: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', textAlign: 'center' },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 136 },
  header: { borderRadius: 24, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgElevated, padding: 20 },
  eyebrow: { color: colors.textInteractive, fontSize: 11, fontWeight: '900', letterSpacing: 1.8, textTransform: 'uppercase' },
  title: { color: colors.textPrimary, fontSize: 30, lineHeight: 36, fontWeight: '900', marginTop: 6 },
  detail: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 6 },
  state: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  stateTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  primaryButton: { minHeight: 48, minWidth: 120, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 20 },
  primaryButtonText: { color: colors.textOnPrimary, fontWeight: '900' },
  controlBlock: { marginTop: 18 },
  controlLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 8 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { minHeight: 44, maxWidth: 220, justifyContent: 'center', borderRadius: 22, backgroundColor: colors.bgInteractive, borderColor: colors.glassStroke, borderWidth: 1, paddingHorizontal: 15 },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontWeight: '800' },
  chipTextSelected: { color: colors.textOnPrimary },
});
