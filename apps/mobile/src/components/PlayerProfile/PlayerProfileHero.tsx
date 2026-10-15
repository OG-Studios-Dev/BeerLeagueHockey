import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import colors from '../../theme/colors';
import { getContrastTextColor } from '../../theme/contrast';
import {
  PLAYER_ARTWORK_LEAGUE_ID,
  loadPlayerArtworkManifest,
  resolvePlayerProfileArtwork,
  type PlayerArtworkManifest,
  type PlayerProfileArtwork,
} from '../../lib/playerArtworkManifest';
import TeamLogo from '../TeamLogo';
import { getPlayerProfileHeroLayout, splitPlayerDisplayName } from './playerProfileHeroModel';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires a static bundled image reference. */
const neutralSkaterArtwork = require('../../../assets/league-leaders/neutral-helmet-player.png');
const neutralGoalieArtwork = require('../../../assets/league-leaders/neutral-goalie.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type PlayerProfileHeroProps = {
  playerId: string;
  photoUrl: string | null;
  fullName: string;
  jerseyNumber: number | null;
  position: string | null;
  isGoalie: boolean;
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

type PlayerProfileArtworkImageProps = {
  artwork: PlayerProfileArtwork;
  isGoalie: boolean;
  width: number;
  height: number;
};

function PlayerProfileArtworkImage({ artwork, isGoalie, width, height }: PlayerProfileArtworkImageProps) {
  const [remoteFailed, setRemoteFailed] = React.useState(false);
  const lifecycle = React.useRef({ mounted: true, failed: false });
  React.useLayoutEffect(() => {
    const owner = lifecycle.current;
    owner.mounted = true;
    return () => { owner.mounted = false; };
  }, []);
  const remoteActive = artwork.kind === 'remote' && !remoteFailed;
  const source = remoteActive
    ? { uri: artwork.uri, cache: 'force-cache' as const }
    : isGoalie ? neutralGoalieArtwork : neutralSkaterArtwork;
  const handleRemoteError = remoteActive ? () => {
    if (!lifecycle.current.mounted || lifecycle.current.failed) return;
    lifecycle.current.failed = true;
    setRemoteFailed(true);
  } : undefined;

  return <Image
    testID="player-profile-rink-ribbon-artwork"
    source={source}
    onError={handleRemoteError}
    alt=""
    resizeMode="contain"
    accessible={false}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={{ width, height }}
  />;
}

export default function PlayerProfileHero({
  playerId,
  photoUrl,
  fullName,
  jerseyNumber,
  position,
  isGoalie,
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
  const artworkIdentity = `${playerId}:${photoUrl ?? 'no-photo'}:${isGoalie ? 'goalie' : 'skater'}`;
  const [loadedManifest, setLoadedManifest] = React.useState<{
    identity: string;
    manifest: PlayerArtworkManifest | null;
  } | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void loadPlayerArtworkManifest({ signal: controller.signal }).then(
      (manifest) => {
        if (active) setLoadedManifest({ identity: artworkIdentity, manifest });
      },
      () => {
        if (active) setLoadedManifest({ identity: artworkIdentity, manifest: null });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [artworkIdentity]);
  const artwork = resolvePlayerProfileArtwork({
    manifest: loadedManifest?.identity === artworkIdentity ? loadedManifest.manifest : null,
    leagueId: PLAYER_ARTWORK_LEAGUE_ID,
    playerId,
    photoUrl,
    isGoalie,
  });
  const surnameLetters = Array.from(displayName.surname);
  const surnameLetterSize = surnameLetters.length > 10 ? 13 : surnameLetters.length > 7 ? 16 : 20;
  const visibleAwards = awards.filter((award) => award.count > 0);
  const [identityBottom, setIdentityBottom] = React.useState(0);
  const handleIdentityLayout = React.useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const measuredBottom = y + height;
    setIdentityBottom((current) => Math.abs(current - measuredBottom) < 0.5 ? current : measuredBottom);
  }, []);
  const flowBoundary = layout.stacked ? layout.stageHeight : Math.max(layout.stageHeight, identityBottom);
  return (
    <View testID="player-profile-rink-ribbon-hero" style={[styles.hero, { minHeight: flowBoundary }]}>
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
          testID="player-profile-rink-ribbon-content-bed"
          style={[styles.contentBed, { top: layout.stageHeight - 72 }]}
        />
        <View
          testID="player-profile-rink-ribbon-purple-rail"
          style={[styles.purpleRail, { top: layout.stageHeight - 86, width: layout.canvasWidth + 138 }]}
        />
        <View
          testID="player-profile-rink-ribbon-yellow-rail"
          style={[styles.yellowRail, { top: layout.stageHeight - 53, width: layout.canvasWidth + 112 }]}
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
        <PlayerProfileArtworkImage
          key={artwork.identityKey}
          artwork={artwork}
          isGoalie={isGoalie}
          width={layout.artWidth}
          height={layout.artHeight}
        />
      </View>

      <View
        testID="player-profile-rink-ribbon-identity"
        onLayout={layout.stacked ? undefined : handleIdentityLayout}
        style={[styles.identity, layout.stacked && styles.identityStacked, { width: layout.identityWidth }]}
      >
        <Text style={styles.eyebrow}>FEATURED PLAYER</Text>
        {layout.stacked ? <>
          {displayName.givenNames ? <Text style={[styles.givenNames, styles.stackedName]}>{displayName.givenNames}</Text> : null}
          <Text testID="player-profile-rink-ribbon-surname" style={[styles.surname, styles.stackedSurname]}>{displayName.surname}</Text>
        </> : <View style={styles.nameLockup}>
          {displayName.givenNames ? <Text
            adjustsFontSizeToFit
            minimumFontScale={0.58}
            numberOfLines={3}
            style={styles.givenNames}
          >{displayName.givenNames}</Text> : null}
          <View
            testID="player-profile-rink-ribbon-surname"
            accessible
            accessibilityLabel={displayName.surname}
            style={styles.surnameColumn}
          >
            {surnameLetters.map((letter, index) => <Text
              key={`${letter}-${index}`}
              accessible={false}
              importantForAccessibility="no"
              style={[styles.surnameLetter, { fontSize: surnameLetterSize, lineHeight: surnameLetterSize + 1 }]}
            >{letter}</Text>)}
          </View>
        </View>}
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
        style={[styles.awards, { marginTop: layout.stacked ? 22 : flowBoundary }]}
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
  contentBed: { position: 'absolute', zIndex: 1, left: 0, right: 0, minHeight: 148, backgroundColor: 'rgba(16,9,29,0.88)' },
  purpleRail: { position: 'absolute', zIndex: 2, left: -76, height: 126, borderRadius: 999, backgroundColor: '#7A3FC3', opacity: 0.56, transform: [{ rotate: '-8deg' }] },
  yellowRail: { position: 'absolute', zIndex: 3, left: -56, height: 5, borderRadius: 999, backgroundColor: '#FFD52F', transform: [{ rotate: '-8deg' }] },
  ribbonFog: { position: 'absolute', left: -38, height: 112, borderRadius: 999, backgroundColor: 'rgba(210,190,245,0.10)', opacity: 0.78, transform: [{ rotate: '-5deg' }] },
  ribbonFogReduced: { backgroundColor: 'rgba(210,190,245,0.04)', opacity: 0.34 },
  shareButton: { position: 'absolute', zIndex: 10, top: 4, right: 10, minWidth: 48, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgInteractive },
  artworkShell: { position: 'absolute', left: 0, zIndex: 4, overflow: 'visible' },
  artworkShellStacked: { position: 'relative', alignSelf: 'flex-start', marginTop: 58 },
  identity: { position: 'absolute', zIndex: 6, top: 84, right: 10, alignItems: 'flex-end' },
  identityStacked: { position: 'relative', top: 0, right: 0, alignItems: 'flex-start', marginTop: 14, paddingHorizontal: 18 },
  eyebrow: { color: '#FFD52F', fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: 1.7, textAlign: 'right' },
  nameLockup: { maxWidth: '100%', minHeight: 150, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  givenNames: { flex: 1, minWidth: 0, color: 'rgba(255,255,255,0.76)', fontSize: 34, lineHeight: 34, fontWeight: '600', letterSpacing: -1.7, textAlign: 'right', textTransform: 'uppercase', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 7 }, textShadowRadius: 16 },
  stackedName: { maxWidth: '100%', fontSize: 31, lineHeight: 38, textAlign: 'left' },
  surname: { color: colors.textPrimary, fontSize: 42, lineHeight: 42, fontWeight: '900', letterSpacing: -2.2, textAlign: 'right', textTransform: 'uppercase', textShadowColor: 'rgba(0,0,0,0.72)', textShadowOffset: { width: 0, height: 7 }, textShadowRadius: 18 },
  surnameColumn: { flexDirection: 'column', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 4, borderLeftWidth: 2, borderLeftColor: '#FFD52F' },
  surnameLetter: { color: colors.textPrimary, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase', textShadowColor: 'rgba(0,0,0,0.72)', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 12 },
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
