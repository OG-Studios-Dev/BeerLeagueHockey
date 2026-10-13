import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import TeamLogo from '../../components/TeamLogo';
import type { TeamPageSnapshot } from '../../lib/supabase/teamPage';
import { buildBroadcastTeamHeroModel } from './teamBroadcastHeroModel';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires static image requires. */
const trophyArtwork = require('../../assets/team-page/trophy.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = {
  snapshot: TeamPageSnapshot;
  compact: boolean;
  reduceTransparency: boolean;
};

export default function BroadcastTeamHero({ snapshot, compact, reduceTransparency }: Props) {
  const { team } = snapshot;
  const {
    accent,
    primaryName,
    secondaryName,
    record,
    championshipDisplay,
    championshipLabel,
    latestChampionship,
    heroLabel,
    callouts,
    ticker,
  } = buildBroadcastTeamHeroModel(snapshot);
  const logoSize = compact ? 184 : 230;

  return (
    <View
      testID="team-public-hero"
      accessible
      accessibilityLabel={heroLabel}
      style={[styles.hero, compact && styles.heroCompact]}
    >
      <LinearGradient
        colors={['#101524', '#080C16', '#07111F']}
        locations={[0, .58, 1]}
        pointerEvents="none"
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={[styles.heroAccentGlow, { backgroundColor: `${accent}24` }]} />
      <View testID="team-broadcast-subject-frame" pointerEvents="none" style={[styles.heroSubjectFrame, compact && styles.heroSubjectFrameCompact, { borderLeftColor: `${accent}99` }]} />
      <View style={styles.heroKickerRow}>
        <View testID="team-broadcast-accent" style={[styles.heroKickerBlade, { backgroundColor: accent }]} />
        <Text style={styles.heroKicker}>HOCKEY LIFE // TEAM PROFILE</Text>
      </View>
      <View style={[styles.heroNameBlock, compact && styles.heroNameBlockCompact]}>
        <Text testID="team-broadcast-name-primary" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.62} style={[styles.heroNamePrimary, compact && styles.heroNamePrimaryCompact]}>{primaryName}</Text>
        {secondaryName ? <Text testID="team-broadcast-name-secondary" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.62} style={[styles.heroNameSecondary, compact && styles.heroNameSecondaryCompact]}>{secondaryName}</Text> : null}
      </View>
      <Text testID="team-hero-record" adjustsFontSizeToFit numberOfLines={1} style={[styles.heroRecord, compact && styles.heroRecordCompact]}>{record}</Text>
      <View testID="team-broadcast-logo-stage" pointerEvents="box-none" style={[styles.heroLogoStage, compact && styles.heroLogoStageCompact]}>
        <TeamLogo
          decorative
          transparentBacking
          teamId={team.id}
          logoUrl={team.logoUrl}
          teamName={team.name}
          primaryColor={accent}
          size={logoSize}
        />
      </View>
      <View testID="team-broadcast-callouts" style={[styles.heroCallouts, compact && styles.heroCalloutsCompact]}>
        {callouts.map(([label, value], index) => (
          <View key={label} style={[styles.heroCallout, compact && styles.heroCalloutCompact, index === 2 && styles.heroCalloutWide]}>
            <Text style={styles.heroStatLabel}>{label}</Text>
            <Text testID="team-broadcast-fact-value" style={styles.heroCalloutValue}>{value}</Text>
          </View>
        ))}
      </View>
      <View
        testID="team-broadcast-championships"
        accessible
        accessibilityLabel={championshipLabel}
        style={[styles.heroChampionships, compact && styles.heroChampionshipsCompact, reduceTransparency && styles.heroChampionshipsOpaque]}
      >
        <Image testID="team-broadcast-trophy-art" source={trophyArtwork} resizeMode="contain" alt="" accessible={false} style={styles.heroTrophyArtwork} />
        <View style={styles.heroChampionshipCopy}>
          <Text style={styles.heroChampionshipCount}>{championshipDisplay}</Text>
          <Text style={styles.heroChampionshipWord}>CHAMPIONSHIPS</Text>
        </View>
      </View>
      <LinearGradient
        testID="team-broadcast-ticker"
        colors={['#6A18D7', '#D21BA4', '#FF3EAD']}
        locations={[0, .66, 1]}
        start={{ x: 0, y: .5 }}
        end={{ x: 1, y: .5 }}
        style={[styles.heroTicker, compact && styles.heroTickerCompact]}
      >
        <View style={styles.heroTickerInner}>
          {ticker.map(([label, value], index) => (
            <View key={label} style={[styles.heroTickerStat, index < ticker.length - 1 && styles.heroTickerStatBorder]}>
              <Text style={styles.heroTickerLabel}>{label}</Text>
              <Text style={styles.heroTickerValue}>{value}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>
      {latestChampionship ? (
        <View testID="team-broadcast-latest-championship" style={styles.heroLatestChampionship}>
          <View style={styles.heroLatestRule} />
          <View style={styles.heroLatestCopy}>
            <Text style={styles.heroLatestLabel}>LATEST CHAMPIONSHIP</Text>
            <Text style={styles.heroLatestValue}>{latestChampionship}</Text>
          </View>
        </View>
      ) : null}
      <LinearGradient
        testID="team-hero-transition"
        pointerEvents="none"
        colors={['rgba(7,17,31,0)', 'rgba(50,24,92,.34)', '#07111F']}
        locations={[0, .48, 1]}
        style={styles.heroTransition}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { position: 'relative', height: 520, marginHorizontal: -16, overflow: 'hidden', backgroundColor: '#07111F' },
  heroCompact: { height: 508 },
  heroAccentGlow: { position: 'absolute', zIndex: 1, right: -76, top: -54, width: 292, height: 292, borderRadius: 146, opacity: .58 },
  heroSubjectFrame: { position: 'absolute', zIndex: 2, right: -20, top: 18, width: 250, height: 282, overflow: 'visible', borderLeftWidth: 1, backgroundColor: 'rgba(255,62,173,.07)', transform: [{ skewX: '-7deg' }] },
  heroSubjectFrameCompact: { right: -12, top: 32, width: 202, height: 252 },
  heroKickerRow: { position: 'absolute', zIndex: 7, left: 18, top: 18, flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroKickerBlade: { width: 3, height: 10, borderRadius: 2 },
  heroKicker: { color: '#FF69D4', fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 1.8 },
  heroNameBlock: { position: 'absolute', zIndex: 7, left: 18, top: 51, width: 160 },
  heroNameBlockCompact: { top: 55, width: 126 },
  heroNamePrimary: { color: '#FFFFFF', fontSize: 44, lineHeight: 42, fontWeight: '900', letterSpacing: -1.5, textTransform: 'uppercase' },
  heroNamePrimaryCompact: { fontSize: 37, lineHeight: 36 },
  heroNameSecondary: { color: 'rgba(255,255,255,.54)', fontSize: 42, lineHeight: 39, fontWeight: '900', letterSpacing: -1.4, textTransform: 'uppercase', textShadowColor: 'rgba(255,255,255,.42)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 1 },
  heroNameSecondaryCompact: { fontSize: 34, lineHeight: 33 },
  heroRecord: { position: 'absolute', zIndex: 7, left: 18, top: 144, width: 154, color: '#F7FBFF', fontSize: 42, lineHeight: 48, fontWeight: '900', letterSpacing: -1.7 },
  heroRecordCompact: { top: 151, width: 126, fontSize: 36, lineHeight: 43 },
  heroLogoStage: { position: 'absolute', zIndex: 5, right: 3, top: 42, width: 230, height: 240, overflow: 'visible', alignItems: 'center', justifyContent: 'center' },
  heroLogoStageCompact: { right: 4, top: 62, width: 184, height: 196 },
  heroCallouts: { position: 'absolute', zIndex: 8, left: 18, top: 211, width: 126, flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.17)', paddingTop: 11 },
  heroCalloutsCompact: { left: 16, top: 218, width: 116, columnGap: 8, rowGap: 11 },
  heroCallout: { width: 56, minWidth: 0 },
  heroCalloutCompact: { width: 52 },
  heroCalloutWide: { width: '100%' },
  heroStatLabel: { color: '#8F9BB0', fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 1.05 },
  heroCalloutValue: { marginTop: 4, color: '#F8FBFF', fontSize: 22, lineHeight: 25, fontWeight: '900', fontVariant: ['tabular-nums'] },
  heroChampionships: { position: 'absolute', zIndex: 10, right: 18, top: 288, minWidth: 142, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, borderLeftWidth: 1, borderLeftColor: 'rgba(244,200,102,.6)', backgroundColor: 'rgba(5,8,15,.78)', paddingVertical: 3, paddingHorizontal: 8 },
  heroChampionshipsCompact: { right: 10, top: 286, minWidth: 136 },
  heroChampionshipsOpaque: { backgroundColor: '#05080F' },
  heroTrophyArtwork: { width: 38, height: 52 },
  heroChampionshipCopy: { alignItems: 'flex-start', gap: 1 },
  heroChampionshipCount: { color: '#F4C866', fontSize: 18, lineHeight: 20, fontWeight: '900', letterSpacing: .4 },
  heroChampionshipWord: { color: '#D7C38C', fontSize: 7, lineHeight: 9, fontWeight: '900', letterSpacing: 1 },
  heroTicker: { position: 'absolute', zIndex: 9, left: -5, right: -5, top: 354, height: 84, justifyContent: 'center', transform: [{ rotate: '-2deg' }] },
  heroTickerCompact: { top: 350, height: 82 },
  heroTickerInner: { height: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, transform: [{ rotate: '2deg' }] },
  heroTickerStat: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  heroTickerStatBorder: { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,.26)' },
  heroTickerLabel: { color: 'rgba(255,255,255,.74)', fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 1.05 },
  heroTickerValue: { marginTop: 6, color: '#FFFFFF', fontSize: 25, lineHeight: 29, fontWeight: '900', fontVariant: ['tabular-nums'] },
  heroLatestChampionship: { position: 'absolute', zIndex: 8, left: 18, right: 18, top: 453, minHeight: 36, flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  heroLatestRule: { width: 2, borderRadius: 1, backgroundColor: '#F4C866' },
  heroLatestCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  heroLatestLabel: { color: '#8E9AAF', fontSize: 8, lineHeight: 10, fontWeight: '800', letterSpacing: .9 },
  heroLatestValue: { marginTop: 2, color: '#F7FBFF', fontSize: 10, lineHeight: 13, fontWeight: '900' },
  heroTransition: { position: 'absolute', zIndex: 6, left: 0, right: 0, bottom: 0, height: 58 },
});
