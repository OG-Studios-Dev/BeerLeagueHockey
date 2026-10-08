import React from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ScheduleTeamOption } from '../lib/schedulePresentation';
import { HOME_VISUAL_TOKENS as homeTokens } from '../theme/home';
import TeamLogo from './TeamLogo';

type Props = {
  options: ScheduleTeamOption[];
  selectedTeamId: string | null;
  onSelect: (teamId: string | null) => void;
};

type FilterOption = ScheduleTeamOption | { id: null; name: 'All teams'; logoUrl: null; primaryColor: null };

export default function ScheduleTeamFilter({ options, selectedTeamId, onSelect }: Props) {
  const [open, setOpen] = React.useState(false);
  const selectedName = selectedTeamId
    ? options.find((option) => option.id === selectedTeamId)?.name ?? 'Team unavailable'
    : 'All teams';
  const data: FilterOption[] = [
    { id: null, name: 'All teams', logoUrl: null, primaryColor: null },
    ...options,
  ];
  const choose = (teamId: string | null) => {
    onSelect(teamId);
    setOpen(false);
  };

  return (
    <View style={styles.wrapper}>
      <Pressable
        testID="schedule-team-filter-trigger"
        accessibilityRole="button"
        accessibilityLabel={`Filter schedule by team, ${selectedName}`}
        accessibilityHint="Opens team list"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <View style={styles.triggerCopy}>
          <Text style={styles.triggerLabel}>Team</Text>
          <Text style={styles.triggerValue}>{selectedName}</Text>
        </View>
        <Text accessible={false} style={styles.disclosure}>⌄</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close team filter"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.headingRow}>
              <Text accessibilityRole="header" style={styles.heading}>Filter by team</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close team filter"
                onPress={() => setOpen(false)}
                style={styles.close}
              >
                <Text accessible={false} style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <FlatList
              data={data}
              keyExtractor={(item) => item.id ?? 'all'}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => {
                const selected = item.id === selectedTeamId;
                const optionId = item.id ?? 'all';
                return (
                  <Pressable
                    testID={`schedule-team-option-${optionId}`}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                    accessibilityState={{ selected }}
                    onPress={() => choose(item.id)}
                    style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
                  >
                    {item.id ? (
                      <TeamLogo
                        decorative
                        transparentBacking
                        teamId={item.id}
                        logoUrl={item.logoUrl}
                        teamName={item.name}
                        primaryColor={item.primaryColor}
                        size={36}
                      />
                    ) : <View accessible={false} style={styles.allTeamsMark}><Text accessible={false} style={styles.allTeamsText}>ALL</Text></View>}
                    <Text testID={`schedule-team-option-name-${optionId}`} style={styles.optionName}>{item.name}</Text>
                    {selected ? <Text accessible={false} style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { minWidth: 0 },
  trigger: {
    minHeight: homeTokens.minTouchTarget,
    minWidth: homeTokens.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: homeTokens.strokeOpaque,
    backgroundColor: homeTokens.surfaceOpaque,
  },
  pressed: { opacity: 0.8 },
  triggerCopy: { flex: 1, minWidth: 0 },
  triggerLabel: { color: homeTokens.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900', textTransform: 'uppercase' },
  triggerValue: { color: homeTokens.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  disclosure: { color: homeTokens.textSecondary, fontSize: 22, lineHeight: 24, fontWeight: '900' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(3,10,19,0.72)' },
  sheet: {
    maxHeight: '78%',
    minHeight: 220,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: homeTokens.strokeOpaque,
    backgroundColor: homeTokens.elevatedOpaque,
    paddingBottom: 20,
  },
  headingRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8 },
  heading: { flex: 1, color: homeTokens.text, fontSize: 19, lineHeight: 25, fontWeight: '900' },
  close: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: homeTokens.textSecondary, fontSize: 28, lineHeight: 30 },
  list: { paddingHorizontal: 12, paddingBottom: 16, gap: 4 },
  option: {
    minHeight: homeTokens.minTouchTarget,
    minWidth: homeTokens.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  optionSelected: { borderColor: homeTokens.strokeOpaque, backgroundColor: homeTokens.surfaceOpaque },
  optionName: { flex: 1, minWidth: 0, flexShrink: 1, color: homeTokens.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  check: { color: homeTokens.text, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  allTeamsMark: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: homeTokens.surfaceOpaque },
  allTeamsText: { color: homeTokens.textSecondary, fontSize: 9, fontWeight: '900' },
});
