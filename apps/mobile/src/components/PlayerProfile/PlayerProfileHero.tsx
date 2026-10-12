import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import colors from '../../theme/colors';
import { getContrastTextColor } from '../../theme/contrast';
import TeamLogo from '../TeamLogo';
import { getPlayerProfileHeroLayout, splitPlayerDisplayName } from './playerProfileHeroModel';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires a static bundled image reference. */
const rinkRibbonArtwork = require('../../../assets/league-leaders/jack-foote.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type PlayerProfileHeroProps = {
  fullName: string;
  jerseyNumber: number | null;
  position: string | null;
  leadership: string | null;
  team: { id: string; name: string; logoUrl: string | null } | null;
  awards: Array<{ key: string; label: string; count: number; imageUrl: string | null }>;
  accent: string;
  width: number;
  fontScale: number;
  reduceTransparency: boolean;
  accessibilityLabel?: string;
  onShare: () => void;
  onOpenTeam: () => void;
};

export default function PlayerProfileHero({
  fullName,
  jerseyNumber,
  position,
  leadership,
  team,
  awards,
  accent,
  width,
  fontScale,
  reduceTransparency,
  accessibilityLabel = 'Share player card',
  onShare,
  onOpenTeam,
}: PlayerProfileHeroProps) {
  const layout = getPlayerProfileHeroLayout(width, fontScale);
  const displayName = splitPlayerDisplayName(fullName);
  const visibleAwards = awards.filter((award) => award.count > 0);
  return (
    <View testID="player-profile-rink-ribbon-hero" style={[styles.hero, { minHeight: layout.stageHeight }]}>
      <View
        testID="player-profile-rink-ribbon-atmosphere"
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFillObject, styles.atmosphere, reduceTransparency && styles.atmosphereOpaque]}
      >
        <LinearGradient
          colors={reduceTransparency ? ['#10091D', '#10091D', '#10091D'] : ['rgba(83,35,142,0.24)', 'rgba(16,9,29,0.04)', 'rgba(16,9,29,0.84)']}
          locations={[0, 0.52, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.rinkOutline}><View style={[styles.rinkCenterLine, { backgroundColor: `${accent}24` }]} /><View style={styles.rinkCircle} /></View>
        <View style={[styles.leftGlow, reduceTransparency && styles.leftGlowReduced]} />
        <View
          testID="player-profile-rink-ribbon-curve"
          style={[styles.ribbonCurve, { top: layout.stageHeight - 128, width: layout.canvasWidth + 126 }]}
        />
        <View
          testID="player-profile-rink-ribbon-glint"
          style={[styles.ribbonGlint, { top: layout.stageHeight - 85, width: layout.canvasWidth + 100, backgroundColor: `${accent}42` }]}
        />
        <View
          testID="player-profile-rink-ribbon-fog"
          style={[styles.ribbonFog, { top: layout.stageHeight - 112, width: layout.canvasWidth + 80 }, reduceTransparency && styles.ribbonFogReduced]}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onShare}
        style={styles.shareButton}
      >
        <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
      </Pressable>

      <View
        testID="player-profile-artwork-shell"
        style={[
          styles.artworkShell,
          layout.stacked && styles.artworkShellStacked,
          { top: layout.artTop, width: layout.artWidth, height: layout.artHeight },
        ]}
      >
        <Image
          testID="player-profile-rink-ribbon-artwork"
          source={rinkRibbonArtwork}
          alt=""
          resizeMode="contain"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: layout.artWidth, height: layout.artHeight }}
        />
      </View>

      <View
        testID="player-profile-rink-ribbon-identity"
        style={[styles.identity, layout.stacked && styles.identityStacked, { width: layout.identityWidth }]}
      >
        <Text style={[styles.eyebrow, { color: accent }]}>PLAYER PROFILE</Text>
        {displayName.givenNames ? <Text {...(layout.stacked ? {} : { adjustsFontSizeToFit: true, numberOfLines: 2, minimumFontScale: 0.62 })} style={[styles.givenNames, layout.stacked && styles.stackedName]}>{displayName.givenNames}</Text> : null}
        <Text
          testID="player-profile-rink-ribbon-surname"
          {...(layout.stacked ? {} : { adjustsFontSizeToFit: true, numberOfLines: 2, minimumFontScale: 0.62 })}
          style={[styles.surname, layout.stacked && styles.stackedSurname]}
        >{displayName.surname}</Text>
        <View style={styles.metaRow}>
          {jerseyNumber != null ? <Text style={[styles.jersey, { backgroundColor: accent, color: getContrastTextColor(accent) }]}>#{jerseyNumber}</Text> : null}
          {position ? <Text style={styles.meta}>{position.toUpperCase()}</Text> : null}
          {leadership ? <Text style={[styles.meta, styles.leadership]}>{leadership.toUpperCase()}</Text> : null}
        </View>
        {team ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${team.name}`} onPress={onOpenTeam} style={styles.teamLink}>
          <TeamLogo teamId={team.id} logoUrl={team.logoUrl} teamName={team.name} primaryColor={accent} size={30} decorative transparentBacking />
          <Text numberOfLines={2} style={styles.teamName}>{team.name}</Text>
        </Pressable> : null}
      </View>

      {visibleAwards.length > 0 ? <View
        testID="player-profile-rink-ribbon-awards"
        style={[styles.awards, { marginTop: layout.stacked ? 22 : layout.stageHeight }]}
      >
        {visibleAwards.map((award) => <View key={award.key} style={[styles.award, reduceTransparency && styles.awardOpaque]} accessible accessibilityLabel={`${award.label}, ${award.count}`}>
          {award.imageUrl ? <Image source={{ uri: award.imageUrl }} alt="" resizeMode="contain" accessible={false} accessibilityElementsHidden style={styles.awardImage} /> : <Ionicons name="trophy-outline" size={27} color={accent} />}
          <View style={styles.awardCopy}><Text style={styles.awardLabel}>{award.label}</Text><Text style={[styles.awardCount, { color: accent }]}>×{award.count}</Text></View>
        </View>)}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { position: 'relative', overflow: 'visible' },
  atmosphere: { zIndex: 0, overflow: 'visible' },
  atmosphereOpaque: { backgroundColor: '#10091D' },
  rinkOutline: { position: 'absolute', top: 72, right: 12, width: 148, height: 260, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 76, transform: [{ rotate: '10deg' }] },
  rinkCenterLine: { position: 'absolute', left: -20, right: -20, top: '50%', height: 1 },
  rinkCircle: { position: 'absolute', left: '50%', top: '50%', width: 56, height: 56, marginLeft: -28, marginTop: -28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 28 },
  leftGlow: { position: 'absolute', top: 36, left: -154, width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(124,62,204,0.13)' },
  leftGlowReduced: { backgroundColor: 'rgba(124,62,204,0.07)' },
  ribbonCurve: { position: 'absolute', left: -62, height: 184, borderRadius: 999, backgroundColor: 'rgba(45,24,75,0.88)', transform: [{ rotate: '-7deg' }] },
  ribbonGlint: { position: 'absolute', left: -44, height: 1.5, borderRadius: 999, transform: [{ rotate: '-7deg' }] },
  ribbonFog: { position: 'absolute', left: -38, height: 112, borderRadius: 999, backgroundColor: 'rgba(210,190,245,0.10)', opacity: 0.78, transform: [{ rotate: '-5deg' }] },
  ribbonFogReduced: { backgroundColor: 'rgba(210,190,245,0.04)', opacity: 0.34 },
  shareButton: { position: 'absolute', zIndex: 10, top: 4, right: 10, minWidth: 48, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgInteractive },
  artworkShell: { position: 'absolute', left: 0, zIndex: 4, overflow: 'visible' },
  artworkShellStacked: { position: 'relative', alignSelf: 'flex-start', marginTop: 58 },
  identity: { position: 'absolute', zIndex: 6, top: 88, right: 10, alignItems: 'flex-end' },
  identityStacked: { position: 'relative', top: 0, right: 0, alignItems: 'flex-start', marginTop: 14, paddingHorizontal: 18 },
  eyebrow: { fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: 1.7, textAlign: 'right' },
  givenNames: { color: 'rgba(255,255,255,0.76)', fontSize: 35, lineHeight: 36, fontWeight: '600', letterSpacing: -1.7, textAlign: 'right', textTransform: 'uppercase', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 7 }, textShadowRadius: 16 },
  stackedName: { maxWidth: '100%', fontSize: 31, lineHeight: 38, textAlign: 'left' },
  surname: { color: colors.textPrimary, fontSize: 42, lineHeight: 42, fontWeight: '900', letterSpacing: -2.2, textAlign: 'right', textTransform: 'uppercase', textShadowColor: 'rgba(0,0,0,0.72)', textShadowOffset: { width: 0, height: 7 }, textShadowRadius: 18 },
  stackedSurname: { maxWidth: '100%', fontSize: 38, lineHeight: 46, textAlign: 'left' },
  metaRow: { maxWidth: '100%', marginTop: 13, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 5 },
  jersey: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 10, fontWeight: '900' },
  meta: { color: colors.textSecondary, borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900' },
  leadership: { color: '#FFD52F', borderColor: 'rgba(255,213,47,0.42)' },
  teamLink: { maxWidth: '100%', minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7, marginTop: 7, paddingLeft: 8 },
  teamName: { flexShrink: 1, color: colors.textPrimary, fontSize: 12, lineHeight: 16, fontWeight: '900', textAlign: 'right' },
  awards: { zIndex: 7, marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassStroke },
  award: { minWidth: 132, flex: 1, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 15, backgroundColor: 'rgba(19,11,34,0.72)' },
  awardOpaque: { backgroundColor: '#180F28' },
  awardImage: { width: 34, height: 40 },
  awardCopy: { flex: 1, minWidth: 0 },
  awardLabel: { color: colors.textPrimary, fontSize: 11, lineHeight: 15, fontWeight: '900' },
  awardCount: { marginTop: 2, fontSize: 12, fontWeight: '900' },
});
