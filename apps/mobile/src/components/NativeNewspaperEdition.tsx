import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type {
  NewspaperBrief,
  NewspaperEdition,
  NewspaperGame,
  NewspaperTeam,
} from '../lib/newspaperReader';
import colors from '../theme/colors';

const PAPER = '#F2EAD8';
const INK = '#171715';
const MUTED_INK = '#5B554B';
const NEWSPAPER_RED = '#A4161A';
const PRESS = '#252522';
const HAIRLINE = '#746E62';
const SERIF = 'Georgia';
const CONDENSED = 'Arial';
const TOTAL_PAGES = 5;

export function Artwork({ uri, label }: { uri?: string; label: string }) {
  if (!uri) {
    return <View accessibilityLabel={`${label}; artwork not supplied`} style={styles.artFallback}>
      <Text style={styles.fallbackSmall}>HOCKEY LIFE</Text>
      <Text style={styles.fallbackLarge}>TIMES</Text>
    </View>;
  }
  return <ArtworkForUri key={uri} uri={uri} label={label} />;
}

function ArtworkForUri({ uri, label }: { uri: string; label: string }) {
  const [media, setMedia] = React.useState({ aspectRatio: 1, failed: false });
  React.useEffect(() => {
    let active = true;
    if (typeof Image.getSize === 'function') {
      Image.getSize(
        uri,
        (width, height) => {
          if (active && width > 0 && height > 0) {
            setMedia((value) => value.failed ? value : { ...value, aspectRatio: width / height });
          }
        },
        () => {
          if (active) setMedia((value) => value.failed ? value : { ...value, failed: true });
        },
      );
    }
    return () => { active = false; };
  }, [uri]);
  if (media.failed) {
    return <View accessibilityLabel={`${label}; artwork unavailable`} style={styles.artFallback}>
      <Text style={styles.fallbackSmall}>ARTWORK</Text>
      <Text style={styles.fallbackLarge}>UNAVAILABLE</Text>
    </View>;
  }
  return <Image
    source={{ uri }}
    accessibilityLabel={label}
    alt={label}
    resizeMode="contain"
    onError={() => setMedia((value) => value.failed ? value : { ...value, failed: true })}
    style={[styles.artwork, { aspectRatio: media.aspectRatio }]}
  />;
}

export function formatEditionScheduled(value: string, timezone: NewspaperEdition['timezone']) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('month')} ${part('day')}, ${part('year')} · ${part('hour')}:${part('minute')}`;
}

function upper(value: string) {
  return value.toLocaleUpperCase('en-CA');
}

function PageHeader({ edition, recordLine }: { edition: NewspaperEdition; recordLine: string }) {
  return <View style={styles.pageHeader}>
    <View style={styles.folioRow}>
      <Text style={[styles.folio, styles.folioLeft]}>ISSUE {edition.issueNumber}</Text>
      <Text style={[styles.folio, styles.folioCenter]}>{recordLine}</Text>
      <Text style={[styles.folio, styles.folioRight]}>{edition.periodStart} — {edition.periodEnd}</Text>
    </View>
    <View style={styles.mastheadRow}>
      <View accessibilityElementsHidden style={styles.pressSeal}><View style={styles.pressSealDot} /></View>
      <View style={styles.mastheadCenter}>
        <Text accessibilityRole="header" style={styles.mastTitle}>Hockey Life Times</Text>
        <Text style={styles.mastDeck}>BEER LEAGUE NEWS · FROZEN FACTS · HOT TAKES</Text>
      </View>
      <View style={styles.editionMark}>
        <Text style={styles.editionMarkStrong}>{upper(edition.leagueName)}</Text>
        <Text style={styles.editionMarkText}>{upper(edition.seasonName)}</Text>
      </View>
    </View>
    <View style={styles.sectionStrip}>
      <Text style={styles.sectionStripText}>THE WEEK ON ICE</Text>
      <Text style={styles.sectionStripDivider}>|</Text>
      <Text style={styles.sectionStripText}>STARS &amp; SCARS</Text>
      <Text style={styles.sectionStripDivider}>|</Text>
      <Text style={styles.sectionStripText}>NUMBERS THAT HURT</Text>
      <Text style={styles.sectionStripDivider}>|</Text>
      <Text style={styles.sectionStripText}>AROUND THE RINK</Text>
    </View>
  </View>;
}

function PageFooter({ edition, page }: { edition: NewspaperEdition; page: number }) {
  return <View style={styles.pageFooter}>
    <View style={styles.pageFooterInk}>
      <Text style={styles.pageFooterText}>HOCKEY LIFE TIMES</Text>
      <Text style={[styles.pageFooterText, styles.pageFooterCenter]}>{upper(edition.leagueName)} · {upper(edition.seasonName)}</Text>
    </View>
    <View style={styles.pageFooterNumber}>
      <Text style={styles.pageFooterNumberText}>PAGE {page} OF {TOTAL_PAGES}</Text>
    </View>
  </View>;
}

function NewspaperPage({
  edition,
  page,
  recordLine,
  children,
}: {
  edition: NewspaperEdition;
  page: number;
  recordLine: string;
  children: React.ReactNode;
}) {
  return <View
    testID={`newspaper-page-${page}`}
    accessibilityRole="summary"
    accessibilityLabel={`Newspaper page ${page} of ${TOTAL_PAGES}`}
    style={styles.pressFrame}
  >
    <View testID={`newspaper-page-paper-${page}`} style={styles.pagePaper}>
      <PageHeader edition={edition} recordLine={recordLine} />
      <View testID={`newspaper-page-body-${page}`} style={styles.pageBody}>{children}</View>
      <PageFooter edition={edition} page={page} />
    </View>
  </View>;
}

function SectionHeading({ kicker, title, dek }: { kicker?: string; title: string; dek?: string }) {
  return <View style={styles.sectionHeading}>
    {kicker ? <Text style={styles.redKicker}>{kicker}</Text> : null}
    <Text accessibilityRole="header" style={styles.sectionTitle}>{upper(title)}</Text>
    {dek ? <Text style={styles.sectionDek}>{dek}</Text> : null}
  </View>;
}

function TeamLogo({ team, compact = false }: { team: NewspaperTeam; compact?: boolean }) {
  return team.logoUrl
    ? <Image source={{ uri: team.logoUrl }} accessibilityLabel={`${team.name} logo`} alt={`${team.name} logo`} resizeMode="contain" style={compact ? styles.teaserLogo : styles.logo} />
    : <View accessible={false} style={compact ? styles.teaserLogoPlaceholder : styles.logoPlaceholder} />;
}

function GameScore({ game, compact = false }: { game: NewspaperGame; compact?: boolean }) {
  return <View accessibilityLabel={`${game.awayTeam.name} ${game.awayScore}, ${game.homeTeam.name} ${game.homeScore}, final`} style={compact ? styles.teaserScore : styles.scoreBox}>
    <View style={compact ? styles.teaserTeam : styles.teamRow}>
      <TeamLogo team={game.awayTeam} compact={compact} />
      <Text style={compact ? styles.teaserTeamName : styles.teamName}>{upper(game.awayTeam.name)}</Text>
      <Text style={compact ? styles.teaserScoreValue : styles.scoreValue}>{game.awayScore}</Text>
    </View>
    <Text style={compact ? styles.teaserFinal : styles.final}>FINAL</Text>
    <View style={compact ? styles.teaserTeam : styles.teamRow}>
      <TeamLogo team={game.homeTeam} compact={compact} />
      <Text style={compact ? styles.teaserTeamName : styles.teamName}>{upper(game.homeTeam.name)}</Text>
      <Text style={compact ? styles.teaserScoreValue : styles.scoreValue}>{game.homeScore}</Text>
    </View>
  </View>;
}

function DropCapStory({ paragraphs }: { paragraphs: string[] }) {
  const [first = '', ...rest] = paragraphs;
  const firstCharacter = first.slice(0, 1);
  return <View style={styles.bigStory}>
    <Text style={styles.columnLabel}>THE BIG STORY</Text>
    <View
      testID="page-1-lead-paragraph-0"
      accessible
      accessibilityLabel={first}
      style={styles.dropCapParagraph}
    >
      {firstCharacter ? <Text
        testID="page-1-lead-drop-cap-0"
        accessible={false}
        accessibilityElementsHidden
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={styles.dropCap}
      >{firstCharacter}</Text> : null}
      <Text
        testID="page-1-lead-remainder-0"
        accessible={false}
        accessibilityElementsHidden
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={styles.storyCopy}
      >{first.slice(firstCharacter.length)}</Text>
    </View>
    {rest.map((paragraph, index) => <Text key={`${index}:${paragraph.slice(0, 12)}`} style={styles.storyCopy}>{paragraph}</Text>)}
  </View>;
}

function FrontGameTeaser({ game }: { game: NewspaperGame }) {
  return <View testID="front-score-teaser" style={styles.frontTeaser}>
    <Text style={styles.teaserKicker}>INSIDE · GAME REPORT</Text>
    <Text accessibilityRole="header" style={styles.teaserHeadline}>{upper(game.headline)}</Text>
    <GameScore game={game} compact />
  </View>;
}

function BriefSection({
  title,
  items,
  layout = 'columns',
  testID,
}: {
  title: string;
  items: NewspaperBrief[];
  layout?: 'columns' | 'flow';
  testID?: string;
}) {
  return <View testID={testID} style={[styles.ruledSection, layout === 'columns' ? styles.ruledSectionColumns : styles.ruledSectionFlow]}>
    <Text accessibilityRole="header" style={styles.columnTitle}>{upper(title)}</Text>
    {items.length ? items.map((item, index) => <View key={`${item.headline}:${index}`} style={styles.brief}>
      {item.imageUrl ? <Artwork uri={item.imageUrl} label={item.headline} /> : null}
      <Text accessibilityRole="header" style={styles.briefHeadline}>{upper(item.headline)}</Text>
      <Text style={styles.bodyCopy}>{item.body}</Text>
    </View>) : <Text style={styles.muted}>No {title.toLowerCase()} item was supplied.</Text>}
  </View>;
}

function FrontPage({ edition }: { edition: NewspaperEdition }) {
  return <NewspaperPage edition={edition} page={1} recordLine="THE LEAGUE’S INDEPENDENT RECORD">
    <View style={styles.frontLead}>
      <Text style={styles.extra}>EXTRA</Text>
      <Text accessibilityRole="header" style={styles.frontHeadline}>{upper(edition.lead.headline)}</Text>
      <Text style={styles.frontDek}>{edition.lead.dek}</Text>
    </View>
    <View style={styles.leadFeature}>
      <View style={styles.artworkColumn}>
        <Artwork uri={edition.lead.imageUrl} label={edition.lead.headline} />
        {edition.lead.caption ? <Text style={styles.caption}>{edition.lead.caption}</Text> : null}
      </View>
      <DropCapStory paragraphs={edition.lead.body} />
    </View>
    <View style={styles.frontBottom}>
      <View style={styles.frontTeaserGrid}>
        {edition.games.map((game) => <FrontGameTeaser key={game.gameId} game={game} />)}
      </View>
      <View style={styles.issueIndex}>
        <Text accessibilityRole="header" style={styles.issueIndexTitle}>IN THIS ISSUE</Text>
        <Text style={styles.issueIndexItem}>1. {edition.games.length} game {edition.games.length === 1 ? 'report' : 'reports'}, fully accounted for</Text>
        <Text style={styles.issueIndexItem}>2. Three stars and the week in numbers</Text>
        <Text style={styles.issueIndexItem}>3. The heater, the cold tub, and the table</Text>
        <Text style={styles.issueIndexItem}>4. Next week, around the rink, and source notes</Text>
      </View>
    </View>
  </NewspaperPage>;
}

function GameReportsPage({ edition }: { edition: NewspaperEdition }) {
  return <NewspaperPage edition={edition} page={2} recordLine="SCORES, STORIES & CONSEQUENCES">
    <SectionHeading kicker="FINAL BUZZER EDITION" title="This Week on the Ice" dek={`${edition.games.length} completed ${edition.games.length === 1 ? 'game' : 'games'}. The scoreboard gets the final word.`} />
    {edition.games.map((game, index) => <View key={game.gameId} style={styles.gameReport}>
      <Text style={styles.redKicker}>GAME {index + 1}</Text>
      <Text accessibilityRole="header" style={styles.reportHeadline}>{upper(game.headline)}</Text>
      <GameScore game={game} />
      {game.body.map((paragraph, paragraphIndex) => <Text key={`${paragraphIndex}:${paragraph.slice(0, 12)}`} style={styles.bodyCopy}>{paragraph}</Text>)}
      {game.imageUrl ? <View style={styles.reportArtwork}><Artwork uri={game.imageUrl} label={game.headline} /><Text style={styles.caption}>From the rink report</Text></View> : null}
      <Text accessibilityRole="header" style={styles.contributorTitle}>Names on the scoresheet</Text>
      {game.contributors.length ? game.contributors.map((player) => <View key={player.playerId} style={styles.contributorRow}>
        <View style={styles.grow}>
          <Text style={styles.contributorName}>{player.name}</Text>
          <Text style={styles.contributorTeam}>{player.teamName}</Text>
        </View>
        <Text style={styles.contributorStats}>{player.goals}G · {player.assists}A · {player.points}P</Text>
      </View>) : <Text style={styles.muted}>No individual contributors were supplied.</Text>}
    </View>)}
  </NewspaperPage>;
}

function StarsAndNumbersPage({ edition }: { edition: NewspaperEdition }) {
  const visibleNumbers = edition.numbers.filter((item) => !/\b(?:source\s+warnings?|warning\s+count)\b/i.test(item.label));
  return <NewspaperPage edition={edition} page={3} recordLine="PERFORMANCE DESERVES INK">
    <SectionHeading kicker="THE PODIUM" title="Three Stars of the Week" dek="The Times’ editorial picks from this week’s verified scoresheets." />
    <View style={styles.starGrid}>
      {edition.stars.map((star, index) => <View key={star.playerId} style={styles.starCard}>
        <View style={styles.starRank}><Text style={styles.starRankText}>{index + 1}</Text></View>
        {star.illustrationUrl || star.photoUrl ? <Artwork uri={star.illustrationUrl || star.photoUrl} label={`${star.name}, ${star.teamName}`} /> : null}
        <Text style={styles.redKicker}>{upper(star.teamName)}</Text>
        <Text accessibilityRole="header" style={styles.starName}>{upper(star.name)}</Text>
        <View style={styles.starStats}>
          <Text style={styles.starStat}>{star.goals} goals</Text>
          <Text style={styles.starStat}>{star.assists} assists</Text>
          <Text style={styles.starPoints}>{star.points} points</Text>
        </View>
        <Text style={styles.bodyCopy}>{star.reason}</Text>
      </View>)}
    </View>
    <View style={styles.numbersSection}>
      <Text accessibilityRole="header" style={styles.columnTitle}>THIS WEEK BY THE NUMBERS</Text>
      <View style={styles.numberGrid}>
        {visibleNumbers.map((item, index) => <View key={`${item.label}:${index}`} style={styles.numberCard}>
          <Text style={styles.numberValue}>{item.value}</Text>
          <Text accessibilityRole="header" style={styles.numberLabel}>{upper(item.label)}</Text>
          {item.detail ? <Text style={styles.muted}>{item.detail}</Text> : null}
        </View>)}
      </View>
    </View>
  </NewspaperPage>;
}

function StandingsAndTemperaturePage({ edition }: { edition: NewspaperEdition }) {
  return <NewspaperPage edition={edition} page={4} recordLine="THE TABLE NEVER BLINKS">
    <SectionHeading kicker="THE LEDGER" title="Standings" dek={edition.standingsNote || 'The verified table at publication time.'} />
    <View style={styles.standingsTable}>
      <View style={styles.standingsHeader}>
        <Text style={[styles.tableHeader, styles.placeColumn]}>#</Text>
        <Text style={[styles.tableHeader, styles.grow]}>CLUB</Text>
        <Text style={styles.tableHeader}>GP</Text>
        <Text style={styles.tableHeader}>W-L-OT-T</Text>
        <Text style={styles.tableHeader}>PTS</Text>
      </View>
      {edition.standings.map((row, index) => <View key={row.teamId} style={styles.standingRow}>
        <Text style={styles.placeColumn}>{index + 1}</Text>
        <View style={styles.standingClub}>
          {row.logoUrl ? <Image source={{ uri: row.logoUrl }} accessibilityLabel={`${row.name} logo`} alt={`${row.name} logo`} resizeMode="contain" style={styles.tableLogo} /> : null}
          <View style={styles.grow}>
            <Text style={styles.standingName}>{row.name}</Text>
            <Text style={styles.standingGoals}>{row.gf} GF · {row.ga} GA</Text>
          </View>
        </View>
        <Text style={styles.tableValue}>{row.gp}</Text>
        <Text style={styles.tableRecord}>{row.w}-{row.l}-{row.otl}-{row.t}</Text>
        <Text style={styles.tablePoints}>{row.pts}</Text>
      </View>)}
    </View>
    <View style={styles.temperatureGrid}>
      <BriefSection title="The Heater" items={edition.hot} />
      <BriefSection title="The Cold Tub" items={edition.cold} />
    </View>
  </NewspaperPage>;
}

function NextWeekPage({ edition }: { edition: NewspaperEdition }) {
  return <NewspaperPage edition={edition} page={5} recordLine="WHAT COMES NEXT">
    <SectionHeading kicker="ON THE HORIZON" title="Next Week" dek={edition.upcoming.length ? `${edition.upcoming.length} upcoming ${edition.upcoming.length === 1 ? 'fixture' : 'fixtures'} on the verified calendar.` : edition.upcomingNote} />
    <View style={styles.upcomingList}>
      {edition.upcoming.length ? edition.upcoming.map((game, index) => <View key={game.gameId} style={styles.upcomingCard}>
        <Text style={styles.redKicker}>FIXTURE {index + 1}</Text>
        <Text accessibilityRole="header" style={styles.upcomingHeadline}>{upper(game.headline)}</Text>
        <Text style={styles.upcomingTeams}>{game.awayName} at {game.homeName}</Text>
        <Text style={styles.upcomingMeta}>{formatEditionScheduled(game.scheduledAt, edition.timezone)}{game.venue ? ` · ${game.venue}` : ''}</Text>
        <Text style={styles.bodyCopy}>{game.body}</Text>
      </View>) : <Text style={styles.bodyCopy}>{edition.upcomingNote}</Text>}
    </View>
    <BriefSection title="Around the Rink" items={edition.aroundRink ?? []} layout="flow" testID="page-5-around-rink" />
    <View testID="page-5-source-notes" style={styles.sourceNotes}>
      <Text accessibilityRole="header" style={styles.columnTitle}>SOURCE NOTES</Text>
      <Text style={styles.sourceMeta}>Verified against {edition.source.gameIds.length} finalized game {edition.source.gameIds.length === 1 ? 'record' : 'records'}.</Text>
      {edition.source.standingsAsOf ? <Text style={styles.sourceMeta}>Standings current to {edition.source.standingsAsOf}.</Text> : null}
      <Text style={styles.sourceMeta}>{edition.source.warnings.length} source-review {edition.source.warnings.length === 1 ? 'note was' : 'notes were'} reviewed.</Text>
    </View>
  </NewspaperPage>;
}

export default function NativeNewspaperEdition({ edition }: { edition: NewspaperEdition }) {
  return <View testID="native-newspaper-edition" accessibilityLabel={`${edition.title} issue ${edition.issueNumber}`} style={styles.edition}>
    <FrontPage edition={edition} />
    <GameReportsPage edition={edition} />
    <StarsAndNumbersPage edition={edition} />
    <StandingsAndTemperaturePage edition={edition} />
    <NextWeekPage edition={edition} />
  </View>;
}

const styles = StyleSheet.create({
  edition: { width: '100%', gap: 18, marginTop: 18 },
  pressFrame: { width: '100%', padding: 10, backgroundColor: PRESS, borderWidth: 1, borderColor: '#494943', borderRadius: 16 },
  pagePaper: { width: '100%', backgroundColor: PAPER, borderRadius: 0, overflow: 'hidden', borderWidth: 1, borderColor: '#D1C6AE' },
  pageHeader: { paddingHorizontal: 10, paddingTop: 9 },
  folioRow: { minHeight: 22, flexDirection: 'row', alignItems: 'center', borderTopWidth: 2, borderBottomWidth: 1, borderColor: INK, paddingVertical: 4, gap: 4 },
  folio: { flex: 1, minWidth: 0, color: INK, fontFamily: CONDENSED, fontSize: 8, lineHeight: 10, fontWeight: '800', letterSpacing: 0.5 },
  folioLeft: { textAlign: 'left' },
  folioCenter: { flexGrow: 1.45, textAlign: 'center' },
  folioRight: { textAlign: 'right' },
  mastheadRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 7, borderBottomWidth: 2, borderColor: INK, paddingVertical: 7 },
  pressSeal: { width: 31, height: 31, flexShrink: 0, borderRadius: 16, borderWidth: 2, borderColor: INK, alignItems: 'center', justifyContent: 'center' },
  pressSealDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: INK },
  mastheadCenter: { flex: 1, minWidth: 0, alignItems: 'center' },
  mastTitle: { color: INK, fontFamily: SERIF, fontSize: 28, lineHeight: 32, fontWeight: '700', textAlign: 'center' },
  mastDeck: { color: INK, fontFamily: CONDENSED, fontSize: 7, lineHeight: 10, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  editionMark: { width: 58, flexShrink: 0, alignItems: 'flex-end' },
  editionMarkStrong: { color: INK, fontFamily: CONDENSED, fontSize: 8, lineHeight: 10, fontWeight: '900', textAlign: 'right' },
  editionMarkText: { color: INK, fontFamily: CONDENSED, fontSize: 7, lineHeight: 10, fontWeight: '700', textAlign: 'right' },
  sectionStrip: { minHeight: 24, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 4, borderBottomWidth: 2, borderColor: INK, paddingVertical: 5 },
  sectionStripText: { color: INK, fontFamily: CONDENSED, fontSize: 7, lineHeight: 9, fontWeight: '900', letterSpacing: 0.35 },
  sectionStripDivider: { color: NEWSPAPER_RED, fontSize: 7, lineHeight: 9, fontWeight: '900' },
  pageBody: { padding: 10, gap: 12 },
  pageFooter: { minHeight: 30, flexDirection: 'row', alignItems: 'stretch', marginTop: 8 },
  pageFooterInk: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 5, backgroundColor: INK, paddingHorizontal: 9, paddingVertical: 7 },
  pageFooterText: { color: PAPER, fontFamily: SERIF, fontSize: 7, lineHeight: 9, letterSpacing: 0.5 },
  pageFooterCenter: { textAlign: 'right' },
  pageFooterNumber: { minWidth: 75, justifyContent: 'center', backgroundColor: NEWSPAPER_RED, paddingHorizontal: 8, paddingVertical: 7 },
  pageFooterNumberText: { color: '#FFFFFF', fontFamily: CONDENSED, fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center' },
  frontLead: { borderBottomWidth: 3, borderColor: INK, paddingBottom: 8 },
  extra: { color: NEWSPAPER_RED, fontFamily: CONDENSED, fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 1.6, marginBottom: 3 },
  frontHeadline: { color: INK, fontFamily: CONDENSED, fontSize: 30, lineHeight: 31, fontWeight: '900', letterSpacing: -1.2 },
  frontDek: { color: INK, fontFamily: SERIF, fontSize: 14, lineHeight: 19, fontWeight: '700', marginTop: 6 },
  leadFeature: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 9 },
  artworkColumn: { minWidth: 174, flexGrow: 1.55, flexShrink: 1, flexBasis: 174, gap: 5 },
  bigStory: { minWidth: 116, flexGrow: 1, flexShrink: 1, flexBasis: 116, borderTopWidth: 2, borderBottomWidth: 1, borderColor: INK, paddingTop: 5, paddingBottom: 7, gap: 6 },
  columnLabel: { color: INK, fontFamily: CONDENSED, fontSize: 9, lineHeight: 12, fontWeight: '900', borderBottomWidth: 1, borderColor: INK, paddingBottom: 4 },
  dropCapParagraph: { flexDirection: 'row', alignItems: 'flex-start' },
  dropCap: { color: NEWSPAPER_RED, fontFamily: SERIF, fontSize: 34, lineHeight: 32, fontWeight: '700', marginRight: 2 },
  storyCopy: { flexShrink: 1, color: INK, fontFamily: SERIF, fontSize: 12, lineHeight: 18 },
  caption: { color: MUTED_INK, fontFamily: SERIF, fontSize: 9, lineHeight: 13, fontStyle: 'italic' },
  frontBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 8, borderBottomWidth: 1, borderColor: HAIRLINE, paddingBottom: 10 },
  frontTeaserGrid: { minWidth: 178, flex: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  frontTeaser: { minWidth: 138, flexGrow: 1, flexShrink: 1, flexBasis: 138, borderTopWidth: 2, borderRightWidth: 1, borderBottomWidth: 1, borderColor: HAIRLINE, paddingVertical: 7, paddingRight: 7, gap: 5 },
  teaserKicker: { color: NEWSPAPER_RED, fontFamily: CONDENSED, fontSize: 7, lineHeight: 9, fontWeight: '900', letterSpacing: 0.45 },
  teaserHeadline: { color: INK, fontFamily: CONDENSED, fontSize: 15, lineHeight: 16, fontWeight: '900' },
  teaserScore: { gap: 3, borderTopWidth: 1, borderBottomWidth: 1, borderColor: INK, paddingVertical: 4 },
  teaserTeam: { minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 4 },
  teaserLogo: { width: 20, height: 20, flexShrink: 0 },
  teaserLogoPlaceholder: { width: 20, height: 20, flexShrink: 0, borderRadius: 10, borderWidth: 1, borderColor: HAIRLINE },
  teaserTeamName: { flex: 1, minWidth: 0, color: INK, fontFamily: CONDENSED, fontSize: 8, lineHeight: 10, fontWeight: '900' },
  teaserScoreValue: { color: NEWSPAPER_RED, fontFamily: CONDENSED, fontSize: 18, lineHeight: 21, fontWeight: '900' },
  teaserFinal: { color: MUTED_INK, fontFamily: CONDENSED, fontSize: 7, lineHeight: 9, fontWeight: '900', textAlign: 'center' },
  issueIndex: { minWidth: 116, flex: 1, borderTopWidth: 2, borderColor: INK, paddingTop: 6, gap: 5 },
  issueIndexTitle: { color: INK, fontFamily: CONDENSED, fontSize: 14, lineHeight: 17, fontWeight: '900' },
  issueIndexItem: { color: INK, fontFamily: SERIF, fontSize: 9, lineHeight: 14 },
  sectionHeading: { borderBottomWidth: 3, borderColor: INK, paddingBottom: 8 },
  redKicker: { color: NEWSPAPER_RED, fontFamily: CONDENSED, fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 1.1 },
  sectionTitle: { color: INK, fontFamily: CONDENSED, fontSize: 28, lineHeight: 30, fontWeight: '900', letterSpacing: -0.7 },
  sectionDek: { color: MUTED_INK, fontFamily: SERIF, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 4 },
  gameReport: { gap: 8, borderBottomWidth: 2, borderColor: INK, paddingBottom: 13 },
  reportHeadline: { color: INK, fontFamily: CONDENSED, fontSize: 22, lineHeight: 24, fontWeight: '900' },
  scoreBox: { gap: 4, borderTopWidth: 2, borderBottomWidth: 2, borderColor: INK, paddingVertical: 6 },
  teamRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 },
  logo: { width: 34, height: 34, flexShrink: 0 },
  logoPlaceholder: { width: 34, height: 34, flexShrink: 0, borderRadius: 17, borderWidth: 1, borderColor: HAIRLINE },
  teamName: { flex: 1, minWidth: 0, color: INK, fontFamily: CONDENSED, fontSize: 13, lineHeight: 17, fontWeight: '900' },
  scoreValue: { color: NEWSPAPER_RED, fontFamily: CONDENSED, fontSize: 27, lineHeight: 30, fontWeight: '900' },
  final: { color: MUTED_INK, fontFamily: CONDENSED, fontSize: 8, lineHeight: 10, fontWeight: '900', textAlign: 'center' },
  bodyCopy: { color: INK, fontFamily: SERIF, fontSize: 14, lineHeight: 21 },
  reportArtwork: { gap: 4 },
  contributorTitle: { color: INK, fontFamily: CONDENSED, fontSize: 15, lineHeight: 18, fontWeight: '900', borderTopWidth: 2, borderBottomWidth: 1, borderColor: INK, paddingVertical: 5, textTransform: 'uppercase' },
  contributorRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: HAIRLINE, paddingVertical: 5 },
  contributorName: { color: INK, fontFamily: SERIF, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  contributorTeam: { color: MUTED_INK, fontFamily: CONDENSED, fontSize: 10, lineHeight: 13, fontWeight: '800' },
  contributorStats: { color: INK, fontFamily: CONDENSED, fontSize: 13, lineHeight: 16, fontWeight: '900', textAlign: 'right' },
  grow: { flex: 1, minWidth: 0 },
  muted: { color: MUTED_INK, fontFamily: SERIF, fontSize: 12, lineHeight: 18 },
  starGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 8 },
  starCard: { minWidth: 140, flexGrow: 1, flexShrink: 1, flexBasis: 140, gap: 6, borderTopWidth: 2, borderBottomWidth: 1, borderColor: INK, paddingVertical: 8 },
  starRank: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: NEWSPAPER_RED },
  starRankText: { color: '#FFFFFF', fontFamily: CONDENSED, fontSize: 17, lineHeight: 20, fontWeight: '900' },
  starName: { color: INK, fontFamily: CONDENSED, fontSize: 20, lineHeight: 22, fontWeight: '900' },
  starStats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 7, borderTopWidth: 1, borderBottomWidth: 1, borderColor: HAIRLINE, paddingVertical: 5 },
  starStat: { color: INK, fontFamily: CONDENSED, fontSize: 11, lineHeight: 14, fontWeight: '800' },
  starPoints: { color: NEWSPAPER_RED, fontFamily: CONDENSED, fontSize: 14, lineHeight: 17, fontWeight: '900' },
  numbersSection: { gap: 8, borderTopWidth: 3, borderColor: INK, paddingTop: 8 },
  columnTitle: { color: INK, fontFamily: CONDENSED, fontSize: 20, lineHeight: 22, fontWeight: '900' },
  numberGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 7 },
  numberCard: { minWidth: 124, flexGrow: 1, flexShrink: 1, flexBasis: 124, borderWidth: 1, borderColor: HAIRLINE, padding: 9, gap: 4 },
  numberValue: { color: NEWSPAPER_RED, fontFamily: CONDENSED, fontSize: 30, lineHeight: 32, fontWeight: '900' },
  numberLabel: { color: INK, fontFamily: CONDENSED, fontSize: 12, lineHeight: 15, fontWeight: '900' },
  standingsTable: { borderTopWidth: 2, borderColor: INK },
  standingsHeader: { minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: INK, paddingHorizontal: 5 },
  tableHeader: { minWidth: 25, color: PAPER, fontFamily: CONDENSED, fontSize: 8, lineHeight: 10, fontWeight: '900', textAlign: 'center' },
  placeColumn: { width: 19, color: INK, fontFamily: CONDENSED, fontSize: 11, lineHeight: 14, fontWeight: '900', textAlign: 'center' },
  standingRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 5, borderBottomWidth: 1, borderColor: HAIRLINE, paddingVertical: 5, paddingHorizontal: 3 },
  standingClub: { flex: 1, minWidth: 82, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tableLogo: { width: 27, height: 27, flexShrink: 0 },
  standingName: { color: INK, fontFamily: CONDENSED, fontSize: 11, lineHeight: 14, fontWeight: '900' },
  standingGoals: { color: MUTED_INK, fontFamily: CONDENSED, fontSize: 8, lineHeight: 11, fontWeight: '700' },
  tableValue: { minWidth: 25, color: INK, fontFamily: CONDENSED, fontSize: 10, lineHeight: 13, fontWeight: '800', textAlign: 'center' },
  tableRecord: { minWidth: 46, color: INK, fontFamily: CONDENSED, fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' },
  tablePoints: { minWidth: 25, color: NEWSPAPER_RED, fontFamily: CONDENSED, fontSize: 15, lineHeight: 18, fontWeight: '900', textAlign: 'center' },
  temperatureGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 9 },
  ruledSection: { gap: 8, borderTopWidth: 3, borderColor: INK, paddingTop: 7 },
  ruledSectionColumns: { minWidth: 136, flexGrow: 1, flexShrink: 1, flexBasis: 136 },
  ruledSectionFlow: { width: '100%', flexGrow: 0, flexShrink: 0 },
  brief: { gap: 6, borderBottomWidth: 1, borderColor: HAIRLINE, paddingBottom: 9 },
  briefHeadline: { color: INK, fontFamily: CONDENSED, fontSize: 18, lineHeight: 20, fontWeight: '900' },
  upcomingList: { gap: 9 },
  upcomingCard: { gap: 5, borderTopWidth: 2, borderBottomWidth: 1, borderColor: INK, paddingVertical: 8 },
  upcomingHeadline: { color: INK, fontFamily: CONDENSED, fontSize: 21, lineHeight: 23, fontWeight: '900' },
  upcomingTeams: { color: INK, fontFamily: SERIF, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  upcomingMeta: { color: MUTED_INK, fontFamily: CONDENSED, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  sourceNotes: { gap: 7, borderTopWidth: 3, borderColor: INK, paddingTop: 8 },
  sourceMeta: { color: MUTED_INK, fontFamily: CONDENSED, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  artwork: { width: '100%', backgroundColor: colors.bgMedia },
  artFallback: { width: '100%', aspectRatio: 16 / 9, borderWidth: 1, borderColor: HAIRLINE, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDD0B7' },
  fallbackSmall: { color: INK, fontFamily: CONDENSED, fontSize: 12, lineHeight: 15, fontWeight: '900', letterSpacing: 2 },
  fallbackLarge: { color: NEWSPAPER_RED, fontFamily: CONDENSED, fontSize: 27, lineHeight: 31, fontWeight: '900', letterSpacing: 2 },
});
