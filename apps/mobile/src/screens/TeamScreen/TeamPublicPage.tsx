import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, ImageBackground, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import Avatar from '../../components/Avatar';
import TeamLogo from '../../components/TeamLogo';
import type { TeamLeaderMetric, TeamPageGame, TeamPageLeader, TeamPageRival, TeamPageRosterPlayer, TeamPageSnapshot } from '../../lib/supabase/teamPage';
import colors from '../../theme/colors';
import { ui } from '../../theme/ui';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires static image requires. */
const weeklyGamesBackground = require('../../assets/team-page/weekly-games-bg.jpg');
const trophyArtwork = require('../../assets/team-page/trophy.png');
const jerseyPrimary = require('../../assets/team-page/jersey-primary.png');
const jerseySecondary = require('../../assets/team-page/jersey-secondary.png');
const jerseyDetail = require('../../assets/team-page/jersey-detail.png');
/* eslint-enable @typescript-eslint/no-require-imports */

const METRICS: Array<{ key: TeamLeaderMetric; label: string }> = [
  { key: 'points', label: 'P' },
  { key: 'goals', label: 'G' },
  { key: 'assists', label: 'A' },
  { key: 'penaltyMinutes', label: 'PM' },
];

const METRIC_NAMES: Record<TeamLeaderMetric, string> = { points: 'points', goals: 'goals', assists: 'assists', penaltyMinutes: 'penalty minutes' };

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

function estimatedDisplay(value: number | null | undefined, estimated: boolean, digits?: number): string {
  if (value == null) return '—';
  const rendered = digits == null ? String(value) : value.toFixed(digits);
  return `${estimated ? '~' : ''}${rendered}`;
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
  return (parts[parts.length - 1] || name).toUpperCase().slice(0, 12);
}

type DisplayRosterPlayer = Pick<TeamPageRosterPlayer, 'playerId' | 'name' | 'jerseyNumber' | 'position' | 'isGoalie'> & { slotIndex?: number };

function getPublishedRoster(snapshot: TeamPageSnapshot): { players: DisplayRosterPlayer[]; published: boolean } {
  const fallback = snapshot.roster.filter((player) => player.playerType?.toLowerCase() === 'regular');
  const row = snapshot.publishedLineup as { status?: unknown; layout_json?: { roster?: Array<Record<string, unknown>>; placedPlayers?: Array<Record<string, unknown>> } } | null;
  const layout = row?.layout_json;
  if (row?.status !== 'published' || !layout || !Array.isArray(layout.roster) || !Array.isArray(layout.placedPlayers)) {
    return { players: fallback, published: false };
  }
  const rosterMap = new Map(layout.roster.flatMap((player) => typeof player.playerId === 'string' ? [[player.playerId, player] as const] : []));
  const currentMap = new Map(snapshot.roster.map((player) => [player.playerId, player]));
  const acceptedMap = new Map(snapshot.acceptedSubstitutions.map((substitution) => [substitution.subPlayerId, substitution]));
  const seen = new Set<string>();
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
    seen.add(entry.playerId);
    return [{
      playerId: entry.playerId,
      name: current?.name ?? accepted?.subPlayerName ?? (typeof player.fullName === 'string' && player.fullName ? player.fullName : 'Player'),
      jerseyNumber: current?.jerseyNumber ?? layoutNumber,
      position: slot === 'goalie' ? 'G' : slot === 'defence' ? 'D' : 'C',
      isGoalie: slot === 'goalie',
      slot,
      y: y ?? 0,
      x,
    }];
  }).sort((left, right) => slotOrder[left.slot] - slotOrder[right.slot] || left.y - right.y || left.x - right.x)
    .map(({ slot: _slot, y: _y, x: _x, ...player }, index) => ({ ...player, slotIndex: index }));
  return placed.length > 0 ? { players: placed, published: true } : { players: fallback, published: false };
}

function SectionHeading({ icon, title, accent }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; accent: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Ionicons name={icon} size={18} color={accent} />
      <Text style={styles.sectionHeadingText}>{title}</Text>
    </View>
  );
}

function Hero({ snapshot, compact }: { snapshot: TeamPageSnapshot; compact: boolean }) {
  const team = snapshot.team;
  const standing = snapshot.standing;
  const accent = colors.primary;
  const pills = [
    ['RANK', snapshot.rank == null ? '—' : `#${snapshot.rank}`],
    ['WIN %', snapshot.hero.winPercentage == null ? '—' : `${Math.round(snapshot.hero.winPercentage * 100)}%`],
    ['STREAK', snapshot.streak ?? '—'],
    ['GF', nullableDisplay(standing?.goalsFor)],
    ['GA', nullableDisplay(standing?.goalsAgainst)],
    ['DIFF', standing?.goalDifferential == null ? '—' : nullableDisplay(standing.goalDifferential, standing.goalDifferential > 0 ? '+' : '')],
  ];
  return (
    <View testID="team-public-hero" style={styles.hero}>
      <View style={styles.heroLogoWrap}>
        <TeamLogo transparentBacking teamId={team.id} logoUrl={team.logoUrl} teamName={team.name} primaryColor={team.primaryColor ?? accent} size={160} />
        {snapshot.championships.count > 0 ? (
          <View style={[styles.trophyWrap, compact && styles.trophyWrapCompact]}>
            <Image source={trophyArtwork} resizeMode="contain" alt="" accessible={false} style={styles.trophy} />
            <View style={styles.trophyBadge}><Text style={styles.trophyBadgeText}>x{snapshot.championships.count}</Text></View>
          </View>
        ) : null}
      </View>
      <Text style={styles.heroName}>{team.name}</Text>
      <Text testID="team-hero-record" style={[styles.heroRecord, compact && styles.heroRecordCompact]}>{snapshot.record}</Text>
      <View style={styles.heroPills}>
        {(compact ? [pills.slice(0, 2), pills.slice(2, 4), pills.slice(4)] : [pills.slice(0, 2), pills.slice(2, 5), pills.slice(5)]).map((row, index) => <View key={index} testID="team-hero-pill-row" style={styles.heroPillRow}>{row.map(([label, value]) => (
          <View key={label} testID="team-hero-pill" style={styles.heroPill}>
            <Text style={styles.heroPillLabel}>{label}</Text><Text style={[styles.heroPillValue, label === 'DIFF' && standing?.goalDifferential != null && standing.goalDifferential > 0 && { color: accent }]}>{value}</Text>
          </View>
        ))}</View>)}
      </View>
      {snapshot.championships.latestTitleSeasonName ? (
        <Text style={styles.championshipLine}>Latest championship: {snapshot.championships.latestTitleSeasonName}{snapshot.championships.latestTitleLabel ? ` (${snapshot.championships.latestTitleLabel})` : ''}.</Text>
      ) : null}
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

function NextGame({ game, accent, compact, timeZone, onOpenGame }: { game: TeamPageGame | null; accent: string; compact: boolean; timeZone: string; onOpenGame: (id: string) => void }) {
  return (
    <View testID="team-next-game-section">
      <SectionHeading icon="calendar-outline" title="Next Game" accent={accent} />
      {game ? (
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
              {game.location ? <><View style={styles.metaDivider} /><Text numberOfLines={1} style={styles.gameMetaText}>{game.location}</Text></> : null}
            </View>
          </ImageBackground>
        </Pressable>
      ) : <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>No upcoming games scheduled</Text><Text style={styles.emptyBody}>This team does not have another game on the current slate yet.</Text></View>}
    </View>
  );
}

function LeaderCard({ leader, place, accent, metric, onOpenPlayer }: { leader: TeamPageLeader; place: number; accent: string; metric: TeamLeaderMetric; onOpenPlayer: (id: string) => void }) {
  const { width } = useWindowDimensions();
  const portraitSize = width < 360 ? 54 : 70;
  const tone = place === 1 ? '#E4C85A' : place === 2 ? '#CBD5E1' : '#CD7F32';
  return (
    <Pressable testID={`team-leader-${leader.playerId}`} accessibilityRole="button" accessibilityLabel={`${leader.name}, ${leader.value} ${METRIC_NAMES[metric]}, ${leader.gamesPlayed == null ? 'games played unknown' : `${leader.gamesPlayedProvenance === 'estimated' ? 'approximately ' : ''}${leader.gamesPlayed} games played`}. Open player card.`} onPress={() => onOpenPlayer(leader.playerId)} style={[styles.leaderCard, place === 1 ? styles.leaderFirst : place === 2 ? styles.leaderSecond : styles.leaderThird, { borderColor: `${tone}88`, backgroundColor: `${tone}18` }]}>
      <View style={[styles.leaderAvatarHalo, { width: portraitSize + 10, height: portraitSize + 10, borderColor: tone }]}><View style={[styles.leaderAvatarInner, { borderColor: `${tone}88` }]}><Avatar uri={leader.photoUrl} name={leader.name} size={portraitSize} /></View></View>
      <Text numberOfLines={2} style={styles.leaderName}>{leader.name}</Text>
      <Text style={[styles.leaderValue, { color: accent }]}>{leader.value}</Text>
      <Text style={styles.leaderMeta}>{leader.jerseyNumber == null ? 'No #' : `#${leader.jerseyNumber}`} • {estimatedDisplay(leader.gamesPlayed, leader.gamesPlayedProvenance === 'estimated')} GP</Text>
    </Pressable>
  );
}

function Leaders({ snapshot, accent, onOpenPlayer }: { snapshot: TeamPageSnapshot; accent: string; onOpenPlayer: (id: string) => void }) {
  const [metric, setMetric] = React.useState<TeamLeaderMetric>('points');
  const [bars, setBars] = React.useState(false);
  const leaders = snapshot.leaders[metric] ?? [];
  const podium = leaders.length <= 1 ? leaders : leaders.length === 2 ? [leaders[1], leaders[0]] : [leaders[1], leaders[0], leaders[2]];
  const allPlayers = [...snapshot.roster].filter((player) => !player.isGoalie && player[metric] != null).sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0) || a.name.localeCompare(b.name));
  const max = Math.max(1, ...allPlayers.map((player) => player[metric] ?? 0));
  return (
    <View testID="team-leaders-section">
      <SectionHeading icon="bar-chart-outline" title="Team Leaders" accent={accent} />
      <View style={styles.readingPanel}>
        <Text testID="team-gp-estimate-explanation" style={styles.estimateNote}>~GP is estimated from active-roster dates and completed public games; actual attendance may differ.</Text>
        <View style={styles.leaderControls}>
          <View style={styles.segmented}>
            {METRICS.map((item) => {
              const active = metric === item.key;
              return <Pressable key={item.key} testID={`team-leader-metric-${item.label.toLowerCase()}`} accessibilityRole="button" accessibilityLabel={METRIC_NAMES[item.key]} accessibilityState={{ selected: active }} onPress={() => setMetric(item.key)} style={[styles.metricButton, active && { backgroundColor: accent }]}><Text style={[styles.metricText, active && styles.metricTextActive]}>{item.label}</Text></Pressable>;
            })}
          </View>
          <Pressable testID="team-leader-chart-toggle" accessibilityRole="button" accessibilityLabel="Toggle bar chart view" onPress={() => setBars((value) => !value)} style={[styles.chartToggle, bars && { borderColor: accent, backgroundColor: `${accent}1F` }]}><Ionicons name="bar-chart-outline" size={20} color={bars ? accent : colors.textSecondary} /></Pressable>
        </View>
        {bars ? (
          <View testID="team-leader-bars" style={styles.bars}>
            {allPlayers.map((player) => {
              const value = player[metric] ?? 0;
              return <Pressable key={player.playerId} accessibilityRole="button" accessibilityLabel={`${player.name}, ${value} ${METRIC_NAMES[metric]}, ${player.gamesPlayed == null ? 'games played unknown' : `${player.gamesPlayedProvenance === 'estimated' ? 'approximately ' : ''}${player.gamesPlayed} games played`}. Open player card.`} onPress={() => onOpenPlayer(player.playerId)} style={styles.barRow}><View style={styles.barIdentity}><Avatar uri={player.photoUrl} name={player.name} size={32} /><Text numberOfLines={1} style={styles.barName}>{player.name}</Text><Text style={[styles.barValue, { color: accent }]}>{value}</Text></View><View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(value > 0 ? 8 : 0, value / max * 100)}%`, backgroundColor: accent }]} /></View></Pressable>;
            })}
          </View>
        ) : leaders.length ? (
          <View testID="team-leader-podium" style={styles.podium}>{podium.map((leader) => <LeaderCard key={leader.playerId} leader={leader} metric={metric} place={leaders.findIndex((row) => row.playerId === leader.playerId) + 1} accent={accent} onOpenPlayer={onOpenPlayer} />)}</View>
        ) : <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>No team leaders yet</Text><Text style={styles.emptyBody}>Leader cards will populate once current-season player stats are recorded.</Text></View>}
      </View>
    </View>
  );
}

function Schedule({ snapshot, accent, onOpenGame }: { snapshot: TeamPageSnapshot; accent: string; onOpenGame: (id: string) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const games = expanded ? snapshot.games : snapshot.collapsedSchedule;
  return (
    <View testID="team-schedule-section">
      <SectionHeading icon="calendar-clear-outline" title="Schedule" accent={accent} />
      <View style={styles.readingPanel}>
        {games.length ? games.map((game) => {
          const viewedHome = game.homeTeam.id === snapshot.team.id;
          const opponent = viewedHome ? game.awayTeam : game.homeTeam;
          const showScore = ['completed', 'pending_verification', 'in_progress', 'live'].includes(game.status ?? '');
          const mine = viewedHome ? game.homeScore : game.awayScore;
          const theirs = viewedHome ? game.awayScore : game.homeScore;
          const month = new Date(game.scheduledAt).toLocaleDateString('en-CA', { month: 'short', timeZone: snapshot.league.timezone }).toUpperCase();
          const day = new Date(game.scheduledAt).toLocaleDateString('en-CA', { day: 'numeric', timeZone: snapshot.league.timezone });
          return <Pressable key={game.id} testID={`team-schedule-game-${game.id}`} accessibilityRole="button" accessibilityLabel={gameLabel(game, snapshot.league.timezone)} onPress={() => onOpenGame(game.id)} style={styles.scheduleRow}><View style={styles.scheduleDate}><Text style={styles.scheduleDay}>{month}</Text><Text style={styles.scheduleNumber}>{day}</Text></View><TeamLogo transparentBacking teamId={opponent.id} logoUrl={opponent.logoUrl} teamName={opponent.name} primaryColor={opponent.primaryColor ?? accent} size={30} /><View style={styles.scheduleCopy}><Text numberOfLines={1} style={styles.scheduleOpponent}>{viewedHome ? 'vs' : '@'} {opponent.name}</Text><Text numberOfLines={1} style={styles.scheduleMeta}>{game.location ?? 'Venue TBD'} • {formatTime(game.scheduledAt, snapshot.league.timezone)}</Text></View><View style={styles.scheduleResult}><Text style={styles.scheduleStatus}>{gameStatus(game.status).toUpperCase()}</Text><Text style={styles.scheduleScore}>{showScore ? `${nullableDisplay(mine)}–${nullableDisplay(theirs)}` : formatDate(game.scheduledAt, snapshot.league.timezone)}</Text></View></Pressable>;
        }) : <Text style={styles.emptyBody}>No current-season games are posted.</Text>}
        {snapshot.games.length > snapshot.collapsedSchedule.length ? <Pressable testID="team-schedule-toggle" accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={styles.showAll}><Text style={[styles.showAllText, { color: accent }]}>{expanded ? 'SHOW LESS' : 'SHOW FULL SCHEDULE'}</Text><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={accent} /></Pressable> : null}
      </View>
    </View>
  );
}

function Jersey({ player, primary, secondary, compact, onOpenPlayer }: { player: DisplayRosterPlayer; primary: string; secondary: string; compact: boolean; onOpenPlayer: (id: string) => void }) {
  return (
    <Pressable testID={`team-roster-player-${player.playerId}`} accessibilityRole="button" accessibilityLabel={`${player.name}, ${player.jerseyNumber == null ? 'jersey number unknown' : `jersey number ${player.jerseyNumber}`}. Open player card.`} onPress={() => onOpenPlayer(player.playerId)} style={[styles.jerseySlot, compact && styles.jerseySlotCompact]}>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none" style={[styles.jerseyArt, compact && styles.jerseyArtCompact]}>
        <Image source={jerseyPrimary} resizeMode="contain" alt="" accessible={false} style={[styles.jerseyLayer, { tintColor: primary }]} />
        <Image source={jerseySecondary} resizeMode="contain" alt="" accessible={false} style={[styles.jerseyLayer, { tintColor: secondary }]} />
        <Image source={jerseyDetail} resizeMode="contain" alt="" accessible={false} style={styles.jerseyLayer} />
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} allowFontScaling={false} style={styles.jerseyName}>{surname(player.name)}</Text>
        <Text adjustsFontSizeToFit allowFontScaling={false} style={styles.jerseyNumber}>{player.jerseyNumber == null ? '00' : String(player.jerseyNumber).padStart(2, '0')}</Text>
      </View>
    </Pressable>
  );
}

const ROSTER_STAT_COLUMNS = [
  { key: 'gamesPlayed', label: 'GP', spoken: 'games played' },
  { key: 'goals', label: 'G', spoken: 'goals' },
  { key: 'assists', label: 'A', spoken: 'assists' },
  { key: 'points', label: 'PTS', spoken: 'points' },
  { key: 'penaltyMinutes', label: 'PIM', spoken: 'penalty minutes' },
] as const;

function RosterStatRow({ player, onOpenPlayer }: { player: TeamPageRosterPlayer; onOpenPlayer: (id: string) => void }) {
  const position = positionBucket(player) === 'goalie' ? 'G' : positionBucket(player) === 'defence' ? 'D' : 'F';
  const jersey = player.jerseyNumber == null ? 'No #' : `#${player.jerseyNumber}`;
  const leadership = player.leadershipRole === 'captain' ? ' • C' : player.leadershipRole === 'alternate_captain' ? ' • A' : '';
  const facts = ROSTER_STAT_COLUMNS.map(({ key, spoken }) => `${key === 'gamesPlayed' && player.gamesPlayedProvenance === 'estimated' ? 'approximately ' : ''}${player[key] == null ? 'unknown' : player[key]} ${spoken}`).join(', ');
  return (
    <Pressable testID={`team-roster-player-${player.playerId}`} accessibilityRole="button" accessibilityLabel={`${player.name}, ${jersey}, ${position}${leadership}. ${facts}. Open player card.`} onPress={() => onOpenPlayer(player.playerId)} style={styles.rosterListRow}>
      <View style={styles.rosterListIdentity}>
        <Avatar uri={player.photoUrl} name={player.name} size={38} />
        <View style={styles.rosterListCopy}><Text style={styles.rosterListName}>{player.name}</Text><Text style={styles.rosterListMeta}>{jersey} • {position}{leadership}</Text></View>
        <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
      </View>
      <View style={styles.rosterStatGrid}>
        {ROSTER_STAT_COLUMNS.map(({ key, label }) => (
          <View key={key} testID={`team-roster-stat-${player.playerId}-${key}`} style={styles.rosterStatCell}>
            <Text style={styles.rosterStatLabel}>{label}</Text><Text style={styles.rosterStatValue}>{key === 'gamesPlayed' ? estimatedDisplay(player[key], player.gamesPlayedProvenance === 'estimated') : nullableDisplay(player[key])}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function Roster({ snapshot, accent, compact, onOpenPlayer }: { snapshot: TeamPageSnapshot; accent: string; compact: boolean; onOpenPlayer: (id: string) => void }) {
  const [listView, setListView] = React.useState(false);
  const display = getPublishedRoster(snapshot);
  const groups = {
    forwards: display.players.filter((player) => positionBucket(player) === 'forward'),
    defence: display.players.filter((player) => positionBucket(player) === 'defence'),
    goalies: display.players.filter((player) => positionBucket(player) === 'goalie'),
  };
  const primary = snapshot.team.primaryColor ?? accent;
  const secondary = snapshot.team.secondaryColor ?? '#D9B64C';
  return (
    <View testID="team-roster-section">
      <View style={styles.rosterHeadingRow}><View style={styles.rosterHeadingCopy}><SectionHeading icon="people-outline" title={snapshot.nextGame ? 'Next Game Roster' : 'Roster'} accent={accent} /></View><View style={styles.iconToggle}><Pressable testID="team-roster-jersey-toggle" accessibilityRole="button" accessibilityLabel="Show jersey roster" onPress={() => setListView(false)} style={[styles.iconToggleButton, !listView && { backgroundColor: accent }]}><Ionicons name="shirt-outline" size={19} color={!listView ? '#02111B' : colors.textSecondary} /></Pressable><Pressable testID="team-roster-list-toggle" accessibilityRole="button" accessibilityLabel="Show roster list" onPress={() => setListView(true)} style={[styles.iconToggleButton, listView && { backgroundColor: accent }]}><Ionicons name="list" size={20} color={listView ? '#02111B' : colors.textSecondary} /></Pressable></View></View>
      <Text style={styles.rosterTruth}>{display.published ? 'Published next-game lineup' : snapshot.nextGame ? 'Current active-season roster • no published lineup' : 'Current active-season roster'}</Text>
      <Text style={styles.estimateNote}>~GP is an estimate from roster dates and completed public games, not attendance.</Text>
      {snapshot.acceptedSubstitutions.length > 0 ? <View testID="team-substitution-notes" style={styles.substitutionNotes}>{snapshot.acceptedSubstitutions.map((substitution) => <Text key={substitution.id} style={styles.substitutionNote}>🥖 {substitution.subPlayerName} subbing in{substitution.replacedPlayerName ? ` for ${substitution.replacedPlayerName}` : ''}</Text>)}</View> : null}
      {listView ? (
        <View testID="team-roster-list" style={styles.readingPanel}>{snapshot.roster.map((player) => <RosterStatRow key={player.playerId} player={player} onOpenPlayer={onOpenPlayer} />)}</View>
      ) : (
        <View testID="team-roster-jerseys" style={styles.lineup}>
          <Text style={styles.groupLabel}>FORWARDS</Text><View style={styles.forwardGrid}>{groups.forwards.map((player) => <Jersey key={player.playerId} player={player} primary={primary} secondary={secondary} compact={compact} onOpenPlayer={onOpenPlayer} />)}</View>
          <View style={styles.lowerLineup}><View style={styles.defenceGroup}><Text style={styles.groupLabel}>DEFENCE</Text><View style={styles.defenceGrid}>{groups.defence.map((player) => <Jersey key={player.playerId} player={player} primary={primary} secondary={secondary} compact={compact} onOpenPlayer={onOpenPlayer} />)}</View></View><View style={styles.goalieGroup}><Text style={styles.groupLabel}>GOALIE</Text>{groups.goalies.map((player) => <Jersey key={player.playerId} player={player} primary={primary} secondary={secondary} compact={compact} onOpenPlayer={onOpenPlayer} />)}</View></View>
          {display.players.length === 0 ? <Text style={styles.emptyBody}>No active players are listed for this season.</Text> : null}
        </View>
      )}
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
      {entry ? <View style={styles.rivalPanel}>
        <Text style={styles.rivalEyebrow}>SEASON MATCHUP • {entry.gamesPlayed} {entry.gamesPlayed === 1 ? 'MEETING' : 'MEETINGS'}</Text>
        <View style={styles.rivalTeams}><RivalSide side={entry.team} align="left" /><Text style={styles.rivalVs}>VS</Text><RivalSide side={entry.rival} align="right" /></View>
        <View style={styles.h2hRow}><Text style={styles.rivalMetricValue}>{entry.team.overallRecord}</Text><Text style={styles.rivalMetricLabel}>RECORD</Text><Text style={styles.rivalMetricValue}>{entry.rival.overallRecord}</Text></View>
        <View style={styles.h2hRow}><Text style={styles.rivalMetricValue}>{entry.h2hRecord}</Text><Text style={styles.rivalMetricLabel}>H2H</Text><Text style={styles.rivalMetricValue}>{entry.h2hRecordRival}</Text></View>
        <MetricComparison label="GF" left={entry.team.goalsFor} right={entry.rival.goalsFor} leftColor={entry.team.primaryColor ?? accent} rightColor={entry.rival.primaryColor ?? accent} />
        <MetricComparison label="GA" left={entry.team.goalsAgainst} right={entry.rival.goalsAgainst} leftColor={entry.team.primaryColor ?? accent} rightColor={entry.rival.primaryColor ?? accent} />
        <MetricComparison label="DIFF" left={entry.team.goalDifferential} right={entry.rival.goalDifferential} leftColor={entry.team.primaryColor ?? accent} rightColor={entry.rival.primaryColor ?? accent} />
        <View style={styles.rivalLeaderRow}><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={styles.rivalLeaderName}>{entry.team.sniper.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.team.primaryColor ?? accent }]}>{nullableDisplay(entry.team.sniper.goals)} G</Text></View><Text style={styles.rivalMetricLabel}>SNIPER</Text><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={[styles.rivalLeaderName, { textAlign: 'right' }]}>{entry.rival.sniper.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.rival.primaryColor ?? accent, textAlign: 'right' }]}>{nullableDisplay(entry.rival.sniper.goals)} G</Text></View></View>
        <View style={styles.rivalLeaderRow}><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={styles.rivalLeaderName}>{entry.team.playmaker.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.team.primaryColor ?? accent }]}>{nullableDisplay(entry.team.playmaker.assists)} A</Text></View><Text style={styles.rivalMetricLabel}>PLAYMAKER</Text><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={[styles.rivalLeaderName, { textAlign: 'right' }]}>{entry.rival.playmaker.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.rival.primaryColor ?? accent, textAlign: 'right' }]}>{nullableDisplay(entry.rival.playmaker.assists)} A</Text></View></View>
        <View style={styles.rivalLeaderRow}><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={styles.rivalLeaderName}>{entry.team.tendy.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.team.primaryColor ?? accent }]}>{estimatedDisplay(entry.team.tendy.gamesPlayed, entry.team.tendy.gamesPlayedProvenance === 'estimated')} GP • {estimatedDisplay(entry.team.tendy.goalsAgainstAverage, entry.team.tendy.goalsAgainstAverageProvenance === 'estimated', 2)} GAA</Text></View><Text style={styles.rivalMetricLabel}>TENDY</Text><View style={styles.rivalLeaderSide}><Text numberOfLines={1} style={[styles.rivalLeaderName, { textAlign: 'right' }]}>{entry.rival.tendy.name}</Text><Text style={[styles.rivalLeaderValue, { color: entry.rival.primaryColor ?? accent, textAlign: 'right' }]}>{estimatedDisplay(entry.rival.tendy.gamesPlayed, entry.rival.tendy.gamesPlayedProvenance === 'estimated')} GP • {estimatedDisplay(entry.rival.tendy.goalsAgainstAverage, entry.rival.tendy.goalsAgainstAverageProvenance === 'estimated', 2)} GAA</Text></View></View>
        <Text style={styles.estimateNote}>~Goalie GP/GAA is derived from public game and stat rows and may be incomplete.</Text>
        {(['strength', 'weakness'] as const).map((trait) => <View key={trait} style={styles.badgesRow}>{[entry.team, entry.rival].map((side, sideIndex) => <View key={side.id} accessible accessibilityLabel={`${side.name} ${trait}: ${side[trait]}`} style={{ flex: 1, minWidth: 0, alignItems: sideIndex ? 'flex-end' : 'flex-start' }}><Text style={styles.rivalMetricLabel}>{trait.toUpperCase()}</Text><View style={styles.badge}><Text style={styles.badgeText}>{side[trait].toUpperCase()}</Text></View></View>)}</View>)}
        {snapshot.rivals.length > 1 ? <View style={styles.carouselControls}><Pressable testID="team-rival-previous" accessibilityRole="button" accessibilityLabel="Previous rival" onPress={() => setIndex((value) => (value - 1 + snapshot.rivals.length) % snapshot.rivals.length)} style={styles.carouselButton}><Ionicons name="chevron-back" size={18} color={colors.textPrimary} /></Pressable><Text testID="team-rival-dots" style={styles.carouselDots}>{snapshot.rivals.map((_, dot) => dot === index ? '●' : '○').join('')}</Text><Pressable testID="team-rival-next" accessibilityRole="button" accessibilityLabel="Next rival" onPress={() => setIndex((value) => (value + 1) % snapshot.rivals.length)} style={styles.carouselButton}><Ionicons name="chevron-forward" size={18} color={colors.textPrimary} /></Pressable></View> : null}
      </View> : <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>No rivalry sample yet</Text><Text style={styles.emptyBody}>Rival matchups will appear after completed games.</Text></View>}
    </View>
  );
}

function CaptainContact({ snapshot, accent, onOpenPlayer }: { snapshot: TeamPageSnapshot; accent: string; onOpenPlayer: (id: string) => void }) {
  return <View testID="team-captain-contact"><SectionHeading icon="shield-checkmark-outline" title="Captain Contact" accent={accent} /><View style={styles.readingPanel}>{snapshot.captain ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${snapshot.captain.name}'s player card`} onPress={() => onOpenPlayer(snapshot.captain!.playerId)} style={styles.captainContact}><Avatar uri={snapshot.captain.photoUrl} name={snapshot.captain.name} size={50} /><View><Text style={styles.captainName}>{snapshot.captain.name}</Text><Text style={styles.captainMeta}>Captain{snapshot.captain.jerseyNumber == null ? '' : ` • #${snapshot.captain.jerseyNumber}`}</Text></View></Pressable> : <Text style={styles.emptyBody}>Captain information is not listed yet.</Text>}</View></View>;
}

export default function TeamPublicPage({ snapshot, reduceTransparency, onOpenPlayer, onOpenGame }: { snapshot: TeamPageSnapshot; reduceTransparency: boolean; onOpenPlayer: (playerId: string) => void; onOpenGame: (gameId: string) => void }) {
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const accent = colors.primary;
  return <View testID="team-public-composition" style={[styles.composition, reduceTransparency && styles.compositionOpaque]}><Hero snapshot={snapshot} compact={compact} /><NextGame game={snapshot.nextGame} accent={accent} compact={compact} timeZone={snapshot.league.timezone} onOpenGame={onOpenGame} /><Leaders snapshot={snapshot} accent={accent} onOpenPlayer={onOpenPlayer} /><Schedule snapshot={snapshot} accent={accent} onOpenGame={onOpenGame} /><Roster snapshot={snapshot} accent={accent} compact={compact} onOpenPlayer={onOpenPlayer} /><Rivals snapshot={snapshot} accent={accent} /><CaptainContact snapshot={snapshot} accent={accent} onOpenPlayer={onOpenPlayer} />{snapshot.sponsors.length > 0 ? <View testID="team-partners" style={styles.partners}><Text style={styles.partnersLabel}>FEATURED PARTNERS</Text><View style={styles.partnerLogos}>{snapshot.sponsors.filter((sponsor) => sponsor.logoUrl).map((sponsor) => <Image key={sponsor.id} source={{ uri: sponsor.logoUrl! }} resizeMode="contain" alt={sponsor.name} style={styles.partnerLogo} />)}</View></View> : null}</View>;
}

const styles = StyleSheet.create({
  composition: { backgroundColor: '#03070D', gap: 28, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 36 },
  compositionOpaque: { backgroundColor: '#03070D' },
  sectionHeading: { flexShrink: 1, minWidth: 0, minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionHeadingText: { flexShrink: 1, color: '#F7FBFF', fontSize: 24, lineHeight: 28, fontWeight: '900', letterSpacing: -.35 },
  hero: { alignItems: 'center', paddingVertical: 16, gap: 10 },
  heroLogoWrap: { position: 'relative', width: 190, minHeight: 174, alignItems: 'center', justifyContent: 'center' },
  trophyWrap: { position: 'absolute', right: -14, bottom: -4, width: 86, height: 102 },
  trophyWrapCompact: { right: -4, width: 76, height: 90 }, trophy: { width: '100%', height: '100%' },
  trophyBadge: { position: 'absolute', right: -2, bottom: 21, minWidth: 34, minHeight: 26, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(245,204,96,.5)', backgroundColor: 'rgba(0,0,0,.72)', paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  trophyBadgeText: { color: '#F5CC60', fontSize: 13, fontWeight: '900' },
  heroName: { color: '#8E9BAF', fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 2.25, textTransform: 'uppercase', textAlign: 'center' },
  heroRecord: { color: '#F7FBFF', fontSize: 44, lineHeight: 50, fontWeight: '900', letterSpacing: -1.3 }, heroRecordCompact: { fontSize: 44, lineHeight: 50 },
  heroPills: { width: '100%', alignItems: 'center', gap: 8 },
  heroPillRow: { maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  heroPill: { maxWidth: '100%', minHeight: 34, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', backgroundColor: 'rgba(255,255,255,.025)', paddingHorizontal: 16, paddingVertical: 8 },
  heroPillLabel: { color: '#8E9BAF', fontSize: 10, fontWeight: '800', letterSpacing: .75 }, heroPillValue: { color: '#F7FBFF', fontSize: 13, fontWeight: '900' },
  championshipLine: { maxWidth: 320, color: '#7E8A9D', fontSize: 11, lineHeight: 16, textAlign: 'center' },
  matchupCard: { overflow: 'hidden', borderRadius: 28, minHeight: 328, backgroundColor: '#03070D' }, matchupBackground: { minHeight: 328, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 20 }, matchupBackgroundCompact: { minHeight: 300, paddingHorizontal: 10 }, matchupImage: { borderRadius: 28 },
  matchupTeams: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, paddingBottom: 16 }, matchupTeam: { minWidth: 0, flex: 1, alignItems: 'center', gap: 5 },
  matchupName: { alignSelf: 'stretch', minHeight: 80, color: '#FFFFFF', fontSize: 30, lineHeight: 30, fontWeight: '900', letterSpacing: -.7, textAlign: 'center' }, matchupNameCompact: { fontSize: 27, lineHeight: 28 }, matchupSide: { color: '#B8C0CE', fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  gameMetaPill: { minHeight: ui.minTouchTarget, alignSelf: 'center', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', backgroundColor: 'rgba(3,7,13,.76)', paddingHorizontal: 12, paddingVertical: 9 }, gameMetaText: { flexShrink: 1, color: '#C1CAD8', fontSize: 9, fontWeight: '800', letterSpacing: .2 }, metaDivider: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#536176', marginHorizontal: 7 },
  readingPanel: { borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', backgroundColor: 'rgba(11,15,22,.88)', padding: 16 },
  estimateNote: { color: '#8D9AAF', fontSize: 9, lineHeight: 13, textAlign: 'center', marginBottom: 8 },
  leaderControls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 20 }, segmented: { flexDirection: 'row', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,.13)', backgroundColor: '#080D14', padding: 3 }, metricButton: { minWidth: ui.minTouchTarget, minHeight: ui.minTouchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 8 }, metricText: { color: '#9BA7B8', fontSize: 12, fontWeight: '800' }, metricTextActive: { color: '#02111B' }, chartToggle: { width: ui.minTouchTarget, height: ui.minTouchTarget, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,.13)', alignItems: 'center', justifyContent: 'center' },
  podium: { minHeight: 220, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 7 }, leaderCard: { minWidth: 0, flex: 1, alignItems: 'center', borderRadius: 20, borderWidth: 1, paddingHorizontal: 5, paddingTop: 14, paddingBottom: 12 }, leaderFirst: { minHeight: 214, paddingTop: 22 }, leaderSecond: { minHeight: 206 }, leaderThird: { minHeight: 206 }, leaderAvatarHalo: { width: 58, height: 58, borderRadius: 40, borderWidth: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03070D' }, leaderAvatarInner: { borderRadius: 40, borderWidth: 2 }, leaderName: { minHeight: 34, marginTop: 8, color: '#F7FBFF', fontSize: 12, lineHeight: 16, fontWeight: '900', textAlign: 'center' }, leaderValue: { marginTop: 7, fontSize: 18, fontWeight: '900' }, leaderMeta: { marginTop: 8, color: '#778396', fontSize: 9, fontWeight: '700' },
  bars: { gap: 12 }, barRow: { minHeight: ui.minTouchTarget, gap: 6 }, barIdentity: { flexDirection: 'row', alignItems: 'center', gap: 9 }, barName: { minWidth: 0, flex: 1, color: '#E8EEF7', fontSize: 13, fontWeight: '800' }, barValue: { fontSize: 14, fontWeight: '900' }, barTrack: { height: 7, borderRadius: 4, backgroundColor: '#151C27', overflow: 'hidden' }, barFill: { height: 7, borderRadius: 4 },
  scheduleRow: { minHeight: 66, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,.13)', paddingVertical: 10 }, scheduleDate: { width: 30, alignItems: 'center' }, scheduleDay: { color: '#778396', fontSize: 8, fontWeight: '900', letterSpacing: .7 }, scheduleNumber: { color: '#F7FBFF', fontSize: 17, fontWeight: '900' }, scheduleCopy: { minWidth: 80, flex: 1 }, scheduleOpponent: { color: '#F7FBFF', fontSize: 12, fontWeight: '900' }, scheduleMeta: { marginTop: 3, color: '#758196', fontSize: 9 }, scheduleResult: { maxWidth: '100%', flexShrink: 1, alignItems: 'flex-end', marginLeft: 'auto' }, scheduleStatus: { color: '#758196', fontSize: 8, fontWeight: '900', letterSpacing: .5 }, scheduleScore: { marginTop: 3, color: '#F7FBFF', fontSize: 12, fontWeight: '900' }, showAll: { minHeight: ui.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 }, showAllText: { fontSize: 10, fontWeight: '900', letterSpacing: .8 },
  rosterHeadingCopy: { flex: 1, minWidth: 0 }, rosterHeadingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, iconToggle: { flexShrink: 0, marginBottom: 12, flexDirection: 'row', borderWidth: 1, borderColor: 'rgba(255,255,255,.13)', borderRadius: 999, padding: 2 }, iconToggleButton: { width: ui.minTouchTarget, height: ui.minTouchTarget, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, rosterTruth: { marginTop: 0, marginBottom: 14, color: '#738095', fontSize: 10, fontWeight: '700' },
  substitutionNotes: { gap: 5, marginTop: -7, marginBottom: 14 }, substitutionNote: { color: '#A8B4C8', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  lineup: { gap: 15 }, groupLabel: { marginBottom: 4, color: '#758196', fontSize: 9, fontWeight: '900', letterSpacing: 1.5, textAlign: 'center' }, forwardGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 3, rowGap: 7 }, lowerLineup: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 5 }, defenceGroup: { flex: 2 }, goalieGroup: { flex: 1, alignItems: 'center' }, defenceGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 3 },
  jerseySlot: { width: '32%', minWidth: 92, minHeight: ui.minTouchTarget, alignItems: 'center' }, jerseySlotCompact: { minWidth: 82 }, jerseyArt: { position: 'relative', width: 106, height: 91 }, jerseyArtCompact: { width: 92, height: 79 }, jerseyLayer: { position: 'absolute', width: '100%', height: '100%' }, jerseyName: { position: 'absolute', left: 25, right: 25, top: '29%', color: '#111111', fontSize: 7, fontWeight: '900', textAlign: 'center', textShadowColor: '#FFFFFF', textShadowRadius: 1 }, jerseyNumber: { position: 'absolute', left: 22, right: 22, top: '42%', color: '#111111', fontSize: 26, lineHeight: 32, fontWeight: '900', textAlign: 'center', textShadowColor: '#FFFFFF', textShadowRadius: 1.5 },
  rosterListRow: { minHeight: 88, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,.13)', paddingVertical: 12 },
  rosterListIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rosterListCopy: { flex: 1, minWidth: 0 }, rosterListName: { color: '#F7FBFF', fontSize: 13, lineHeight: 18, fontWeight: '900' }, rosterListMeta: { marginTop: 3, color: '#A8B4C8', fontSize: 10, lineHeight: 14 },
  rosterStatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, rosterStatCell: { flexBasis: '17%', flexGrow: 1, flexShrink: 1, minWidth: 40, alignItems: 'center' },
  rosterStatLabel: { color: '#A8B4C8', fontSize: 10, lineHeight: 14, fontWeight: '800', textAlign: 'center' }, rosterStatValue: { color: '#F7FBFF', fontSize: 15, lineHeight: 20, fontWeight: '900', textAlign: 'center' },
  rivalPanel: { borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', backgroundColor: '#080D14', padding: 16, gap: 15 }, rivalEyebrow: { color: '#748196', fontSize: 8, fontWeight: '900', letterSpacing: 1.25, textAlign: 'center' }, rivalTeams: { flexDirection: 'row', alignItems: 'center', gap: 10 }, rivalIdentity: { flex: 1, alignItems: 'center', gap: 7 }, rivalName: { minHeight: 30, color: '#F7FBFF', fontSize: 12, lineHeight: 15, fontWeight: '900' }, rivalVs: { color: '#586579', fontSize: 10, fontWeight: '900' }, rivalMetric: { gap: 5 }, rivalMetricHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, rivalMetricLabel: { color: '#748196', fontSize: 8, fontWeight: '900', letterSpacing: 1 }, rivalMetricValue: { minWidth: 46, color: '#E8EEF7', fontSize: 11, fontWeight: '900', textAlign: 'center' }, rivalBars: { flexDirection: 'row', gap: 8 }, rivalTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#171D27', overflow: 'hidden' }, rivalBarLeft: { alignSelf: 'flex-end', height: 5, borderRadius: 3 }, rivalBarRight: { height: 5, borderRadius: 3 }, h2hRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, rivalLeaderRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 }, rivalLeaderSide: { minWidth: 0, flex: 1 }, rivalLeaderName: { color: '#E8EEF7', fontSize: 10, fontWeight: '800' }, rivalLeaderValue: { marginTop: 2, fontSize: 11, fontWeight: '900' }, badgesRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' }, badge: { maxWidth: '100%', marginTop: 5, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(34,211,238,.28)', backgroundColor: 'rgba(34,211,238,.08)', paddingHorizontal: 9, paddingVertical: 5 }, badgeText: { color: '#B8F5FF', fontSize: 8, fontWeight: '900' }, carouselControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, carouselButton: { width: ui.minTouchTarget, height: ui.minTouchTarget, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,.13)' }, carouselDots: { color: '#22D3EE', fontSize: 14, letterSpacing: 4 },
  captainContact: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 }, captainName: { color: '#F7FBFF', fontSize: 14, fontWeight: '900' }, captainMeta: { marginTop: 3, color: '#7D899C', fontSize: 11 },
  partners: { alignItems: 'center', gap: 12, paddingTop: 10 }, partnersLabel: { color: '#657286', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 }, partnerLogos: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18 }, partnerLogo: { width: 54, height: 40 },
  emptyPanel: { borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.14)', backgroundColor: 'rgba(11,15,22,.72)', padding: 22, alignItems: 'center', gap: 6 }, emptyTitle: { color: '#F7FBFF', fontSize: 15, fontWeight: '900', textAlign: 'center' }, emptyBody: { color: '#7E8A9D', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
