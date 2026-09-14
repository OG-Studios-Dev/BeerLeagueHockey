import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../components/Avatar';
import { supabase } from '../lib/supabase/client';
import colors from '../theme/colors';

// value = the short code stored in profiles.position (constrained to C/LW/RW/D/G);
// label = what the chip shows. 'F' is NOT a valid code, so the old ['F','D','G']
// broke the profile save for forwards.
const POSITIONS = [
  { value: 'C', label: 'Forward' },
  { value: 'D', label: 'Defense' },
  { value: 'G', label: 'Goalie' },
];
const SKILL_LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
];

export default function EditProfileScreen({ navigation }: { navigation: any }) {
  const { width } = useWindowDimensions();
  const isCompact = width < 390;

  const [userId, setUserId] = React.useState<string | null>(null);
  const [fullName, setFullName] = React.useState('');
  const [position, setPosition] = React.useState('');
  const [jerseyNumber, setJerseyNumber] = React.useState('');
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);
  const [selfAssessedSkill, setSelfAssessedSkill] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [uploadingPhoto, setUploadingPhoto] = React.useState(false);

  React.useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, position, avatar_url, self_assessed_skill')
        .eq('id', user.id)
        .single();

      if (profile) {
        setFullName(profile.full_name ?? '');
        setPosition(profile.position ?? '');
        setAvatarUrl(profile.avatar_url ?? null);
        setSelfAssessedSkill(profile.self_assessed_skill ?? '');
      }

      // Also try to get jersey number from roster
      const { data: roster } = await supabase
        .from('team_rosters')
        .select('jersey_number')
        .eq('player_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (roster?.jersey_number != null) {
        setJerseyNumber(String(roster.jersey_number));
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access to change your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploadingPhoto(true);
    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      await supabase.storage
        .from('avatars')
        .upload(`${userId}/avatar.jpg`, blob, { upsert: true, contentType: 'image/jpeg' });

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${userId}/avatar.jpg`);

      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId!);
      setAvatarUrl(publicUrl + '?t=' + Date.now()); // bust cache
    } catch (e) {
      Alert.alert('Error', 'Failed to upload photo. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSave() {
    if (!userId) return;
    setSaving(true);
    try {
      await supabase.from('profiles').update({
        full_name: fullName.trim() || null,
        position: position || null,
        self_assessed_skill: selfAssessedSkill || null,
      }).eq('id', userId);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <Avatar uri={avatarUrl} name={fullName || 'Player'} size={90} borderColor={colors.primary} />
          <Pressable style={styles.changePhotoBtn} onPress={handlePickPhoto} disabled={uploadingPhoto}>
            {uploadingPhoto
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={styles.changePhotoText}>Change Photo</Text>
            }
          </Pressable>
        </View>

        {/* Fields */}
        <View style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput
            style={styles.fieldInput}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your name"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
          />
        </View>

        <View style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>Position</Text>
          <View style={[styles.positionRow, isCompact && styles.positionRowCompact]}>
            {POSITIONS.map((pos) => (
              <Pressable
                key={pos.value}
                style={[styles.positionBtn, position === pos.value && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={() => setPosition(pos.value)}
              >
                <Text style={[styles.positionBtnText, position === pos.value && { color: '#fff' }]}>{pos.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>League Match Level</Text>
          <Text style={styles.fieldHint}>
            Used to recommend BLH leagues when we do not have enough game data to rate you yet.
          </Text>
          <View style={styles.skillRow}>
            {SKILL_LEVELS.map((skill) => (
              <Pressable
                key={skill.value}
                style={[
                  styles.skillBtn,
                  selfAssessedSkill === skill.value && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
                onPress={() => setSelfAssessedSkill(skill.value)}
              >
                <Text
                  style={[
                    styles.skillBtnText,
                    selfAssessedSkill === skill.value && { color: colors.textOnPrimary },
                  ]}
                >
                  {skill.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>Jersey Number</Text>
          <TextInput
            style={styles.fieldInput}
            value={jerseyNumber}
            onChangeText={setJerseyNumber}
            placeholder="#"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            editable={false}
          />
          <Text style={styles.fieldHint}>Jersey number is managed by your team admin.</Text>
        </View>

        <View style={styles.formActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel profile editing" style={styles.cancelBtn} onPress={() => navigation.goBack()} disabled={saving}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save profile changes" style={styles.saveBtn} onPress={handleSave} disabled={saving}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.saveBtnText}>Save Changes</Text>
            }
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  avatarSection: { alignItems: 'center', paddingVertical: 16, gap: 12 },
  changePhotoBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  changePhotoText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  fieldCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 14,
    gap: 8,
  },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  fieldInput: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingVertical: 4,
  },
  fieldHint: { fontSize: 12, color: colors.textSecondary },
  positionRow: { flexDirection: 'row', gap: 10 },
  positionRowCompact: { flexWrap: 'wrap' },
  positionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
    alignItems: 'center',
  },
  positionBtnText: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  skillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  skillBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  skillBtnText: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  formActions: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginTop: 8 },
  cancelBtn: { minHeight: 52, minWidth: 92, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.borderCard },
  cancelBtnText: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
  saveBtn: {
    minHeight: 52,
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
