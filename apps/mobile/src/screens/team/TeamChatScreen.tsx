import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../../components/Avatar';
import {
  getRecentTeamMessages,
  postTeamMessage,
  getCaptainRole,
  type TeamMessageRow,
} from '../../lib/supabase/captain';
import colors from '../../theme/colors';

export default function TeamChatScreen({ route, navigation }: any) {
  const { teamId, teamName } = route.params;
  const [messages, setMessages] = React.useState<TeamMessageRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [isCaptain, setIsCaptain] = React.useState(false);
  const [newMessage, setNewMessage] = React.useState('');
  const [sending, setSending] = React.useState(false);

  const loadMessages = React.useCallback(async () => {
    try {
      const msgs = await getRecentTeamMessages(teamId, 20);
      setMessages(msgs);

      const role = await getCaptainRole(teamId);
      setIsCaptain(role !== null);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  React.useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;

    setSending(true);
    const result = await postTeamMessage({
      teamId,
      message: newMessage.trim(),
      messageType: 'captain_alert',
    });

    if (result.success) {
      setNewMessage('');
      await loadMessages();
    } else {
      Alert.alert('Error', result.error ?? 'Failed to send announcement');
    }
    setSending(false);
  };

  function formatDate(iso: string | null) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={<Text accessibilityRole="header" style={styles.chatContext}>{teamName ?? 'Team'} announcements</Text>}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="megaphone-outline" size={32} color={colors.textSecondary} />
              <Text style={styles.emptyTitle}>No announcements yet</Text>
              <Text style={styles.emptySub}>
                {isCaptain
                  ? 'Post the first team announcement below.'
                  : 'Captains can post announcements for the team.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.messageCard}>
              <View style={styles.messageHeader}>
                <Avatar
                  uri={null}
                  name={item.sentBy?.fullName ?? 'Captain'}
                  size={32}
                />
                <View style={styles.messageHeaderInfo}>
                  <Text style={styles.messageSender}>{item.sentBy?.fullName ?? 'Captain'}</Text>
                  <Text style={styles.messageDate}>{formatDate(item.createdAt)}</Text>
                </View>
                {item.isUrgent && (
                  <View style={styles.urgentBadge}>
                    <Text style={styles.urgentBadgeText}>Urgent</Text>
                  </View>
                )}
              </View>
              {item.subject && (
                <Text style={styles.messageSubject}>{item.subject}</Text>
              )}
              <Text style={styles.messageBody}>{item.message}</Text>
            </View>
          )}
        />
      )}

      {/* Compose (captains only) */}
      {isCaptain && (
        <View style={styles.composeBar}>
          <TextInput
            style={styles.composeInput}
            value={newMessage}
            onChangeText={setNewMessage}
            placeholder="Write an announcement..."
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={500}
          />
          <Pressable
            style={[styles.sendBtn, !newMessage.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!newMessage.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <Ionicons name="send" size={18} color={colors.textOnPrimary} />
            )}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, paddingBottom: 100, gap: 10 },
  chatContext: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '700', marginBottom: 2 },

  emptyCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 32,
    alignItems: 'center',
    gap: 10,
    marginTop: 40,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  emptySub: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },

  messageCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
    gap: 10,
  },
  messageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  messageHeaderInfo: { flex: 1 },
  messageSender: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  messageDate: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginTop: 1 },
  urgentBadge: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  urgentBadgeText: { fontSize: 10, fontWeight: '800', color: colors.accentRed },
  messageSubject: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  messageBody: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, lineHeight: 20 },

  composeBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.glassStroke,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 32,
  },
  composeInput: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    maxHeight: 80,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
