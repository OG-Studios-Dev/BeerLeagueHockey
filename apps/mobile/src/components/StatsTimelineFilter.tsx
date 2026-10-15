import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import type { PublicStatsScopeSeason, PublicStatsScopeSelection } from '../lib/supabase/publicStats';
import { getSurfacePalette } from '../theme/ui';
import { SelectableControl, SelectableControlGroup } from './SelectableControl';

type Props = {
  label: string;
  currentSeasonId: string | null;
  seasons: readonly PublicStatsScopeSeason[];
  selection: PublicStatsScopeSelection;
  onApply: (selection: PublicStatsScopeSelection) => void;
};
const MODES: ReadonlyArray<{ kind: PublicStatsScopeSelection['kind']; label: string }> = [
  { kind: 'current', label: 'Current' }, { kind: 'all', label: 'All time' }, { kind: 'single', label: 'Single' }, { kind: 'multiple', label: 'Multiple' },
];

export default function StatsTimelineFilter({ label, currentSeasonId, seasons, selection, onApply }: Props) {
  const { reduceTransparency } = useAccessibilityPreferences();
  const surfaces = getSurfacePalette(reduceTransparency);
  const inactiveStyle = reduceTransparency ? { backgroundColor: surfaces.interactive, borderColor: surfaces.stroke } : undefined;
  const selectedStyle = reduceTransparency ? { backgroundColor: surfaces.elevated, borderColor: '#A78BFA' } : undefined;
  const inactivePressedStyle = reduceTransparency ? { opacity: 1, backgroundColor: surfaces.surface, borderColor: '#61E2E8' } : undefined;
  const selectedPressedStyle = reduceTransparency ? { opacity: 1, backgroundColor: surfaces.interactive, borderColor: '#C8B8FF' } : undefined;
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<PublicStatsScopeSelection>(selection);
  const openSheet = () => { setDraft(selection); setOpen(true); };
  const selected = new Set(draft.seasonIds ?? []);
  const chooseMode = (kind: PublicStatsScopeSelection['kind']) => {
    if (kind === 'current' || kind === 'all') setDraft({ kind });
    else if (kind === 'single') setDraft({ kind, seasonIds: [selected.values().next().value ?? currentSeasonId ?? seasons[0]?.id].filter(Boolean) as string[] });
    else setDraft({ kind, seasonIds: selected.size ? [...selected] : [currentSeasonId ?? seasons[0]?.id].filter(Boolean) as string[] });
  };
  const toggleSeason = (seasonId: string) => {
    if (draft.kind === 'single') return setDraft({ kind: 'single', seasonIds: [seasonId] });
    if (draft.kind !== 'multiple') return;
    const next = new Set(draft.seasonIds ?? []);
    if (next.has(seasonId) && next.size > 1) next.delete(seasonId); else next.add(seasonId);
    setDraft({ kind: 'multiple', seasonIds: [...next] });
  };
  const canApply = (draft.kind !== 'single' && draft.kind !== 'multiple') || (draft.seasonIds?.length ?? 0) > 0;
  return (
    <>
      <SelectableControl testID="stats-timeline-open" role="button" label="Timeline" accessibilityLabel={`Open timeline filter. ${label}`} onPress={openSheet} style={styles.opener} inactiveStyle={inactiveStyle} pressedStyle={inactivePressedStyle}>
        <Ionicons name="time-outline" size={21} color="#61E2E8" />
      </SelectableControl>
      <Modal testID="stats-timeline-modal" visible={open} transparent animationType="slide" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={styles.scrim}>
          <Pressable testID="stats-timeline-backdrop" accessibilityRole="button" accessibilityLabel="Close timeline filter" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal accessibilityLabel="Timeline filter dialog" style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}><View><Text style={styles.eyebrow}>Stats range</Text><Text accessibilityRole="header" style={styles.sheetTitle}>Choose timeline</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close timeline filter" onPress={() => setOpen(false)} style={styles.close}><Ionicons name="close" size={20} color="#B9CBD8" /></Pressable></View>
            <SelectableControlGroup role="tablist" accessibilityLabel="Timeline mode" contentContainerStyle={styles.modes}>
              {MODES.map((mode) => {
                const isSelected = draft.kind === mode.kind;
                return <SelectableControl key={mode.kind} testID={`stats-timeline-mode-${mode.kind}`} role="tab" label={mode.label} accessibilityLabel={`${mode.label} timeline`} selected={isSelected} onPress={() => chooseMode(mode.kind)} style={styles.mode} selectedStyle={selectedStyle} inactiveStyle={inactiveStyle} pressedStyle={isSelected ? selectedPressedStyle : inactivePressedStyle} />;
              })}
            </SelectableControlGroup>
            {(draft.kind === 'single' || draft.kind === 'multiple') ? <>
              <Text style={styles.available}>Available seasons</Text>
              <ScrollView style={styles.seasons} contentContainerStyle={styles.seasonsContent}>
                <SelectableControlGroup horizontal={false} role={draft.kind === 'single' ? 'radiogroup' : 'group'} accessibilityLabel="Available seasons" contentContainerStyle={styles.seasonChoices}>{seasons.map((season) => {
                  const isSelected = selected.has(season.id);
                  return <SelectableControl key={season.id} role={draft.kind === 'single' ? 'radio' : 'checkbox'} label={season.name} selected={isSelected} accessibilityLabel={`${season.name}, ${season.id === currentSeasonId ? 'current season' : 'past season'}`} onPress={() => toggleSeason(season.id)} style={styles.seasonRow} selectedStyle={selectedStyle} inactiveStyle={inactiveStyle} pressedStyle={isSelected ? selectedPressedStyle : inactivePressedStyle}>
                    <View style={styles.seasonCopy}><Text style={styles.seasonName}>{season.name}</Text><Text style={styles.seasonMeta}>{season.id === currentSeasonId ? 'Current season' : 'Completed season'}</Text></View>
                    <Text style={styles.seasonState}>{season.id === currentSeasonId ? 'Current' : 'Past'}</Text>
                  </SelectableControl>;
                })}</SelectableControlGroup>
              </ScrollView>
            </> : <View testID={`stats-timeline-${draft.kind}-explanation`} accessible accessibilityRole="text" style={styles.modeExplanation}><Text style={styles.modeExplanationText}>{draft.kind === 'current' ? 'Use the league’s deterministic operational season. Division filters remain available.' : 'All time is league-wide, so division filters are unavailable. It combines every native season plus explicit non-overlapping imported career totals.'}</Text></View>}
            <View style={styles.actions}><Pressable accessibilityRole="button" onPress={() => setDraft({ kind: 'current' })} style={styles.reset}><Text style={styles.resetText}>Reset</Text></Pressable><Pressable disabled={!canApply} accessibilityRole="button" accessibilityLabel="Apply timeline" onPress={() => { if (canApply) { onApply(draft); setOpen(false); } }} style={[styles.apply, !canApply && styles.disabled]}><Text style={styles.applyText}>Apply timeline</Text></Pressable></View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  opener: { width: 44, minWidth: 44, minHeight: 44, paddingHorizontal: 0 },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,8,16,0.74)' }, sheet: { width: '100%', maxHeight: '78%', minHeight: 430, paddingHorizontal: 16, paddingBottom: 26, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: 'rgba(125,190,255,0.28)', backgroundColor: '#091827' },
  handle: { alignSelf: 'center', width: 38, height: 4, marginTop: 9, marginBottom: 12, borderRadius: 2, backgroundColor: '#587A91' }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }, eyebrow: { color: '#82A0B6', fontSize: 9, lineHeight: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.4 }, sheetTitle: { color: '#F7FBFF', fontSize: 20, lineHeight: 27, fontWeight: '900' }, close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#14283A' },
  modes: { marginBottom: 16 }, mode: { minWidth: 92 },
  available: { color: '#F2F7FB', fontSize: 12, lineHeight: 17, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 }, seasons: { flexGrow: 0, maxHeight: 290, marginTop: 5 }, seasonsContent: { paddingBottom: 8 }, seasonChoices: { flexDirection: 'column' }, seasonRow: { width: '100%', minHeight: 58, justifyContent: 'flex-start' }, seasonCopy: { flex: 1, minWidth: 0 }, seasonName: { color: '#EAF2F7', fontSize: 12, lineHeight: 17, fontWeight: '800' }, seasonMeta: { color: '#71879A', fontSize: 8, lineHeight: 12 }, seasonState: { color: '#C8B8FF', fontSize: 8, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7 },
  modeExplanation: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }, modeExplanationText: { color: '#91A5B5', fontSize: 12, lineHeight: 18, textAlign: 'center' }, actions: { flexDirection: 'row', gap: 8, marginTop: 'auto', paddingTop: 14 }, reset: { width: 92, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#29465C', borderRadius: 14 }, resetText: { color: '#B6C6D2', fontSize: 13, fontWeight: '900' }, apply: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#61DDE2' }, applyText: { color: '#06202A', fontSize: 14, fontWeight: '900' }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 },
});
