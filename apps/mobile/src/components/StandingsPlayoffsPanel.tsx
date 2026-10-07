import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import trophy from '../../assets/playoff-trophy.png';
import type { StandingsFact } from '../lib/standingsModel';
import colors from '../theme/colors';
import { SECTION_HEADING_TEXT_STYLE } from './SectionHeader';
import TeamLogo from './TeamLogo';

type Seed = StandingsFact;
type Matchup = { highSeed: Seed; lowSeed: Seed | null; highRank: number; lowRank: number | null };
type Picture = { status: 'ready'; groups: Array<{ key: string; name: string | null; qualifierCount: number; rounds: Array<{ roundNumber: number; label: string }>; matchups: Matchup[] }> }
  | { status: 'unavailable'; reason: string; groups: unknown[] };
type Predictor = { status: 'ready'; teams: Array<{ teamId: string; firstPlace: number; makePlayoffs: number }> }
  | { status: 'unavailable'; reason: string; teams?: undefined };

type Segment = { x1: number; y1: number; x2: number; y2: number };
const BRACKET_GOLD = '#8f7a4b';
const BRACKET_GOLD_SOFT = 'rgba(143,122,75,0.26)';
const CONNECTOR_WIDTH = 2.25;
export const CANONICAL_BRACKET_GEOMETRY = {
  width: 520, height: 446,
  nodes: {
    seed1: { left: 0, top: 4 }, seed4: { left: 0, top: 114 }, seed2: { left: 0, top: 248 }, seed3: { left: 0, top: 358 },
    semi1: { left: 156, top: 60 }, semi2: { left: 156, top: 304 }, trophy: { left: 292, top: 154 }, winner: { left: 442, top: 184 },
  },
  segments: [
    { x1: 78, y1: 43, x2: 96, y2: 43 }, { x1: 78, y1: 153, x2: 96, y2: 153 }, { x1: 96, y1: 43, x2: 96, y2: 153 }, { x1: 96, y1: 99, x2: 156, y2: 99 },
    { x1: 78, y1: 287, x2: 96, y2: 287 }, { x1: 78, y1: 397, x2: 96, y2: 397 }, { x1: 96, y1: 287, x2: 96, y2: 397 }, { x1: 96, y1: 343, x2: 156, y2: 343 },
    { x1: 234, y1: 99, x2: 254, y2: 99 }, { x1: 234, y1: 343, x2: 254, y2: 343 }, { x1: 254, y1: 99, x2: 254, y2: 343 }, { x1: 254, y1: 215, x2: 280, y2: 215 },
    { x1: 412, y1: 223, x2: 442, y2: 223 },
  ] as Segment[],
};

export function bracketConnectorStyle(segment: Segment) {
  const horizontal = segment.y1 === segment.y2;
  return horizontal
    ? { left: Math.min(segment.x1, segment.x2), top: segment.y1 - CONNECTOR_WIDTH / 2, width: Math.abs(segment.x2 - segment.x1), height: CONNECTOR_WIDTH }
    : { left: segment.x1 - CONNECTOR_WIDTH / 2, top: Math.min(segment.y1, segment.y2), width: CONNECTOR_WIDTH, height: Math.abs(segment.y2 - segment.y1) };
}

function percent(value: number) {
  const amount = value * 100;
  if (amount <= 0) return '<1%';
  if (amount >= 100) return '100%';
  return amount >= 10 ? `${Math.round(amount)}%` : `${amount.toFixed(1)}%`;
}

function NodeInset({ testID }: { testID: string }) {
  return <View testID={`${testID}-inset`} pointerEvents="none" style={styles.nodeInset} />;
}

function SeedNode({ team, rank, testID, style }: { team: Seed; rank: number; testID: string; style: object }) {
  return <View testID={testID} accessibilityLabel={`${rank} seed, ${team.teamName}`} style={[styles.bracketNode, style]}>
    <NodeInset testID={testID} />
    <TeamLogo teamId={team.teamId} logoUrl={team.logoUrl} teamName={team.teamName} primaryColor={team.primaryColor} size={48} />
    <View style={styles.rankBadge}><Text style={styles.rankText}>{rank}</Text></View>
  </View>;
}

function ShieldNode({ label, testID, style }: { label: string; testID: string; style?: object }) {
  return <View testID={testID} accessibilityLabel={label} style={[styles.bracketNode, style]}>
    <NodeInset testID={testID} />
    <Ionicons name="shield-outline" size={31} color={colors.textSecondary} />
  </View>;
}

function Connector({ segment, index }: { segment: Segment; index: number }) {
  return <View testID={`bracket-connector-${index}`} style={[styles.connector, bracketConnectorStyle(segment)]} />;
}

function SeedSlot({ team, rank, slot, position }: { team: Seed | null; rank: number | null; slot: string; position: object }) {
  if (team && rank) return <SeedNode team={team} rank={rank} testID={`bracket-node-${slot}`} style={position} />;
  return <ShieldNode label="Unresolved seed" testID={`bracket-node-${slot}`} style={position} />;
}

function ConnectedBracket({ group }: { group: Extract<Picture, { status: 'ready' }>['groups'][number] }) {
  const seriesA = group.matchups[0];
  const seriesB = group.matchups[1];
  const geometry = CANONICAL_BRACKET_GEOMETRY;
  return <View style={styles.group}>
    {group.name ? <Text style={styles.groupTitle}>{group.name}</Text> : null}
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bracketScroll}>
      <View testID="playoff-connected-bracket" style={styles.bracketCanvas}>
        {group.rounds[0] ? <Text testID="bracket-round-label-1" style={[styles.roundLabel, { left: 0 }]}>{group.rounds[0].label}</Text> : null}
        {group.rounds[1] ? <Text testID="bracket-round-label-2" style={[styles.roundLabel, { left: 296 }]}>{group.rounds[1].label}</Text> : null}
        <SeedSlot team={seriesA?.highSeed ?? null} rank={seriesA?.highRank ?? null} slot="1" position={geometry.nodes.seed1} />
        <SeedSlot team={seriesA?.lowSeed ?? null} rank={seriesA?.lowRank ?? null} slot="4" position={geometry.nodes.seed4} />
        <SeedSlot team={seriesB?.highSeed ?? null} rank={seriesB?.highRank ?? null} slot="2" position={geometry.nodes.seed2} />
        <SeedSlot team={seriesB?.lowSeed ?? null} rank={seriesB?.lowRank ?? null} slot="3" position={geometry.nodes.seed3} />
        <ShieldNode label="Unresolved next-round team" testID="bracket-node-semi-1" style={geometry.nodes.semi1} />
        <ShieldNode label="Unresolved next-round team" testID="bracket-node-semi-2" style={geometry.nodes.semi2} />
        <Image alt="Championship trophy" source={trophy} accessibilityLabel="Championship trophy" resizeMode="contain" style={[styles.trophy, geometry.nodes.trophy]} />
        <ShieldNode label="Unresolved champion" testID="bracket-node-winner" style={geometry.nodes.winner} />
        {geometry.segments.map((segment, index) => <Connector key={index} segment={segment} index={index} />)}
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
      ? picture.groups.map((group) => <ConnectedBracket key={group.key} group={group} />)
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
  title: { ...SECTION_HEADING_TEXT_STYLE, color: colors.textPrimary }, tabs: { flexDirection: 'row', borderRadius: 24, borderWidth: 1, borderColor: colors.borderCard, padding: 3 },
  tab: { minHeight: 44, minWidth: 72, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, tabText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  group: { gap: 8 }, groupTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900' }, bracketScroll: { paddingTop: 22, paddingBottom: 8 },
  bracketCanvas: { width: 520, height: 446, position: 'relative' }, roundLabel: { position: 'absolute', top: -24, color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  bracketNode: { position: 'absolute', width: 78, height: 78, borderRadius: 18, borderWidth: 2, borderColor: BRACKET_GOLD, backgroundColor: '#16130f', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.26, shadowRadius: 14, elevation: 8 },
  nodeInset: { position: 'absolute', inset: 7, borderRadius: 13, borderWidth: 1, borderColor: BRACKET_GOLD_SOFT },
  rankBadge: { position: 'absolute', right: -6, bottom: -6, minWidth: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: BRACKET_GOLD, backgroundColor: '#2A2114', alignItems: 'center', justifyContent: 'center' }, rankText: { color: '#EFE2BD', fontSize: 11, fontWeight: '900' },
  trophy: { position: 'absolute', width: 120, height: 120 }, connector: { position: 'absolute', opacity: 0.95, backgroundColor: BRACKET_GOLD, borderRadius: CONNECTOR_WIDTH / 2 },
  unavailable: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }, oddsTable: { minWidth: 520 },
  oddsHeader: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderCard, paddingVertical: 10 },
  headerText: { width: 112, color: colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.3 }, teamColumn: { width: 112, alignItems: 'center' },
  oddsRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderCard }, record: { width: 112, color: colors.textPrimary, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  probability: { width: 112, color: colors.textPrimary, fontSize: 13, fontWeight: '900', textAlign: 'center' }, barTrack: { width: 64, height: 6, borderRadius: 3, backgroundColor: colors.bgInteractive, alignSelf: 'center', overflow: 'hidden', marginTop: 5 }, barFill: { height: 6, borderRadius: 3 },
  smallRank: { position: 'absolute', right: -5, bottom: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.bgInteractive, alignItems: 'center', justifyContent: 'center' }, smallRankText: { color: colors.textSecondary, fontSize: 9, fontWeight: '900' },
});
