import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import colors from '../../theme/colors';

const NOTES_KEY_PREFIX = 'blh_lineup_notes_';

export default function LineupNotesScreen({ route, navigation }: any) {
  const { gameId, teamId, opponentName } = route.params;
  const [notes, setNotes] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [lastSaved, setLastSaved] = React.useState<string | null>(null);

  const storageKey = `${NOTES_KEY_PREFIX}${gameId}_${teamId}`;

  // Load saved notes
  React.useEffect(() => {
    SecureStore.getItemAsync(storageKey)
      .then((value) => {
        if (value) {
          try {
            const parsed = JSON.parse(value);
            setNotes(parsed.notes ?? '');
            setLastSaved(parsed.savedAt ?? null);
          } catch {
            setNotes(value);
          }
        }
      })
      .catch(() => {});
  }, [storageKey]);

  const handleSave = async () => {
    try {
      const now = new Date().toISOString();
      await SecureStore.setItemAsync(
        storageKey,
        JSON.stringify({ notes, savedAt: now }),
      );
      setLastSaved(now);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      Alert.alert('Error', 'Could not save notes. Try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.contentActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel lineup notes" style={styles.cancelBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save lineup notes"
            style={[styles.saveBtn, saved && styles.saveBtnSaved]}
            onPress={handleSave}
          >
            <Text style={[styles.saveBtnText, saved && styles.saveBtnTextSaved]}>
              {saved ? 'Saved!' : 'Save'}
            </Text>
          </Pressable>
        </View>
        {/* Game context */}
        <View style={styles.gameContext}>
          <Text style={styles.gameContextLabel}>GAME NOTES</Text>
          <Text style={styles.gameContextOpponent}>
            vs {opponentName ?? 'Opponent'}
          </Text>
          {lastSaved && (
            <Text style={styles.lastSavedText}>
              Last saved: {new Date(lastSaved).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          )}
        </View>

        {/* Notes Input */}
        <View style={styles.notesCard}>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Write your lineup notes, line combinations, special instructions...

Example:
Line 1: Smith - Johnson - Williams
Line 2: Brown - Davis - Miller
Line 3: Wilson - Anderson - Taylor

D Pairs:
1: Thomas - Jackson
2: White - Harris
3: Martin - Thompson

Notes:
- Johnson takes power play
- Miller covers penalty kill
- New player #22 on third line"
            placeholderTextColor={colors.textSecondary}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
          />
        </View>

        {/* Tips */}
        <View style={styles.tipsCard}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <View style={styles.tipsContent}>
            <Text style={styles.tipsTitle}>About Lineup Notes</Text>
            <Text style={styles.tipsText}>
              Notes are saved locally on your device. Use them to plan line combinations,
              special assignments, or any pre-game instructions. Team members can see
              these notes from the game detail screen.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  contentActions: { minHeight: 44, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  cancelBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999 },
  cancelBtnText: { fontSize: 13, fontWeight: '800', color: colors.textSecondary },
  saveBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  saveBtnSaved: {
    backgroundColor: colors.accentGreen,
  },
  saveBtnText: { fontSize: 13, fontWeight: '800', color: colors.textOnPrimary },
  saveBtnTextSaved: { color: '#000' },
  content: { padding: 16, paddingBottom: 40, gap: 14 },

  gameContext: {
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
    gap: 4,
  },
  gameContextLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.primary },
  gameContextOpponent: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
  lastSavedText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 4 },

  notesCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 4,
    minHeight: 300,
  },
  notesInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
    lineHeight: 22,
    padding: 12,
    minHeight: 290,
  },

  tipsCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
  },
  tipsContent: { flex: 1, gap: 4 },
  tipsTitle: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  tipsText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, lineHeight: 17 },
});
