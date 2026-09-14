import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Alert,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../../components/CardFocus';

import SectionHeader from '../../components/SectionHeader';
import colors from '../../theme/colors';

export default function InvitePlayersScreen({ route, navigation }: any) {
  const { teamId, leagueId, teamName } = route.params;

  const joinLink = `https://beerleaguehockey.ca/join/${teamId}`;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Join ${teamName} on Beer League Hockey!\n\n${joinLink}`,
        title: `Join ${teamName}`,
      });
    } catch {
      // User cancelled share
    }
  };

  const handleCopyLink = () => {
    // React Native doesn't have a built-in clipboard API, but Share works
    Alert.alert(
      'Share Join Link',
      `Share this link with players to join ${teamName}:\n\n${joinLink}`,
      [
        { text: 'Share', onPress: handleShare },
        { text: 'OK', style: 'cancel' },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      <FocusScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionHeader title="Share Join Link" />

        <FocusCard focusId={`invite:${teamId}:link`} style={styles.linkCard}>
          <Text style={styles.linkCardTitle}>Team Join Link</Text>
          <Text style={styles.linkCardSub}>
            Share this link with players you want to invite to {teamName}.
          </Text>

          <View style={styles.linkDisplay}>
            <Ionicons name="link-outline" size={16} color={colors.primary} />
            <Text style={styles.linkText} numberOfLines={1}>{joinLink}</Text>
          </View>

          <View style={styles.actionsRow}>
            <Pressable style={styles.shareBtn} onPress={handleShare}>
              <Ionicons name="share-outline" size={18} color={colors.textOnPrimary} />
              <Text style={styles.shareBtnText}>Share Link</Text>
            </Pressable>
            <Pressable style={styles.copyBtn} onPress={handleCopyLink}>
              <Ionicons name="copy-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.copyBtnText}>Copy</Text>
            </Pressable>
          </View>
        </FocusCard>

        {/* QR Code placeholder */}
        <FocusCard focusId={`invite:${teamId}:qr`} style={styles.qrCard}>
          <Ionicons name="qr-code-outline" size={64} color={colors.textSecondary} />
          <Text style={styles.qrTitle}>QR Code</Text>
          <Text style={styles.qrSub}>
            Show this QR code at the rink for players to scan and join your team instantly.
          </Text>
          <View style={styles.qrPlaceholder}>
            <Ionicons name="qr-code" size={120} color={colors.glassStroke} />
            <Text style={styles.qrPlaceholderText}>QR scanning requires a native camera module</Text>
          </View>
        </FocusCard>

        {/* Tips */}
        <FocusCard focusId={`invite:${teamId}:tips`} style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>Tips</Text>
          <View style={styles.tipRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />
            <Text style={styles.tipText}>Share the link via text message or email</Text>
          </View>
          <View style={styles.tipRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />
            <Text style={styles.tipText}>Players need a BLH account to join</Text>
          </View>
          <View style={styles.tipRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />
            <Text style={styles.tipText}>You can approve join requests from the captain dashboard</Text>
          </View>
        </FocusCard>
      </FocusScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 40, gap: 8 },

  linkCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 18,
    gap: 12,
  },
  linkCardTitle: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
  linkCardSub: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, lineHeight: 18 },
  linkDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  linkText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.primary },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  shareBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },
  shareBtnText: { fontSize: 14, fontWeight: '800', color: colors.textOnPrimary },
  copyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.bgInteractive,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingVertical: 12,
  },
  copyBtnText: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },

  qrCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  qrTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  qrSub: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  qrPlaceholder: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  qrPlaceholderText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },

  tipsCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 16,
    gap: 10,
  },
  tipsTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tipText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textSecondary },
});
