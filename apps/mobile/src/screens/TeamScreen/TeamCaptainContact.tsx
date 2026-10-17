import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import captainNeutralPlayerBase from '../../assets/team-page/captain-contact-neutral-base.png';
import captainNeutralTeamMask from '../../assets/team-page/captain-contact-neutral-team-mask.png';
import captainPlayerBase from '../../assets/team-page/captain-contact-player-base.png';
import captainTeamMask from '../../assets/team-page/captain-contact-team-mask.png';
import { SECTION_HEADING_TEXT_STYLE } from '../../components/SectionHeader';
import type { TeamPageSnapshot } from '../../lib/supabase/teamPage';
import colors from '../../theme/colors';
import { ui } from '../../theme/ui';

const MATT_GROSSI_PLAYER_ID = 'add94b26-b344-459f-9727-8cddae9783de';

type TeamCaptainContactProps = {
  captain: TeamPageSnapshot['captain'];
  teamName: string;
  teamPrimaryColor: string | null;
  compact: boolean;
  onOpenPlayer: (playerId: string) => void;
};

export default function TeamCaptainContact({
  captain,
  teamName,
  teamPrimaryColor,
  compact,
  onOpenPlayer,
}: TeamCaptainContactProps) {
  const presentationColor = teamPrimaryColor ?? '#8995A8';
  const playerLayerStyle = [styles.playerLayer, compact && styles.playerLayerCompact];

  return (
    <View testID="team-captain-contact">
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.headingText}>Captain Contact</Text>
        <View accessible={false} importantForAccessibility="no" style={styles.leaderMark}>
          <View style={[styles.leaderDot, { backgroundColor: presentationColor, shadowColor: presentationColor }]} />
          <Text allowFontScaling={false} style={styles.leaderLabel}>TEAM LEADER</Text>
        </View>
      </View>

      {captain ? (
        <Pressable
          testID="team-captain-card"
          accessibilityRole="button"
          accessibilityLabel={`View profile for ${captain.name}, ${teamName} Captain${captain.jerseyNumber == null ? '' : `, jersey number ${captain.jerseyNumber}`}`}
          onPress={() => onOpenPlayer(captain.playerId)}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={['#0A1425', '#050912']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View pointerEvents="none" style={[styles.teamGlow, { backgroundColor: presentationColor }]} />
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', presentationColor, presentationColor, 'transparent']}
            locations={[0.02, 0.3, 0.68, 0.96]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.topLine}
          />

          {captain.playerId === MATT_GROSSI_PLAYER_ID ? (
            <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.artwork}>
              <Image
                testID="team-captain-player-base"
                source={captainPlayerBase}
                resizeMode="contain"
                accessible={false}
                alt=""
                style={playerLayerStyle}
              />
              <Image
                testID="team-captain-team-mask"
                source={captainTeamMask}
                resizeMode="contain"
                accessible={false}
                alt=""
                style={[playerLayerStyle, { tintColor: presentationColor }]}
              />
            </View>
          ) : (
            <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.artwork}>
              <Image
                testID="team-captain-neutral-player-base"
                source={captainNeutralPlayerBase}
                resizeMode="contain"
                accessible={false}
                alt=""
                style={playerLayerStyle}
              />
              <Image
                testID="team-captain-neutral-team-mask"
                source={captainNeutralTeamMask}
                resizeMode="contain"
                accessible={false}
                alt=""
                style={[playerLayerStyle, { tintColor: presentationColor }]}
              />
            </View>
          )}

          <View testID="team-captain-copy" pointerEvents="none" style={[styles.copy, compact && styles.copyCompact]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62} maxFontSizeMultiplier={1.4} style={[styles.kicker, compact && styles.kickerCompact]}>{teamName} · Captain</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} maxFontSizeMultiplier={1.4} style={[styles.name, compact && styles.nameCompact]}>{captain.name}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} maxFontSizeMultiplier={1.4} style={styles.meta}>Captain{captain.jerseyNumber == null ? '' : ` · #${captain.jerseyNumber}`}</Text>
          </View>

          <View testID="team-captain-action" pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.action}>
            <Text allowFontScaling={false} style={styles.actionLabel}>VIEW{`\n`}PROFILE</Text>
            <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
          </View>
        </Pressable>
      ) : (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyBody}>Captain information is not listed yet.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  headingText: { ...SECTION_HEADING_TEXT_STYLE, minWidth: 0, flexShrink: 1, color: '#F7FBFF' },
  leaderMark: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  leaderDot: { width: 6, height: 6, borderRadius: 3, shadowOpacity: 0.9, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  leaderLabel: { color: '#8F98AE', fontSize: 7, lineHeight: 10, fontWeight: '900', letterSpacing: 1.1 },
  card: { height: 132, minHeight: 132, marginHorizontal: 2, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(180,196,226,.17)', borderRadius: 10, backgroundColor: '#050912' },
  teamGlow: { position: 'absolute', left: -30, top: -42, width: 176, height: 216, borderRadius: 108, opacity: 0.12 },
  topLine: { position: 'absolute', left: 0, right: 0, top: 0, height: 1 },
  artwork: { ...StyleSheet.absoluteFillObject },
  playerLayer: { position: 'absolute', left: 3, top: 3, width: 132, height: 128 },
  playerLayerCompact: { width: 112 },
  copy: { position: 'absolute', zIndex: 2, left: 143, right: 62, top: 25, minWidth: 0 },
  copyCompact: { left: 116 },
  kicker: { color: '#AEB7C9', fontSize: 6, lineHeight: 9, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  kickerCompact: { fontSize: 5.25, lineHeight: 8, letterSpacing: 0.55 },
  name: { marginTop: 7, color: '#F7FBFF', fontSize: 18, lineHeight: 21, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  nameCompact: { fontSize: 14, lineHeight: 18, letterSpacing: 0.35 },
  meta: { marginTop: 8, color: '#AAB2C5', fontSize: 7, lineHeight: 10, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  action: { position: 'absolute', zIndex: 3, top: 0, right: 0, bottom: 0, width: 58, minWidth: ui.minTouchTarget, alignItems: 'center', justifyContent: 'center', gap: 9, borderLeftWidth: 1, borderLeftColor: 'rgba(185,201,232,.14)', backgroundColor: 'rgba(124,58,237,.035)' },
  actionLabel: { color: '#D7DCEA', fontSize: 6, lineHeight: 9, fontWeight: '900', letterSpacing: 0.9, textAlign: 'center' },
  pressed: { opacity: 0.74 },
  emptyPanel: { minHeight: 88, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgSurface, padding: 18, alignItems: 'center', justifyContent: 'center' },
  emptyBody: { color: '#7E8A9D', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
