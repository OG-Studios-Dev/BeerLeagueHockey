import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import trophy from '../../assets/playoff-trophy.png';
import type { StandingsFact } from '../lib/standingsModel';
import colors from '../theme/colors';
import TeamLogo from './TeamLogo';

type Seed = StandingsFact;
type Matchup = { highSeed: Seed; lowSeed: Seed | null; highRank: number; lowRank: number | null };
type Picture = { status: 'ready'; groups: Array<{ key: string; name: string | null; qualifierCount: number; matchups: Matchup[] }> }
  | { status: 'unavailable'; reason: string; groups: unknown[] };
type Predictor = { status: 'ready'; teams: Array<{ teamId: string; firstPlace: number; makePlayoffs: number }> }
  | { status: 'unavailable'; reason: string; teams?: undefined };

function percent(value: number) {
  const amount = value * 100;
  if (amount <= 0) return '<1%';
  if (amount >= 100) return '100%';
  return amount >= 10 ? `${Math.round(amount)}%` : `${amount.toFixed(1)}%`;
}

function SeedNode({ team, rank, accentColor }: { team: Seed; rank: number; accentColor: string }) {
  return <View accessibilityLabel={`${rank} seed, ${team.teamName}`} style={[styles.seedNode, { borderColor: accentColor }]}>
    <TeamLogo teamId={team.teamId} logoUrl={team.logoUrl} teamName={team.teamName} primaryColor={team.primaryColor} size={48} />
    <View style={[styles.rankBadge, { borderColor: accentColor }]}><Text style={styles.rankText}>{rank}</Text></View>
  </View>;
}

function ShieldNode({ accentColor, label }: { accentColor: string; label: string }) {
  return <View accessibilityLabel={label} style={[styles.shieldNode, { borderColor: accentColor }]}>
    <Ionicons name="shield-outline" size={31} color={colors.textSecondary} />
  </View>;
}

function Connector({ style, accentColor }: { style: object; accentColor: string }) {
  return <View testID="bracket-connector" style={[styles.connector, style, { backgroundColor: accentColor }]} />;
}

function ConnectedBracket({ group, accentColor }: { group: Extract<Picture, { status: 'ready' }>['groups'][number]; accentColor: string }) {
  return <View style={styles.group}>
    {group.name ? <Text style={styles.groupTitle}>{group.name}</Text> : null}
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bracketScroll}>
      <View testID="playoff-connected-bracket" style={styles.bracketCanvas}>
        <Text style={[styles.roundLabel, { left: 0 }]}>First Round</Text><Text style={[styles.roundLabel, { left: 292 }]}>Final</Text>
        <View style={styles.firstRound}>
          {group.matchups.map((matchup) => <View key={matchup.highSeed.teamId} style={styles.matchupPair}>
            <SeedNode team={matchup.highSeed} rank={matchup.highRank} accentColor={accentColor} />
            {matchup.lowSeed && matchup.lowRank ? <SeedNode team={matchup.lowSeed} rank={matchup.lowRank} accentColor={accentColor} /> : <View style={styles.bye}><Text style={styles.byeText}>BYE</Text></View>}
          </View>)}
        </View>
        <View style={styles.semifinalColumn}>{group.matchups.map((matchup) => <ShieldNode key={matchup.highSeed.teamId} accentColor={accentColor} label="Unresolved next-round team" />)}</View>
        <Image source={trophy} accessibilityLabel="Championship trophy" resizeMode="contain" style={styles.trophy} />
        <View style={styles.winner}><ShieldNode accentColor={accentColor} label="Unresolved champion" /></View>
        <Connector accentColor={accentColor} style={{ left: 78, top: 84, width: 74, height: 2 }} />
        <Connector accentColor={accentColor} style={{ left: 78, top: 194, width: 74, height: 2 }} />
        <Connector accentColor={accentColor} style={{ left: 110, top: 84, width: 2, height: 112 }} />
        <Connector accentColor={accentColor} style={{ left: 234, top: 123, width: 44, height: 2 }} />
        <Connector accentColor={accentColor} style={{ left: 234, top: 321, width: 44, height: 2 }} />
        <Connector accentColor={accentColor} style={{ left: 256, top: 123, width: 2, height: 200 }} />
        <Connector accentColor={accentColor} style={{ left: 408, top: 222, width: 34, height: 2 }} />
      </View>
    </ScrollView>
  </View>;
}

function Probability({ value, color }: { value: number; color: string }) {
  return <View><Text style={styles.probability}>{percent(value)}</Text><View style={styles.barTrack}><View testID="playoff-probability-bar" style={[styles.barFill, { width: `${Math.max(2, Math.min(100, value * 100))}%`, backgroundColor: color }]} /></View></View>;
}

export default function StandingsPlayoffsPanel({ picture, predictor, standings, accentColor }: {
  picture: Picture; predictor: Predictor; standings: StandingsFact[]; accentColor: string;
}) {
  const [panel, setPanel] = React.useState<'preview' | 'odds'>('preview');
  const odds = predictor.status === 'ready' ? new Map(predictor.teams.map((team) => [team.teamId, team])) : new Map();
  const ordered = [...standings].sort((left, right) => {
    const leftOdds = odds.get(left.teamId); const rightOdds = odds.get(right.teamId);
    return (rightOdds?.makePlayoffs ?? 0) - (leftOdds?.makePlayoffs ?? 0) || (rightOdds?.firstPlace ?? 0) - (leftOdds?.firstPlace ?? 0);
  });
  return <View style={styles.section}>
    <View style={styles.heading}><Text style={styles.title}>Playoffs</Text><View style={styles.tabs}>
      <Pressable accessibilityRole="button" accessibilityLabel="Show playoff preview" accessibilityState={{ selected: panel === 'preview' }} onPress={() => setPanel('preview')} style={[styles.tab, panel === 'preview' && { backgroundColor: accentColor }]}><Text style={styles.tabText}>Preview</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Show playoff odds" accessibilityState={{ selected: panel === 'odds' }} onPress={() => setPanel('odds')} style={[styles.tab, panel === 'odds' && { backgroundColor: accentColor }]}><Text style={styles.tabText}>Odds</Text></Pressable>
    </View></View>
    {panel === 'preview' ? picture.status === 'ready'
      ? picture.groups.map((group) => <ConnectedBracket key={group.key} group={group} accentColor={accentColor} />)
      : <Text style={styles.unavailable}>{picture.reason}</Text>
      : predictor.status === 'ready' ? <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}><View style={styles.oddsTable}>
        <View style={styles.oddsHeader}><Text style={[styles.headerText, styles.teamColumn]}>Team</Text><Text style={styles.headerText}>Record</Text><Text style={styles.headerText}>1st Place</Text><Text style={styles.headerText}>Make Playoffs</Text></View>
        {ordered.map((team, index) => { const value = odds.get(team.teamId)!; return <View key={team.teamId} style={styles.oddsRow}>
          <View style={styles.teamColumn}><View><TeamLogo teamId={team.teamId} logoUrl={team.logoUrl} teamName={team.teamName} primaryColor={team.primaryColor} size={48} /><View style={styles.smallRank}><Text style={styles.smallRankText}>{index + 1}</Text></View></View></View>
          <Text style={styles.record}>{team.wins}-{team.losses}-{team.ties}</Text>
          <Probability value={value.firstPlace} color={accentColor} />
          <Probability value={value.makePlayoffs} color={value.makePlayoffs >= 0.5 ? '#4ADE80' : value.makePlayoffs >= 0.2 ? '#FACC15' : '#F87171'} />
        </View>; })}
      </View></ScrollView> : <Text style={styles.unavailable}>{predictor.reason}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 16 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '900' }, tabs: { flexDirection: 'row', borderRadius: 24, borderWidth: 1, borderColor: colors.borderCard, padding: 3 },
  tab: { minHeight: 44, minWidth: 72, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, tabText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  group: { gap: 8 }, groupTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900' }, bracketScroll: { paddingTop: 22, paddingBottom: 8 },
  bracketCanvas: { width: 520, height: 420, position: 'relative' }, roundLabel: { position: 'absolute', top: 0, color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  firstRound: { position: 'absolute', left: 0, top: 30, gap: 24 }, matchupPair: { gap: 14 },
  seedNode: { width: 78, height: 78, borderRadius: 18, borderWidth: 2, backgroundColor: '#171410', alignItems: 'center', justifyContent: 'center' },
  rankBadge: { position: 'absolute', right: -6, bottom: -6, minWidth: 24, height: 24, borderRadius: 12, borderWidth: 2, backgroundColor: '#2A2114', alignItems: 'center', justifyContent: 'center' }, rankText: { color: '#EFE2BD', fontSize: 11, fontWeight: '900' },
  bye: { width: 78, height: 78, alignItems: 'center', justifyContent: 'center' }, byeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  semifinalColumn: { position: 'absolute', left: 156, top: 84, gap: 120 }, shieldNode: { width: 78, height: 78, borderRadius: 18, borderWidth: 2, backgroundColor: '#171410', alignItems: 'center', justifyContent: 'center' },
  trophy: { position: 'absolute', left: 292, top: 162, width: 120, height: 120 }, winner: { position: 'absolute', left: 442, top: 184 }, connector: { position: 'absolute', opacity: 0.9 },
  unavailable: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }, oddsTable: { minWidth: 520 },
  oddsHeader: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderCard, paddingVertical: 10 },
  headerText: { width: 112, color: colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.3 }, teamColumn: { width: 112, alignItems: 'center' },
  oddsRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderCard }, record: { width: 112, color: colors.textPrimary, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  probability: { width: 112, color: colors.textPrimary, fontSize: 13, fontWeight: '900', textAlign: 'center' }, barTrack: { width: 64, height: 6, borderRadius: 3, backgroundColor: colors.bgInteractive, alignSelf: 'center', overflow: 'hidden', marginTop: 5 }, barFill: { height: 6, borderRadius: 3 },
  smallRank: { position: 'absolute', right: -5, bottom: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.bgInteractive, alignItems: 'center', justifyContent: 'center' }, smallRankText: { color: colors.textSecondary, fontSize: 9, fontWeight: '900' },
});
