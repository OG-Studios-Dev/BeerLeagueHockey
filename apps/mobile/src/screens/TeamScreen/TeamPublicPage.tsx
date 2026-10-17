import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, ImageBackground, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import CarouselPager from '../../components/CarouselPager';
import { FocusCard } from '../../components/CardFocus';
import LeagueLeadersPresentation from '../../components/LeagueLeadersPresentation';
import ScheduleMatchupCard from '../../components/ScheduleMatchupCard';
import { SECTION_HEADING_TEXT_STYLE } from '../../components/SectionHeader';
import { SelectableControl, SelectableControlGroup } from '../../components/SelectableControl';
import TeamLogo from '../../components/TeamLogo';
import type { HomeLeaderMetric } from '../../lib/homeLeagueLeaders';
import { splitLeagueLeaderName } from '../../lib/leaderPresentation';
import { selectTeamScheduleGames } from '../../lib/schedulePresentation';
import type { GameRow } from '../../lib/supabase/data';
import type { TeamPageGame, TeamPageRival, TeamPageRosterPlayer, TeamPageSnapshot } from '../../lib/supabase/teamPage';
import { formatPublicMetric } from '../../lib/supabase/publicStats';
import colors from '../../theme/colors';
import { resolveFocusAccent } from '../../theme/focusAccent';
import { ui } from '../../theme/ui';
import BroadcastTeamHero from './BroadcastTeamHero';
import TeamCaptainContact from './TeamCaptainContact';
import { resolveTeamRosterJerseyVariant, type TeamRosterJerseyVariant } from './teamRosterJerseyVariant';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires static image requires. */
const weeklyGamesBackground = require('../../assets/team-page/weekly-games-bg.jpg');
const jerseyBackBadBunny = require('../../assets/team-page/jersey-back-bad-bunny.png');
const jerseyBackFirstGeneralLondon = require('../../assets/team-page/jersey-back-first-general-london.png');
const jerseyBackLiuna = require('../../assets/team-page/jersey-back-liuna.png');
const jerseyBackFitzrays = require('../../assets/team-page/jersey-back-fitzrays.png');
const jerseyBackFallback = require('../../assets/team-page/jersey-back-fallback.png');
/* eslint-enable @typescript-eslint/no-require-imports */

const JERSEY_ART: Record<TeamRosterJerseyVariant, number> = {
  'bad-bunny': jerseyBackBadBunny,
  'first-general-london': jerseyBackFirstGeneralLondon,
  liuna: jerseyBackLiuna,
  fitzrays: jerseyBackFitzrays,
  fallback: jerseyBackFallback,
};

const JERSEY_LETTERING: Record<TeamRosterJerseyVariant, { fill: string; outline: string }> = {
  'bad-bunny': { fill: '#FFFFFF', outline: '#F34A9A' },
  'first-general-london': { fill: '#FFFFFF', outline: '#71C7F2' },
  liuna: { fill: '#111317', outline: '#FFFFFF' },
  fitzrays: { fill: '#FFFFFF', outline: '#E2303E' },
  fallback: { fill: '#FFFFFF', outline: '#8995A8' },
};

function gameStatus(status: string | null): string {
  return status === 'completed' ? 'Final' : status === 'pending_verification' ? 'Pending verification' : status === 'in_progress' || status === 'live' ? 'Live' : (status ?? 'Scheduled').replace(/_/g, ' ');
}

function gameLabel(game: TeamPageGame, timeZone: string): string {
  const scores = ['completed', 'pending_verification', 'in_progress', 'live'].includes(game.status ?? '')
    ? `, ${game.awayTeam.name} ${nullableDisplay(game.awayScore)}, ${game.homeTeam.name} ${nullableDisplay(game.homeScore)}` : '';
  return `${game.awayTeam.name} at ${game.homeTeam.name}, ${formatDate(game.scheduledAt, timeZone)}, ${formatTime(game.scheduledAt, timeZone)}, ${game.location ?? 'Venue TBD'}, ${gameStatus(game.status)}${scores}. Open game.`;
}

function nullableDisplay(value: number | null | undefined, prefix = ''): string {
  return value == null ? '—' : `${prefix}${value}`;
}

function recordedDisplay(value: number | null | undefined, provenance: TeamPageRosterPlayer['gamesPlayedProvenance'], digits?: number): string {
  if (value == null || provenance === 'estimated') return '—';
  return digits == null ? String(value) : value.toFixed(digits);
}

function formatDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone });
}

function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone });
}

function positionBucket(player: Pick<TeamPageRosterPlayer, 'position' | 'isGoalie'>): 'forward' | 'defence' | 'goalie' {
  if (player.isGoalie) return 'goalie';
  const position = player.position?.trim().toLowerCase() ?? '';
  if (['g', 'goalie', 'goaltender'].includes(position)) return 'goalie';
  if (['d', 'defence', 'defense', 'defenceman', 'defenseman', 'ld', 'rd'].includes(position)) return 'defence';
  return 'forward';
}

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || name).toUpperCase();
}

type LineupSlot = 'forward' | 'defence' | 'goalie';
type DisplayRosterPlayer = Pick<TeamPageRosterPlayer, 'playerId' | 'name' | 'jerseyNumber' | 'position' | 'isGoalie' | 'leadershipRole' | 'playerType'> & {
  isSubstitute: boolean;
  slotIndex?: number;
  slot?: LineupSlot;
};

const LINEUP_COORDS: Record<LineupSlot, Array<{ x: number; y: number }>> = {
  forward: [{ x: 28, y: 22 }, { x: 50, y: 22 }, { x: 72, y: 22 }, { x: 28, y: 38 }, { x: 50, y: 38 }, { x: 72, y: 38 }, { x: 28, y: 48 }, { x: 50, y: 48 }, { x: 72, y: 48 }],
  defence: [{ x: 35, y: 58 }, { x: 65, y: 58 }, { x: 35, y: 72 }, { x: 65, y: 72 }, { x: 35, y: 82 }, { x: 65, y: 82 }],
  goalie: [{ x: 50, y: 90 }],
};

function coordinateSlotIndex(slot: LineupSlot, x: number, y: number, used: Set<number>): number {
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  LINEUP_COORDS[slot].forEach((coord, index) => {
    const next = (coord.x - x) ** 2 + (coord.y - y) ** 2;
    if (next < distance) { best = index; distance = next; }
  });
  if (distance <= 9 && !used.has(best)) return best;
  let fallback = 0;
  while (used.has(fallback)) fallback += 1;
  return fallback;
}

function getPublishedRoster(snapshot: TeamPageSnapshot): { players: DisplayRosterPlayer[]; published: boolean } {
  const fallbackCounters: Record<LineupSlot, number> = { forward: 0, defence: 0, goalie: 0 };
  const fallback = snapshot.roster.filter((player) => player.playerType?.toLowerCase() === 'regular').map((player) => {
    const slot = positionBucket(player);
    return { ...player, isSubstitute: false, slot, slotIndex: fallbackCounters[slot]++ };
  });
  const row = snapshot.publishedLineup as { status?: unknown; layout_json?: { roster?: Array<Record<string, unknown>>; placedPlayers?: Array<Record<string, unknown>> } } | null;
  const layout = row?.layout_json;
  if (row?.status !== 'published' || !layout || !Array.isArray(layout.roster) || !Array.isArray(layout.placedPlayers)) {
    return { players: fallback, published: false };
  }
  const rosterMap = new Map(layout.roster.flatMap((player) => typeof player.playerId === 'string' ? [[player.playerId, player] as const] : []));
  const currentMap = new Map(snapshot.roster.map((player) => [player.playerId, player]));
  const acceptedMap = new Map(snapshot.acceptedSubstitutions.map((substitution) => [substitution.subPlayerId, substitution]));
  const seen = new Set<string>();
  const used: Record<LineupSlot, Set<number>> = { forward: new Set(), defence: new Set(), goalie: new Set() };
  const slotOrder = { forward: 0, defence: 1, goalie: 2 } as const;
  const placed = layout.placedPlayers.flatMap((entry) => {
    if (typeof entry.playerId !== 'string' || seen.has(entry.playerId)) return [];
    const player = rosterMap.get(entry.playerId);
    const current = currentMap.get(entry.playerId);
    const accepted = acceptedMap.get(entry.playerId);
    if (!player || (!current && !accepted)) return [];
    const y = typeof entry.y === 'number' && Number.isFinite(entry.y) ? entry.y : null;
    const x = typeof entry.x === 'number' && Number.isFinite(entry.x) ? entry.x : 0;
    const slot: 'forward' | 'defence' | 'goalie' = y != null && y >= 86 ? 'goalie' : y != null && y >= 50 ? 'defence' : 'forward';
    const layoutNumber = typeof player.jerseyNumber === 'number' && Number.isFinite(player.jerseyNumber) ? player.jerseyNumber : null;
    const slotIndex = coordinateSlotIndex(slot, x, y ?? 0, used[slot]);
    used[slot].add(slotIndex);
    seen.add(entry.playerId);
    return [{
      playerId: entry.playerId,
      name: current?.name ?? accepted?.subPlayerName ?? (typeof player.fullName === 'string' && player.fullName ? player.fullName : 'Player'),
      jerseyNumber: current?.jerseyNumber ?? layoutNumber,
      position: slot === 'goalie' ? 'G' : slot === 'defence' ? 'D' : 'C',
      isGoalie: slot === 'goalie',
      leadershipRole: current?.leadershipRole ?? null,
      playerType: current?.playerType ?? (accepted ? 'sub' : null),
      isSubstitute: Boolean(accepted) || ['sub', 'part_time'].includes(current?.playerType?.toLowerCase() ?? ''),
      slot,
      slotIndex,
      y: y ?? 0,
      x,
    }];
  }).sort((left, right) => slotOrder[left.slot] - slotOrder[right.slot] || left.y - right.y || left.x - right.x)
    .map(({ y: _y, x: _x, ...player }) => player);
  return { players: placed, published: true };
}

function slotLineup(players: DisplayRosterPlayer[], minimum: number): Array<DisplayRosterPlayer | null> {
  const capacity = Math.max(minimum, players.reduce((max, player) => Math.max(max, (player.slotIndex ?? -1) + 1), 0));
  const slots = Array<DisplayRosterPlayer | null>(capacity).fill(null);
  const overflow: DisplayRosterPlayer[] = [];
  for (const player of players) {
    if (player.slotIndex != null && player.slotIndex >= 0 && player.slotIndex < slots.length && !slots[player.slotIndex]) slots[player.slotIndex] = player;
    else overflow.push(player);
  }
  for (const player of overflow) {
    const open = slots.indexOf(null);
    if (open >= 0) slots[open] = player; else slots.push(player);
  }
  return slots;
}

function SectionHeading({ icon, title, accent }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; accent: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Ionicons name={icon} size={18} color={accent} />
      <Text style={styles.sectionHeadingText}>{title}</Text>
    </View>
  );
}

function MatchupTeam({ team, side, compact }: { team: TeamPageGame['homeTeam']; side: 'AWAY' | 'HOME'; compact: boolean }) {
  return (
    <View style={[styles.matchupTeam, { alignItems: side === 'AWAY' ? 'flex-start' : 'flex-end' }]}>
      <TeamLogo transparentBacking teamId={team.id} logoUrl={team.logoUrl} teamName={team.name} primaryColor={team.primaryColor ?? colors.primary} size={compact ? 112 : 132} />
      <Text style={[styles.matchupName, compact && styles.matchupNameCompact, { textAlign: side === 'AWAY' ? 'left' : 'right' }]}>{team.name}</Text>
      <Text style={styles.matchupSide}>{side}</Text>
    </View>
  );
}

function NextGame({ game, accent, compact, reduceTransparency, timeZone, onOpenGame }: { game: TeamPageGame | null; accent: string; compact: boolean; reduceTransparency: boolean; timeZone: string; onOpenGame: (id: string) => void }) {
  return (
    <View testID="team-next-game-section" style={styles.nextGameSection}>
      <LinearGradient
        testID="team-next-game-bridge"
        pointerEvents="none"
        colors={reduceTransparency ? ['#07111F', '#241644', '#03070D'] : ['rgba(7,17,31,0)', 'rgba(72,34,126,.22)', 'rgba(7,17,31,0)']}
        locations={[0, .48, 1]}
        style={styles.nextGameBridge}
      />
      <SectionHeading icon="calendar-outline" title="Next Game" accent={accent} />
      {game ? (
        <FocusCard focusId={`team-public:game:${game.id}`} accentColor={accent}>
          <Pressable testID="team-next-game-card" accessibilityRole="button" accessibilityLabel={gameLabel(game, timeZone)} onPress={() => onOpenGame(game.id)} style={styles.matchupCard}>
            <ImageBackground source={weeklyGamesBackground} resizeMode="cover" imageStyle={styles.matchupImage} style={[styles.matchupBackground, compact && styles.matchupBackgroundCompact]}>
            <LinearGradient colors={['rgba(3,7,13,.02)', 'rgba(3,7,13,.32)', '#03070D']} locations={[0, .58, 1]} style={StyleSheet.absoluteFillObject} />
            <View style={styles.matchupTeams}>
              <MatchupTeam team={game.awayTeam} side="AWAY" compact={compact} />
              <MatchupTeam team={game.homeTeam} side="HOME" compact={compact} />
            </View>
            <View style={styles.gameMetaPill}>
              <Text style={styles.gameMetaText}>{formatDate(game.scheduledAt, timeZone)}</Text>
              <View style={styles.metaDivider} />
              <Text style={styles.gameMetaText}>{formatTime(game.scheduledAt, timeZone)}</Text>
              {game.location ? <><View style={styles.metaDivider} /><Text style={[styles.gameMetaText, styles.gameMetaVenue]}>{game.location}</Text></> : null}
            </View>
            </ImageBackground>
          </Pressable>
        </FocusCard>
      ) : <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>No upcoming games scheduled</Text><Text style={styles.emptyBody}>This team does not have another game on the current slate yet.</Text></View>}
    </View>
  );
}

function Leaders({ snapshot, width, fontScale, reduceTransparency, onOpenPlayer }: { snapshot: TeamPageSnapshot; width: number; fontScale: number; reduceTransparency: boolean; onOpenPlayer: (id: string) => void }) {
  const [metric, setMetric] = React.useState<HomeLeaderMetric>('points');
  return (
    <View testID="team-leaders-section">
      <LeagueLeadersPresentation
        leagueId={snapshot.league.id}
        seasonName={snapshot.season.name}
        metric={metric}
        leaders={snapshot.leagueLeaders}
        status="ready"
        width={width}
        fontScale={fontScale}
        reduceTransparency={reduceTransparency}
        onMetricChange={setMetric}
        onRetry={() => {}}
        onOpenPlayer={onOpenPlayer}
        onOpenAllStats={() => {}}
        testIDPrefix="team"
        focusPrefix={`team-public:${snapshot.team.id}`}
        showAllStats={false}
        sectionTitle="Team Leaders"
        compactMetricTabs
        visibleLeaderLimit={5}
        rowVariant="home-inline"
        showTeamCrests={false}
        metricTabsAccessibilityLabel="Team League Leader metric"
      />
    </View>
  );
}

function toScheduleGame(game: TeamPageGame, seasonId: string): GameRow {
  const team = (value: TeamPageGame['homeTeam']) => ({
    id: value.id,
    name: value.name,
    primary_color: value.primaryColor,
    logo_url: value.logoUrl,
  });
  return {
    id: game.id,
    home_team_id: game.homeTeam.id,
    away_team_id: game.awayTeam.id,
    home_score: game.homeScore,
    away_score: game.awayScore,
    scheduled_at: game.scheduledAt,
    status: game.status,
    location: game.location,
    season_id: seasonId,
    home_team: team(game.homeTeam),
    away_team: team(game.awayTeam),
  };
}

function Schedule({ snapshot, accent, reduceTransparency, onOpenGame }: { snapshot: TeamPageSnapshot; accent: string; reduceTransparency: boolean; onOpenGame: (id: string) => void }) {
  const games = selectTeamScheduleGames(snapshot.games.map((game) => toScheduleGame(game, snapshot.season.id)));
  if (games.length === 0) return null;
  return (
    <View testID="team-schedule-section">
      <SectionHeading icon="calendar-clear-outline" title="Schedule" accent={accent} />
      <View style={styles.teamScheduleList}>
        {games.map((game) => (
          <FocusCard focusId={`team-public:${snapshot.team.id}:schedule:${game.id}`} key={game.id}>
            <ScheduleMatchupCard
              game={game}
              timezone={snapshot.league.timezone}
              leagueColor={snapshot.league.primaryColor}
              reduceTransparency={reduceTransparency}
              onOpenGame={onOpenGame}
              compact
            />
          </FocusCard>
        ))}
      </View>
    </View>
  );
}

function Jersey({ player, variant, compact, isBeerGuy, onOpenPlayer }: { player: DisplayRosterPlayer; variant: TeamRosterJerseyVariant; compact: boolean; isBeerGuy: boolean; onOpenPlayer: (id: string) => void }) {
  const playerSurname = surname(player.name);
  const number = player.jerseyNumber == null ? '00' : String(player.jerseyNumber).padStart(2, '0');
  const lettering = JERSEY_LETTERING[variant];
  const role = player.leadershipRole === 'captain'
    ? 'captain'
    : player.leadershipRole === 'alternate_captain' ? 'alternate captain' : null;
  const identityFacts = [
    player.jerseyNumber == null ? 'jersey number unknown' : `jersey number ${player.jerseyNumber}`,
    player.isGoalie ? 'goalie' : null,
    role,
    player.isSubstitute ? 'substitute' : null,
  ].filter((value): value is string => value !== null);
  const fittedNameStyle = playerSurname.length >= 10
    ? (compact ? styles.jerseyNameLongCompact : styles.jerseyNameLong)
    : playerSurname.length >= 7 ? styles.jerseyNameMedium : null;
  return (
    <Pressable testID={`team-roster-player-${player.playerId}`} accessibilityRole="button" accessibilityLabel={`${player.name}, ${identityFacts.join(', ')}.${isBeerGuy ? ' Beer Guy for the next scheduled game.' : ''} Open player card.`} onPress={() => onOpenPlayer(player.playerId)} style={[styles.jerseySlot, compact && styles.jerseySlotCompact]}>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none" style={[styles.jerseyArt, compact && styles.jerseyArtCompact]}>
        <Image testID={`team-roster-art-${player.playerId}`} source={JERSEY_ART[variant]} resizeMode="contain" alt="" accessible={false} style={styles.jerseyLayer} />
        <Text testID={`team-roster-name-${player.playerId}`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} allowFontScaling={false} style={[styles.jerseyName, fittedNameStyle, { color: lettering.fill }]}>{playerSurname}</Text>
        <Text importantForAccessibility="no-hide-descendants" accessibilityElementsHidden allowFontScaling={false} style={styles.jerseyNumberShadow}>{number}</Text>
        <Text testID={`team-roster-number-${player.playerId}`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} allowFontScaling={false} style={[styles.jerseyNumber, { color: lettering.fill, textShadowColor: lettering.outline }]}>{number}</Text>
        {isBeerGuy ? <View testID={`team-roster-beer-guy-${player.playerId}`} accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.beerGuyBadge, compact && styles.beerGuyBadgeCompact]}><MaterialCommunityIcons name="beer" size={14} color="#241400" accessible={false} /></View> : null}
      </View>
    </Pressable>
  );
}

function LineupJerseySlot({ slot, index, player, variant, compact, beerGuyPlayerId, onOpenPlayer }: { slot: LineupSlot; index: number; player: DisplayRosterPlayer | null; variant: TeamRosterJerseyVariant; compact: boolean; beerGuyPlayerId: string | null; onOpenPlayer: (id: string) => void }) {
  return (
    <View testID={`team-lineup-${slot}-slot-${index}`} accessible={!player} accessibilityLabel={!player ? `Empty ${slot} slot ${index + 1}` : undefined} style={[styles.lineupSlot, slot === 'defence' && styles.defenceSlot, slot === 'goalie' && styles.goalieSlot, compact && styles.jerseySlotCompact]}>
      {player ? <Jersey player={player} variant={variant} compact={compact} isBeerGuy={!player.isSubstitute && player.playerType === 'regular' && player.playerId === beerGuyPlayerId} onOpenPlayer={onOpenPlayer} /> : <View importantForAccessibility="no-hide-descendants" style={[styles.emptyJersey, compact && styles.emptyJerseyCompact]}><Ionicons name="add" size={28} color="#6E7788" /></View>}
    </View>
  );
}

const ROSTER_STAT_COLUMNS = [
  { key: 'gamesPlayed', label: 'GP', spoken: 'games played' },
  { key: 'goals', label: 'G', spoken: 'goals' },
  { key: 'assists', label: 'A', spoken: 'assists' },
  { key: 'points', label: 'PTS', spoken: 'points' },
] as const;

const GOALIE_STAT_COLUMNS = [
  { key: 'gamesPlayed', label: 'GP', spoken: 'games played' }, { key: 'wins', label: 'W', spoken: 'wins' },
  { key: 'losses', label: 'L', spoken: 'losses' }, { key: 'goalsAgainstAverage', label: 'GAA', spoken: 'goals against average' },
  { key: 'savePercentage', label: 'SV%', spoken: 'save percentage' }, { key: 'shutouts', label: 'SO', spoken: 'shutouts' },
] as const;

function RosterStatRow({ player, compact, onOpenPlayer }: { player: TeamPageRosterPlayer; compact: boolean; onOpenPlayer: (id: string) => void }) {
  const position = positionBucket(player) === 'goalie' ? 'G' : positionBucket(player) === 'defence' ? 'D' : 'F';
  const name = splitLeagueLeaderName(player.name);
  const surnameText = name.secondLine || '\u00A0';
  const surnameDisplay = surnameText.includes('-') ? surnameText.replace('-', '-\n') : surnameText;
  const jersey = player.jerseyNumber == null ? 'No #' : `#${player.jerseyNumber}`;
  const leadership = player.leadershipRole === 'captain' ? ' • C' : player.leadershipRole === 'alternate_captain' ? ' • A' : '';
  const metricFor = (key: (typeof ROSTER_STAT_COLUMNS)[number]['key']) => player.publicMetrics?.[key];
  const displayFor = (key: (typeof ROSTER_STAT_COLUMNS)[number]['key']) => metricFor(key)
    ? formatPublicMetric(metricFor(key)!).value
    : key === 'gamesPlayed' ? recordedDisplay(player[key], player.gamesPlayedProvenance) : nullableDisplay(player[key]);
  const goalie = positionBucket(player) === 'goalie';
  const goalieDisplay = (key: (typeof GOALIE_STAT_COLUMNS)[number]['key']) => {
    const metric = player.publicGoalieMetrics?.[key];
    if (!metric) return { value: '—', hint: 'Not recorded.' };
    const formatted = formatPublicMetric(metric, key === 'goalsAgainstAverage' ? 2 : undefined);
    if (key === 'savePercentage' && metric.value != null && metric.state !== 'unknown' && metric.state !== 'conflicted' && metric.state !== 'estimated') return { ...formatted, value: `${(metric.value <= 1 ? metric.value * 100 : metric.value).toFixed(1)}%` };
    return formatted;
  };
  const facts = goalie
    ? GOALIE_STAT_COLUMNS.map(({ key, spoken }) => { const display = goalieDisplay(key); return `${spoken} ${display.value}, ${display.hint}`; }).join(', ')
    : ROSTER_STAT_COLUMNS.map(({ key, spoken }) => `${displayFor(key)} ${spoken}${metricFor(key) ? `, ${formatPublicMetric(metricFor(key)!).hint}` : ''}`).join(', ');
  return (
    <Pressable testID={`team-roster-player-${player.playerId}`} accessibilityRole="button" accessibilityLabel={`${player.name}, ${jersey}, ${position}${leadership}. ${facts}. Open player card.`} onPress={() => onOpenPlayer(player.playerId)} style={[styles.rosterListRow, compact && styles.rosterListRowCompact]}>
      <View testID={`team-roster-identity-${player.playerId}`} style={[styles.rosterListIdentity, compact && styles.rosterListIdentityCompact]}>
        <Text testID={`team-roster-first-name-${player.playerId}`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} maxFontSizeMultiplier={1.4} style={styles.rosterFirstName}>{name.firstLine}</Text>
        <Text testID={`team-roster-last-name-${player.playerId}`} numberOfLines={surnameText.includes('-') ? 2 : 1} maxFontSizeMultiplier={1.4} style={styles.rosterLastName}>{surnameDisplay}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.4} style={styles.rosterListMeta}>{jersey} • {position}{leadership}</Text>
      </View>
      <View testID={`team-roster-stats-${player.playerId}`} style={styles.rosterStatGrid}>
        {(goalie ? GOALIE_STAT_COLUMNS.map(({ key, label }) => ({ key, label, value: goalieDisplay(key).value })) : ROSTER_STAT_COLUMNS.map(({ key, label }) => ({ key, label, value: displayFor(key) }))).map(({ key, label, value }) => {
          return (
            <View key={key} testID={`team-roster-stat-${player.playerId}-${key}`} style={styles.rosterStatCell}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} maxFontSizeMultiplier={1.4} style={styles.rosterStatLabel}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62} maxFontSizeMultiplier={1.4} style={styles.rosterStatValue}>{value}</Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

function Roster({ snapshot, accent, compact, beerGuyPlayerId, onOpenPlayer }: { snapshot: TeamPageSnapshot; accent: string; compact: boolean; beerGuyPlayerId: string | null; onOpenPlayer: (id: string) => void }) {
  const [listView, setListView] = React.useState(false);
  const display = getPublishedRoster(snapshot);
  const groups = {
    forwards: display.players.filter((player) => positionBucket(player) === 'forward'),
    defence: display.players.filter((player) => positionBucket(player) === 'defence'),
    goalies: display.players.filter((player) => positionBucket(player) === 'goalie'),
  };
  const slots = { forwards: slotLineup(groups.forwards, 6), defence: slotLineup(groups.defence, 4), goalies: slotLineup(groups.goalies, 1) };
  const jerseyVariant = resolveTeamRosterJerseyVariant(snapshot.team);
  return (
    <View testID="team-roster-section">
      <View style={styles.rosterHeadingRow}><View style={styles.rosterHeadingCopy}><SectionHeading icon="people-outline" title={listView ? 'Team Roster' : snapshot.nextGame ? 'Next Game Roster' : 'Roster'} accent={accent} /></View><SelectableControlGroup horizontal={false} role="tablist" accessibilityLabel="Roster view" contentContainerStyle={styles.iconToggle}><SelectableControl testID="team-roster-jersey-toggle" role="tab" label="Jersey" accessibilityLabel="Show jersey roster" selected={!listView} onPress={() => setListView(false)} style={styles.iconToggleButton}><Ionicons name="shirt-outline" size={19} color={!listView ? '#F7FBFF' : colors.textSecondary} /></SelectableControl><SelectableControl testID="team-roster-list-toggle" role="tab" label="Stats" accessibilityLabel="Show roster stats" selected={listView} onPress={() => setListView(true)} style={styles.iconToggleButton}><Ionicons name="list" size={20} color={listView ? '#F7FBFF' : colors.textSecondary} /></SelectableControl></SelectableControlGroup></View>
      {listView ? (
        <FocusCard focusId={`team-public:${snapshot.team.id}:roster-list`} testID="team-roster-list" accentColor={accent} style={styles.readingPanel}>{snapshot.roster.map((player) => <RosterStatRow key={player.playerId} player={player} compact={compact} onOpenPlayer={onOpenPlayer} />)}</FocusCard>
      ) : (
        <FocusCard focusId={`team-public:${snapshot.team.id}:roster-jerseys`} testID="team-roster-jerseys" accentColor={accent} style={styles.lineup}>
          <Text style={styles.groupLabel}>FORWARDS</Text><View style={styles.forwardGrid}>{slots.forwards.map((player, index) => <LineupJerseySlot key={`forward-${index}`} slot="forward" index={index} player={player} variant={jerseyVariant} compact={compact} beerGuyPlayerId={beerGuyPlayerId} onOpenPlayer={onOpenPlayer} />)}</View>
          <View style={styles.lowerLineup}><View style={styles.defenceGroup}><Text style={styles.groupLabel}>DEFENCE</Text><View style={styles.defenceGrid}>{slots.defence.map((player, index) => <LineupJerseySlot key={`defence-${index}`} slot="defence" index={index} player={player} variant={jerseyVariant} compact={compact} beerGuyPlayerId={beerGuyPlayerId} onOpenPlayer={onOpenPlayer} />)}</View></View><View style={styles.goalieGroup}><Text style={styles.groupLabel}>GOALIE</Text>{slots.goalies.map((player, index) => <LineupJerseySlot key={`goalie-${index}`} slot="goalie" index={index} player={player} variant={jerseyVariant} compact={compact} beerGuyPlayerId={beerGuyPlayerId} onOpenPlayer={onOpenPlayer} />)}</View></View>
          {!display.published && display.players.length === 0 ? <Text style={styles.emptyBody}>No active players are listed for this season.</Text> : null}
        </FocusCard>
      )}
      {snapshot.acceptedSubstitutions.length > 0 ? <View testID="team-substitution-notes" style={styles.substitutionNotes}>{snapshot.acceptedSubstitutions.map((substitution) => <View key={substitution.id} style={styles.substitutionNote}><MaterialCommunityIcons name="submarine" size={18} color={accent} importantForAccessibility="no-hide-descendants" /><Text style={styles.substitutionNoteText}>{substitution.subPlayerName} subbing in{substitution.replacedPlayerName ? ` for ${substitution.replacedPlayerName}` : ''}</Text></View>)}</View> : null}
    </View>
  );
}

function MetricComparison({ label, left, right, leftColor, rightColor }: { label: string; left: number | null; right: number | null; leftColor: string; rightColor: string }) {
  const max = Math.max(Math.abs(left ?? 0), Math.abs(right ?? 0), 1);
  return <View style={styles.rivalMetric}><View style={styles.rivalMetricHeader}><Text style={styles.rivalMetricValue}>{nullableDisplay(left)}</Text><Text style={styles.rivalMetricLabel}>{label}</Text><Text style={styles.rivalMetricValue}>{nullableDisplay(right)}</Text></View><View style={styles.rivalBars}><View style={styles.rivalTrack}><View style={[styles.rivalBarLeft, { width: `${Math.abs(left ?? 0) / max * 100}%`, backgroundColor: leftColor }]} /></View><View style={styles.rivalTrack}><View style={[styles.rivalBarRight, { width: `${Math.abs(right ?? 0) / max * 100}%`, backgroundColor: rightColor }]} /></View></View></View>;
}

function RivalSide({ side, align }: { side: TeamPageRival['team']; align: 'left' | 'right' }) {
  return <View style={styles.rivalIdentity}><TeamLogo transparentBacking teamId={side.id} logoUrl={side.logoUrl} teamName={side.name} primaryColor={side.primaryColor ?? colors.primary} size={76} /><Text numberOfLines={2} style={[styles.rivalName, { textAlign: align }]}>{side.name}</Text></View>;
}

function Rivals({ snapshot, accent }: { snapshot: TeamPageSnapshot; accent: string }) {
  const [index, setIndex] = React.useState(0);
  const entry = snapshot.rivals[index] ?? null;
  return (
    <View testID="team-rivals-section">
      <SectionHeading icon="flash-outline" title="Rivals" accent={accent} />
      {entry ? <FocusCard focusId={`team-public:${snapshot.team.id}:rival:${entry.rival.id}`} accentColor={accent} style={styles.rivalPanel}>
        <Text style={styles.rivalEyebrow}>SEASON MATCHUP • {entry.gamesPlayed} {entry.gamesPlayed === 1 ? 'MEETING' : 'MEETINGS'}</Text>
        <View style={styles.rivalTeams}><RivalSide side={entry.team} align="left" /><Text style={styles.rivalVs}>VS</Text><RivalSide side={entry.rival} align="right" /></View>
        <View style={styles.h2hRow}><Text style={styles.rivalMetricValue}>{entry.team.overallRecord}</Text><Text style={styles.rivalMetricLabel}>RECORD</Text><Text style={styles.rivalMetricValue}>{entry.rival.overallRecord}</Text></View>
        <View style={styles.h2hRow}><Text style={styles.rivalMetricValue}>{entry.h2hRecord}</Text><Text style={styles.rivalMetricLabel}>H2H</Text><Text style={styles.rivalMetricValue}>{entry.h2hRecordRival}</Text></View>
        <MetricComparison label="GF" left={entry.team.goalsFor} right={entry.rival.goalsFor} leftColor={entry.team.primaryColor ?? accent} rightColor={entry.rival.primaryColor ?? accent} />
        <MetricComparison label="GA" left={entry.team.goalsAgainst} right={entry.rival.goalsAgainst} leftColor={entry.team.primaryColor ?? accent} rightColor={entry.rival.primaryColor ?? accent} />
        <MetricComparison label="DIFF" left={entry.team.goalDifferential} right={entry.rival.goalDifferential} leftColor={entry.team.primaryColor ?? accent} rightColor={entry.rival.primaryColor ?? accent} />
        <View style={styles.rivalLeaderRow}><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={styles.rivalLeaderName}>{entry.team.sniper.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.team.primaryColor ?? accent }]}>{nullableDisplay(entry.team.sniper.goals)} G</Text></View><Text style={styles.rivalMetricLabel}>SNIPER</Text><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={[styles.rivalLeaderName, { textAlign: 'right' }]}>{entry.rival.sniper.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.rival.primaryColor ?? accent, textAlign: 'right' }]}>{nullableDisplay(entry.rival.sniper.goals)} G</Text></View></View>
        <View style={styles.rivalLeaderRow}><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={styles.rivalLeaderName}>{entry.team.playmaker.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.team.primaryColor ?? accent }]}>{nullableDisplay(entry.team.playmaker.assists)} A</Text></View><Text style={styles.rivalMetricLabel}>PLAYMAKER</Text><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={[styles.rivalLeaderName, { textAlign: 'right' }]}>{entry.rival.playmaker.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.rival.primaryColor ?? accent, textAlign: 'right' }]}>{nullableDisplay(entry.rival.playmaker.assists)} A</Text></View></View>
        <View style={styles.rivalLeaderRow}><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={styles.rivalLeaderName}>{entry.team.tendy.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.team.primaryColor ?? accent }]}>{recordedDisplay(entry.team.tendy.gamesPlayed, entry.team.tendy.gamesPlayedProvenance)} GP • {recordedDisplay(entry.team.tendy.goalsAgainstAverage, entry.team.tendy.goalsAgainstAverageProvenance, 2)} GAA</Text></View><Text style={styles.rivalMetricLabel}>TENDY</Text><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={[styles.rivalLeaderName, { textAlign: 'right' }]}>{entry.rival.tendy.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.rival.primaryColor ?? accent, textAlign: 'right' }]}>{recordedDisplay(entry.rival.tendy.gamesPlayed, entry.rival.tendy.gamesPlayedProvenance)} GP • {recordedDisplay(entry.rival.tendy.goalsAgainstAverage, entry.rival.tendy.goalsAgainstAverageProvenance, 2)} GAA</Text></View></View>
        <Text style={styles.estimateNote}>Goalie GP/GAA appears when recorded.</Text>
        {(['strength', 'weakness'] as const).map((trait) => <View key={trait} style={styles.badgesRow}>{[entry.team, entry.rival].map((side, sideIndex) => <View key={side.id} accessible accessibilityLabel={`${side.name} ${trait}: ${side[trait]}`} style={{ flex: 1, minWidth: 0, alignItems: sideIndex ? 'flex-end' : 'flex-start' }}><Text style={styles.rivalMetricLabel}>{trait.toUpperCase()}</Text><View style={styles.badge}><Text style={styles.badgeText}>{side[trait].toUpperCase()}</Text></View></View>)}</View>)}
        <CarouselPager currentIndex={index} pageCount={snapshot.rivals.length} onPrevious={() => setIndex((value) => (value - 1 + snapshot.rivals.length) % snapshot.rivals.length)} onNext={() => setIndex((value) => (value + 1) % snapshot.rivals.length)} previousLabel="Previous rival" nextLabel="Next rival" positionLabel="Rivals position" loop testID="team-rival" />
      </FocusCard> : <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>No rivalry sample yet</Text><Text style={styles.emptyBody}>Rival matchups will appear after completed games.</Text></View>}
    </View>
  );
}

export default function TeamPublicPage({ snapshot, beerGuyPlayerId = null, reduceTransparency, onOpenPlayer, onOpenGame }: { snapshot: TeamPageSnapshot; beerGuyPlayerId?: string | null; reduceTransparency: boolean; onOpenPlayer: (playerId: string) => void; onOpenGame: (gameId: string) => void }) {
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360;
  const accent = resolveFocusAccent(snapshot.team.primaryColor, snapshot.league.primaryColor);
  return <View testID="team-public-composition" style={[styles.composition, reduceTransparency && styles.compositionOpaque]}><BroadcastTeamHero snapshot={snapshot} compact={compact} reduceTransparency={reduceTransparency} /><NextGame game={snapshot.nextGame} accent={accent} compact={compact} reduceTransparency={reduceTransparency} timeZone={snapshot.league.timezone} onOpenGame={onOpenGame} /><Leaders snapshot={snapshot} width={width} fontScale={fontScale} reduceTransparency={reduceTransparency} onOpenPlayer={onOpenPlayer} /><Schedule snapshot={snapshot} accent={accent} reduceTransparency={reduceTransparency} onOpenGame={onOpenGame} /><Roster snapshot={snapshot} accent={accent} compact={compact} beerGuyPlayerId={beerGuyPlayerId} onOpenPlayer={onOpenPlayer} /><Rivals snapshot={snapshot} accent={accent} /><TeamCaptainContact captain={snapshot.captain} teamName={snapshot.team.name} teamPrimaryColor={snapshot.team.primaryColor} compact={compact} onOpenPlayer={onOpenPlayer} /></View>;
}

const styles = StyleSheet.create({
  composition: { backgroundColor: 'transparent', gap: 28, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 36 },
  compositionOpaque: { backgroundColor: '#03070D' },
  sectionHeading: { flexShrink: 1, minWidth: 0, minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionHeadingText: { ...SECTION_HEADING_TEXT_STYLE, flexShrink: 1, color: '#F7FBFF' },
  nextGameSection: { position: 'relative', marginTop: -56, paddingTop: 60 },
  nextGameBridge: { position: 'absolute', left: -16, right: -16, top: 0, height: 112 },
  matchupCard: { overflow: 'hidden', borderRadius: 28, minHeight: 328, backgroundColor: '#03070D' }, matchupBackground: { minHeight: 328, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 20 }, matchupBackgroundCompact: { minHeight: 300, paddingHorizontal: 10 }, matchupImage: { borderRadius: 28 },
  matchupTeams: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, paddingBottom: 16 }, matchupTeam: { minWidth: 0, flex: 1, alignItems: 'center', gap: 5 },
  matchupName: { alignSelf: 'stretch', minHeight: 80, color: '#FFFFFF', fontSize: 30, lineHeight: 30, fontWeight: '900', letterSpacing: -.7, textAlign: 'center' }, matchupNameCompact: { fontSize: 27, lineHeight: 28 }, matchupSide: { color: '#B8C0CE', fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  gameMetaPill: { minHeight: ui.minTouchTarget, alignSelf: 'center', maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', backgroundColor: 'rgba(3,7,13,.82)', paddingHorizontal: 12, paddingVertical: 9 }, gameMetaText: { flexShrink: 1, color: '#C1CAD8', fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: .2 }, gameMetaVenue: { flexBasis: '100%', marginTop: 4, textAlign: 'center' }, metaDivider: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#536176', marginHorizontal: 7 },
  readingPanel: { borderRadius: 28, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgSurface, padding: 16 },
  estimateNote: { color: '#8D9AAF', fontSize: 9, lineHeight: 13, textAlign: 'center', marginBottom: 8 },

  teamScheduleList: { minWidth: 0 },
  rosterHeadingCopy: { flex: 1, minWidth: 0 }, rosterHeadingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, iconToggle: { width: 96, minWidth: 96, flexShrink: 0, marginBottom: 12, flexDirection: 'row', gap: 8 }, iconToggleButton: { width: ui.minTouchTarget, minWidth: ui.minTouchTarget, height: ui.minTouchTarget, paddingHorizontal: 0, gap: 2, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }, rosterTruth: { marginTop: 0, marginBottom: 14, color: '#738095', fontSize: 10, fontWeight: '700' },
  substitutionNotes: { gap: 7, marginTop: 10, marginBottom: 14 }, substitutionNote: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 }, substitutionNoteText: { flex: 1, color: '#A8B4C8', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  lineup: { gap: 15, paddingHorizontal: 10, paddingVertical: 16 }, groupLabel: { marginBottom: 4, color: '#758196', fontSize: 9, fontWeight: '900', letterSpacing: 1.5, textAlign: 'center' }, forwardGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 3, rowGap: 7 }, lowerLineup: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 5 }, defenceGroup: { flex: 2 }, goalieGroup: { flex: 1, alignItems: 'center' }, defenceGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 3 }, lineupSlot: { width: '32%', minWidth: 92, minHeight: 91, alignItems: 'center', justifyContent: 'center' }, defenceSlot: { width: '48%', minWidth: 82 }, goalieSlot: { width: '100%', minWidth: 82 }, emptyJersey: { width: 92, height: 78, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(124,58,237,.65)', borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,58,237,.04)' }, emptyJerseyCompact: { width: 82, height: 70 },
  jerseySlot: { width: '32%', minWidth: 92, minHeight: ui.minTouchTarget, alignItems: 'center' }, jerseySlotCompact: { minWidth: 82 }, jerseyArt: { position: 'relative', width: 106, height: 99 }, jerseyArtCompact: { width: 92, height: 86 }, jerseyLayer: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }, jerseyName: { position: 'absolute', left: '31%', right: '31%', top: '27%', overflow: 'visible', fontSize: 6.4, lineHeight: 8, fontWeight: '900', letterSpacing: .25, textAlign: 'center', textShadowColor: 'rgba(0,0,0,.72)', textShadowOffset: { width: 0, height: .5 }, textShadowRadius: .8 }, jerseyNameMedium: { fontSize: 5.5, lineHeight: 7, letterSpacing: .05 }, jerseyNameLong: { left: '25%', right: '25%', fontSize: 5.2, lineHeight: 6.5, letterSpacing: 0, transform: [{ scaleX: .8 }] }, jerseyNameLongCompact: { left: '25%', right: '25%', fontSize: 5, lineHeight: 6, letterSpacing: 0, transform: [{ scaleX: .72 }] }, jerseyNumberShadow: { position: 'absolute', left: 0, right: 0, top: '40.5%', color: 'rgba(0,0,0,.55)', fontSize: 30, lineHeight: 36, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1, textAlign: 'center', transform: [{ translateX: .5 }, { translateY: 1.25 }] }, jerseyNumber: { position: 'absolute', left: 0, right: 0, top: '40.5%', fontSize: 30, lineHeight: 36, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1, textAlign: 'center', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 1.6, transform: [{ translateX: -1.5 }] }, beerGuyBadge: { position: 'absolute', right: 8, bottom: 7, zIndex: 2, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#FFF1C2', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7B733', shadowColor: '#000000', shadowOpacity: .36, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }, beerGuyBadgeCompact: { right: 7, bottom: 6, width: 20, height: 20, borderRadius: 10 },
  rosterListRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,.13)', paddingVertical: 10 },
  rosterListRowCompact: { minHeight: 88 },
  rosterListIdentity: { width: 98, minWidth: 0, flexShrink: 0, justifyContent: 'center', paddingRight: 4 }, rosterListIdentityCompact: { width: 84 },
  rosterFirstName: { color: '#A8B4C8', fontSize: 10, lineHeight: 13, fontWeight: '800' }, rosterLastName: { color: '#F7FBFF', fontSize: 13, lineHeight: 16, fontWeight: '900' }, rosterListMeta: { marginTop: 3, color: '#A8B4C8', fontSize: 9, lineHeight: 12 },
  rosterStatGrid: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' }, rosterStatCell: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 1 },
  rosterStatLabel: { width: '100%', color: '#A8B4C8', fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' }, rosterStatValue: { width: '100%', color: '#F7FBFF', fontSize: 13, lineHeight: 17, fontWeight: '900', fontVariant: ['tabular-nums'], textAlign: 'center' },
  rivalPanel: { borderRadius: 28, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgSurface, padding: 16, gap: 15 }, rivalEyebrow: { color: '#748196', fontSize: 8, fontWeight: '900', letterSpacing: 1.25, textAlign: 'center' }, rivalTeams: { flexDirection: 'row', alignItems: 'center', gap: 10 }, rivalIdentity: { flex: 1, alignItems: 'center', gap: 7 }, rivalName: { minHeight: 30, color: '#F7FBFF', fontSize: 12, lineHeight: 15, fontWeight: '900' }, rivalVs: { color: '#586579', fontSize: 10, fontWeight: '900' }, rivalMetric: { gap: 5 }, rivalMetricHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, rivalMetricLabel: { color: '#748196', fontSize: 8, fontWeight: '900', letterSpacing: 1 }, rivalMetricValue: { minWidth: 46, color: '#E8EEF7', fontSize: 11, fontWeight: '900', textAlign: 'center' }, rivalBars: { flexDirection: 'row', gap: 8 }, rivalTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#171D27', overflow: 'hidden' }, rivalBarLeft: { alignSelf: 'flex-end', height: 5, borderRadius: 3 }, rivalBarRight: { height: 5, borderRadius: 3 }, h2hRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, rivalLeaderRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 }, rivalLeaderSide: { minWidth: 0, flex: 1 }, rivalLeaderName: { color: '#E8EEF7', fontSize: 10, fontWeight: '800' }, rivalLeaderValue: { marginTop: 2, fontSize: 11, fontWeight: '900' }, badgesRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' }, badge: { maxWidth: '100%', marginTop: 5, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(34,211,238,.28)', backgroundColor: 'rgba(34,211,238,.08)', paddingHorizontal: 9, paddingVertical: 5 }, badgeText: { color: '#B8F5FF', fontSize: 8, fontWeight: '900' },
  emptyPanel: { borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgSurface, padding: 22, alignItems: 'center', gap: 6 }, emptyTitle: { color: '#F7FBFF', fontSize: 15, fontWeight: '900', textAlign: 'center' }, emptyBody: { color: '#7E8A9D', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
