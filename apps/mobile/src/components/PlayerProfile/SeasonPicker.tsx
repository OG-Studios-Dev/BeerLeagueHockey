import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { PlayerSeason } from '../../lib/supabase/playerPage';
import colors from '../../theme/colors';

type Props = { seasons: PlayerSeason[]; selectedSeasonId: string | null; isCareer: boolean; accent: string; onSelect: (seasonId: string | null) => void };

export default function SeasonPicker({ seasons, selectedSeasonId, isCareer, accent, onSelect }: Props) {
  const [open, setOpen] = React.useState(false);
  const selectedLabel = isCareer ? 'Career Stats' : seasons.find((season) => season.id === selectedSeasonId)?.name ?? 'Choose season';
  const choose = (value: string | null) => { setOpen(false); onSelect(value); };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Change season, ${selectedLabel} selected`} onPress={() => setOpen(true)} style={[styles.trigger, { borderColor: accent }]}>
      <Text style={styles.triggerText}>{selectedLabel}</Text><Ionicons name="chevron-down" size={18} color={accent} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close season picker" style={styles.backdrop} onPress={() => setOpen(false)}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>Choose stats view</Text>
          <ScrollView style={styles.list}>
            <Pressable accessibilityRole="button" accessibilityLabel="View Career Stats" accessibilityState={{ selected: isCareer }} onPress={() => choose(null)} style={[styles.option, isCareer && { borderColor: accent }]}><Text style={[styles.optionText, isCareer && { color: accent }]}>Career Stats</Text>{isCareer ? <Ionicons name="checkmark-circle" size={20} color={accent} /> : null}</Pressable>
            {seasons.map((season) => { const selected = selectedSeasonId === season.id; return <Pressable key={season.id} accessibilityRole="button" accessibilityLabel={`View ${season.name}`} accessibilityState={{ selected }} onPress={() => choose(season.id)} style={[styles.option, selected && { borderColor: accent }]}><Text style={[styles.optionText, selected && { color: accent }]}>{season.name}</Text>{selected ? <Ionicons name="checkmark-circle" size={20} color={accent} /> : null}</Pressable>; })}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 14, backgroundColor: colors.bgSurface, paddingHorizontal: 15, marginBottom: 14 },
  triggerText: { color: colors.textPrimary, fontSize: 14, fontWeight: '900' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: { maxHeight: '72%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgElevated, padding: 18 },
  title: { color: colors.textPrimary, fontSize: 19, fontWeight: '900', marginBottom: 12 },
  list: { flexGrow: 0 },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 13, paddingHorizontal: 14, marginBottom: 8 },
  optionText: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
});
