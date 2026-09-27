export const NEWSPAPER_TIMEZONE = 'America/Toronto' as const;

export interface NewspaperGameInput {
  id: string;
  leagueId: string;
  seasonId: string;
  scheduledAt: string;
  status: string;
  gameType?: string | null;
  location?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: { id: string; name: string; logoUrl?: string | null };
  awayTeam: { id: string; name: string; logoUrl?: string | null };
}

export interface NewspaperGoalInput {
  id: string;
  gameId: string;
  teamId: string;
  scorerId: string | null;
  assist1Id: string | null;
  assist2Id: string | null;
}

export interface NewspaperProfileInput {
  id: string;
  name: string;
  photoUrl?: string | null;
}

export interface NewspaperStandingInput {
  teamId: string;
  name: string;
  logoUrl?: string | null;
  gp: number;
  w: number;
  l: number;
  otl: number;
  t: number;
  pts: number;
  gf: number;
  ga: number;
}

export interface ReadinessResult {
  ready: boolean;
  errors: string[];
  warnings: string[];
  completedGameIds: string[];
}

export interface NewspaperNarrativePatch {
  lead: { headline: string; dek: string; body: string[] };
  games: Array<{ gameId: string; headline: string; body: string[] }>;
}

export interface EditionShape {
  schemaVersion: 1;
  title: 'Hockey Life Times';
  issueNumber: string;
  leagueId: string;
  leagueName: string;
  seasonId: string;
  seasonName: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  timezone: 'America/Toronto';
  stage: 'regular' | 'playoffs' | 'offseason';
  status: 'draft' | 'published';
  lead: { headline: string; dek: string; body: string[]; imageUrl?: string; caption?: string };
  games: Array<{
    gameId: string;
    homeTeam: { id: string; name: string; logoUrl?: string };
    awayTeam: { id: string; name: string; logoUrl?: string };
    homeScore: number;
    awayScore: number;
    headline: string;
    body: string[];
    imageUrl?: string;
    contributors: Array<{ playerId: string; name: string; teamName: string; goals: number; assists: number; points: number }>;
  }>;
  stars: Array<{
    playerId: string;
    name: string;
    teamName: string;
    goals: number;
    assists: number;
    points: number;
    reason: string;
    photoUrl?: string;
    illustrationUrl?: string;
  }>;
  numbers: Array<{ label: string; value: string; detail?: string }>;
  standings: NewspaperStandingInput[];
  standingsNote: string;
  hot: Array<{ headline: string; body: string; imageUrl?: string }>;
  cold: Array<{ headline: string; body: string; imageUrl?: string }>;
  upcoming: Array<{
    gameId: string;
    homeName: string;
    awayName: string;
    scheduledAt: string;
    venue?: string;
    headline: string;
    body: string;
  }>;
  upcomingNote: string;
  aroundRink?: Array<{ headline: string; body: string; imageUrl?: string }>;
  source: { gameIds: string[]; verifiedAt: string; standingsAsOf?: string; factPackDigest?: string; warnings: string[] };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertLocalDate(value: string): void {
  if (!ISO_DATE.test(value)) throw new Error('Date must use YYYY-MM-DD');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Date is invalid');
  }
}

export function addLocalDays(value: string, days: number): string {
  assertLocalDate(value);
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function torontoCivilDate(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error('Generation timestamp is invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NEWSPAPER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function assertCanonicalWeek(periodStart: string, periodEnd: string): void {
  assertLocalDate(periodStart);
  assertLocalDate(periodEnd);
  if (new Date(`${periodStart}T12:00:00Z`).getUTCDay() !== 1) {
    throw new Error('Covered week must start on Monday in America/Toronto');
  }
  if (periodEnd !== addLocalDays(periodStart, 6)) {
    throw new Error('Covered week must end on the Sunday six days after its Monday start');
  }
}

function zonedDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: NEWSPAPER_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
  );
  return values as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

export function torontoMidnightUtc(localDate: string): string {
  assertLocalDate(localDate);
  const [year, month, day] = localDate.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedDateParts(new Date(guess));
    const displayedAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desired - displayedAsUtc;
  }
  return new Date(guess).toISOString();
}

export function periodUtcBounds(periodStart: string, periodEnd: string) {
  assertCanonicalWeek(periodStart, periodEnd);
  return {
    fromInclusive: torontoMidnightUtc(periodStart),
    toExclusive: torontoMidnightUtc(addLocalDays(periodEnd, 1)),
  };
}

export function confirmedNextWeekFixtures(
  periodStart: string,
  periodEnd: string,
  games: NewspaperGameInput[],
): NewspaperGameInput[] {
  const next = periodUtcBounds(addLocalDays(periodStart, 7), addLocalDays(periodEnd, 7));
  const from = Date.parse(next.fromInclusive);
  const to = Date.parse(next.toExclusive);
  return games.filter((game) => {
    const scheduled = Date.parse(game.scheduledAt);
    return game.status === 'scheduled' && Number.isFinite(scheduled) && scheduled >= from && scheduled < to;
  });
}

function narrativeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  return normalized;
}

function narrativeBody(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 6) {
    throw new Error(`${label} must contain between one and six paragraphs`);
  }
  return value.map((paragraph, index) => narrativeText(paragraph, `${label} paragraph ${index + 1}`, 1200));
}

export function applyNarrativePatch(
  edition: EditionShape,
  patch: NewspaperNarrativePatch,
): EditionShape {
  const patchByGame = new Map<string, NewspaperNarrativePatch['games'][number]>();
  for (const game of patch.games) {
    if (patchByGame.has(game.gameId)) throw new Error(`Duplicate narrative game ${game.gameId}`);
    patchByGame.set(game.gameId, game);
  }
  const currentGameIds = new Set(edition.games.map((game) => game.gameId));
  if (patchByGame.size !== currentGameIds.size || [...patchByGame.keys()].some((id) => !currentGameIds.has(id))) {
    throw new Error('Narrative game IDs must exactly match the draft source games');
  }

  return {
    ...edition,
    lead: {
      ...edition.lead,
      headline: narrativeText(patch.lead.headline, 'Lead headline', 180),
      dek: narrativeText(patch.lead.dek, 'Lead dek', 320),
      body: narrativeBody(patch.lead.body, 'Lead body'),
    },
    games: edition.games.map((game) => {
      const narrative = patchByGame.get(game.gameId)!;
      return {
        ...game,
        headline: narrativeText(narrative.headline, `${game.gameId} headline`, 180),
        body: narrativeBody(narrative.body, `${game.gameId} body`),
      };
    }),
  };
}

export function assessReadiness(
  games: NewspaperGameInput[],
  leagueId: string,
  seasonId: string,
): ReadinessResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (games.length === 0) errors.push('No games are scheduled in the selected period.');
  if (games.length > 2) errors.push('The canonical Monday-Sunday week contains more than two completed games, which exceeds the five-page newspaper contract.');
  const gameStages = new Set(games.map((game) => game.gameType === 'playoff' ? 'playoffs' : 'regular'));
  if (gameStages.size > 1) errors.push('The canonical Monday-Sunday week mixes regular-season and playoff games, so it cannot produce one truthful edition.');

  const seen = new Set<string>();
  for (const game of games) {
    if (seen.has(game.id)) errors.push(`Game ${game.id} appears more than once.`);
    seen.add(game.id);
    if (game.leagueId !== leagueId) errors.push(`Game ${game.id} belongs to another league.`);
    if (game.seasonId !== seasonId) errors.push(`Game ${game.id} belongs to another season.`);
    if (game.status !== 'completed') errors.push(`${game.awayTeam.name} at ${game.homeTeam.name} is not finalized.`);
    if (!Number.isInteger(game.homeScore) || !Number.isInteger(game.awayScore) || (game.homeScore ?? -1) < 0 || (game.awayScore ?? -1) < 0) {
      errors.push(`${game.awayTeam.name} at ${game.homeTeam.name} is missing a valid final score.`);
    }
  }
  if (games.length > 0 && games.every((game) => game.status === 'completed' && game.homeScore === 0 && game.awayScore === 0)) {
    errors.push('All games in this week finished 0-0; scoring-based Three Stars are unavailable.');
  }

  return {
    ready: errors.length === 0,
    errors,
    warnings,
    completedGameIds: errors.length === 0 ? games.map((game) => game.id) : [],
  };
}

interface ContributorAggregate {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  goals: number;
  assists: number;
  points: number;
  photoUrl?: string;
}

export function reconcileGameContributors(
  game: NewspaperGameInput,
  goalRows: NewspaperGoalInput[],
  profiles: Map<string, NewspaperProfileInput>,
): { contributors: ContributorAggregate[]; warnings: string[]; uncredited: Record<string, number> } {
  const expected = new Map<string, number>([
    [game.homeTeam.id, game.homeScore ?? 0],
    [game.awayTeam.id, game.awayScore ?? 0],
  ]);
  const recorded = new Map<string, number>([[game.homeTeam.id, 0], [game.awayTeam.id, 0]]);
  const contributors = new Map<string, ContributorAggregate>();

  const teamName = (teamId: string) => teamId === game.homeTeam.id ? game.homeTeam.name : game.awayTeam.name;
  const ensure = (playerId: string, teamId: string) => {
    const key = `${teamId}:${playerId}`;
    if (!contributors.has(key)) {
      const profile = profiles.get(playerId);
      if (!profile?.name?.trim()) {
        throw new Error(`Player identity ${playerId} is unresolved; review the scoresheet before generating.`);
      }
      contributors.set(key, {
        playerId,
        name: profile.name.trim(),
        teamId,
        teamName: teamName(teamId),
        goals: 0,
        assists: 0,
        points: 0,
        photoUrl: profile?.photoUrl || undefined,
      });
    }
    return contributors.get(key)!;
  };

  const seenGoals = new Set<string>();
  for (const goal of goalRows) {
    if (goal.gameId !== game.id || seenGoals.has(goal.id)) continue;
    seenGoals.add(goal.id);
    if (!expected.has(goal.teamId)) throw new Error(`Goal ${goal.id} belongs to a team outside game ${game.id}.`);
    recorded.set(goal.teamId, (recorded.get(goal.teamId) || 0) + 1);
    if (goal.scorerId) ensure(goal.scorerId, goal.teamId).goals += 1;
    const uniqueAssists = new Set([goal.assist1Id, goal.assist2Id].filter((id): id is string => Boolean(id)));
    if (goal.scorerId) uniqueAssists.delete(goal.scorerId);
    for (const assistId of uniqueAssists) ensure(assistId, goal.teamId).assists += 1;
  }

  const warnings: string[] = [];
  const uncredited: Record<string, number> = {};
  for (const [teamId, score] of expected) {
    const goalCount = recorded.get(teamId) || 0;
    if (goalCount > score) throw new Error(`Recorded goals exceed the final score for ${teamName(teamId)}.`);
    uncredited[teamId] = score - goalCount;
    if (uncredited[teamId] > 0) {
      warnings.push(`${teamName(teamId)} has ${uncredited[teamId]} uncredited team goal${uncredited[teamId] === 1 ? '' : 's'}; player attribution was omitted.`);
    }
  }

  const result = [...contributors.values()].map((entry) => ({ ...entry, points: entry.goals + entry.assists }));
  result.sort((left, right) => right.points - left.points || right.goals - left.goals || left.name.localeCompare(right.name));
  return { contributors: result, warnings, uncredited };
}

function resultSentence(game: NewspaperGameInput) {
  const homeWon = (game.homeScore ?? 0) > (game.awayScore ?? 0);
  const awayWon = (game.awayScore ?? 0) > (game.homeScore ?? 0);
  if (!homeWon && !awayWon) return `${game.homeTeam.name} and ${game.awayTeam.name} finished level at ${game.homeScore}-${game.awayScore}.`;
  const winner = homeWon ? game.homeTeam.name : game.awayTeam.name;
  const loser = homeWon ? game.awayTeam.name : game.homeTeam.name;
  const winnerScore = homeWon ? game.homeScore : game.awayScore;
  const loserScore = homeWon ? game.awayScore : game.homeScore;
  return `${winner} beat ${loser} ${winnerScore}-${loserScore}.`;
}

export function buildDeterministicEdition(input: {
  issueNumber: number;
  leagueId: string;
  leagueName: string;
  seasonId: string;
  seasonName: string;
  seasonStatus: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  games: NewspaperGameInput[];
  goals: NewspaperGoalInput[];
  profiles: NewspaperProfileInput[];
  standings: NewspaperStandingInput[];
  upcoming: NewspaperGameInput[];
  factPackDigest?: string;
}): EditionShape {
  const readiness = assessReadiness(input.games, input.leagueId, input.seasonId);
  if (!readiness.ready) throw new Error(readiness.errors.join(' '));
  if (input.games.length > 2) throw new Error('The canonical Monday-Sunday week exceeds the five-page newspaper contract.');
  const profileMap = new Map(input.profiles.map((profile) => [profile.id, profile]));
  const warnings: string[] = [];
  const allContributors: ContributorAggregate[] = [];

  const games = input.games.map((game) => {
    const reconciled = reconcileGameContributors(
      game,
      input.goals.filter((goal) => goal.gameId === game.id),
      profileMap,
    );
    warnings.push(...reconciled.warnings);
    allContributors.push(...reconciled.contributors);
    const scoreGap = Math.abs((game.homeScore ?? 0) - (game.awayScore ?? 0));
    const tied = game.homeScore === game.awayScore;
    const winner = (game.homeScore ?? 0) > (game.awayScore ?? 0) ? game.homeTeam.name : game.awayTeam.name;
    const headline = tied
      ? `${game.homeTeam.name} and ${game.awayTeam.name} Finish Level and Leave the Tape Bill`
      : scoreGap >= 4
        ? `${winner} Turns the Scoreboard Into a Complaint Form`
        : `${winner} Takes the Points and Leaves the Tape Bill`;
    const credited = reconciled.contributors.filter((entry) => entry.points > 0);
    const attribution = credited.length
      ? `The verified scoresheet credits ${credited.slice(0, 4).map((entry) => `${entry.name} (${entry.goals}G, ${entry.assists}A)`).join('; ')}.`
      : 'The final score is verified, but the available source does not support named scoring attribution.';
    return {
      gameId: game.id,
      homeTeam: { id: game.homeTeam.id, name: game.homeTeam.name, logoUrl: game.homeTeam.logoUrl || undefined },
      awayTeam: { id: game.awayTeam.id, name: game.awayTeam.name, logoUrl: game.awayTeam.logoUrl || undefined },
      homeScore: game.homeScore!,
      awayScore: game.awayScore!,
      headline,
      body: [
        resultSentence(game),
        scoreGap >= 4
          ? `A ${scoreGap}-goal margin is not a defensive system; it is an open invitation with free parking.`
          : 'The margin stayed tight enough that every missed clearance came with its own tiny courtroom drama.',
        attribution,
      ],
      contributors: credited.slice(0, 5).map(({ playerId, name, teamName, goals, assists, points }) => ({ playerId, name, teamName, goals, assists, points })),
    };
  });

  const weekly = new Map<string, ContributorAggregate>();
  for (const player of allContributors) {
    const current = weekly.get(player.playerId) || { ...player, goals: 0, assists: 0, points: 0 };
    current.goals += player.goals;
    current.assists += player.assists;
    current.points = current.goals + current.assists;
    weekly.set(player.playerId, current);
  }
  const leaders = [...weekly.values()].sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name));
  if (leaders.length < 3) {
    throw new Error('At least three players with verified scoring attribution are required for the Three Stars section.');
  }
  if (input.standings.length === 0) {
    throw new Error('Canonical season standings are unavailable for the required Standings section.');
  }
  const stars = leaders.slice(0, 3).map((leader) => ({
    playerId: leader.playerId,
    name: leader.name,
    teamName: leader.teamName,
    goals: leader.goals,
    assists: leader.assists,
    points: leader.points,
    reason: `${leader.points} verified point${leader.points === 1 ? '' : 's'} across the covered games (${leader.goals} goals, ${leader.assists} assists).`,
    photoUrl: leader.photoUrl,
  }));
  if (stars.length < 3) warnings.push('Fewer than three players had verified scoring contributions; the Three Stars section contains only supported selections.');

  const totalGoals = input.games.reduce((sum, game) => sum + game.homeScore! + game.awayScore!, 0);
  const biggestMargin = Math.max(...input.games.map((game) => Math.abs(game.homeScore! - game.awayScore!)));
  const hottest = input.standings[0];
  const coldest = input.standings[input.standings.length - 1];
  const stage = input.games.every((game) => game.gameType === 'playoff')
    ? 'playoffs'
    : input.games.length > 0
      ? 'regular'
      : 'offseason';
  const leadGame = [...input.games].sort((a, b) => Math.abs(b.homeScore! - b.awayScore!) - Math.abs(a.homeScore! - a.awayScore!))[0];

  return {
    schemaVersion: 1,
    title: 'Hockey Life Times',
    issueNumber: String(input.issueNumber),
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    seasonId: input.seasonId,
    seasonName: input.seasonName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    issuedAt: input.issuedAt,
    timezone: NEWSPAPER_TIMEZONE,
    stage,
    status: 'draft',
    lead: {
      headline: leadGame ? `${resultSentence(leadGame).replace(/\.$/, '')} — and the Group Chat Will Hear About It` : 'The Week the Ice Kept Receipts',
      dek: `${input.games.length} finalized game${input.games.length === 1 ? '' : 's'}, ${totalGoals} verified goals, and no mercy from the standings table.`,
      body: [
        `Hockey Life closed the books on ${input.games.length} game${input.games.length === 1 ? '' : 's'} from ${input.periodStart} through ${input.periodEnd}. Every score below comes from the finalized game record.`,
        biggestMargin >= 4
          ? `The widest gap was ${biggestMargin} goals, which is less a margin than a request for somebody to locate the backcheck.`
          : `The widest gap was ${biggestMargin} goal${biggestMargin === 1 ? '' : 's'}, keeping the benches interested and the excuses highly specific.`,
      ],
    },
    games,
    stars,
    numbers: [
      { label: 'Finalized games', value: String(input.games.length), detail: 'All games in the selected period were checked before generation.' },
      { label: 'Goals', value: String(totalGoals), detail: 'Combined final-score total.' },
      { label: 'Biggest margin', value: String(biggestMargin), detail: 'Calculated from verified final scores.' },
    ],
    standings: input.standings.slice(0, 14),
    standingsNote: stage === 'playoffs'
      ? 'Season standings are shown for context; playoff results are covered as playoff games, not folded into a fictional regular-season table.'
      : stage === 'offseason'
        ? 'The season is not active; these are the canonical final season standings.'
        : 'Canonical season standings at generation time.',
    hot: hottest ? [{ headline: `${hottest.name} Owns the Top Line`, body: `${hottest.pts} points through ${hottest.gp} games. The standings do not award style points, which is convenient because they already have the real ones.` }] : [],
    cold: coldest ? [{ headline: `${coldest.name} Has Located the Basement`, body: `${coldest.pts} points with ${coldest.ga} goals against. The thermostat works; the defensive coverage may need a service call.` }] : [],
    upcoming: input.upcoming.slice(0, 4).map((game) => ({
      gameId: game.id,
      homeName: game.homeTeam.name,
      awayName: game.awayTeam.name,
      scheduledAt: game.scheduledAt,
      venue: game.location || undefined,
      headline: `${game.awayTeam.name} at ${game.homeTeam.name}`,
      body: 'Scheduled matchup. No result, attendance, or performance claim is made before the puck drops.',
    })),
    upcomingNote: input.upcoming.length
      ? 'Fixtures shown are the next scheduled games in this season after the covered period.'
      : 'No future fixtures are currently published for this season. The schedule, not our imagination, gets the last word.',
    source: {
      gameIds: input.games.map((game) => game.id),
      verifiedAt: input.issuedAt,
      standingsAsOf: torontoCivilDate(input.issuedAt),
      factPackDigest: input.factPackDigest,
      warnings,
    },
  };
}

export function editionToArticleFallback(edition: EditionShape): string {
  const lines = [
    edition.lead.headline,
    edition.lead.dek,
    ...edition.lead.body,
    'THIS WEEK ON THE ICE',
    ...edition.games.flatMap((game) => [
      `${game.awayTeam.name} ${game.awayScore}, ${game.homeTeam.name} ${game.homeScore}`,
      game.headline,
      ...game.body,
    ]),
    'THREE STARS OF THE WEEK',
    ...(edition.stars.length ? edition.stars.map((star, index) => `${index + 1}. ${star.name}, ${star.teamName}: ${star.reason}`) : ['No unsupported selections were added.']),
    'THIS WEEK BY THE NUMBERS',
    ...edition.numbers.map((number) => `${number.label}: ${number.value}${number.detail ? ` — ${number.detail}` : ''}`),
    'STANDINGS',
    ...edition.standings.map((team) => `${team.name}: ${team.gp} GP, ${team.w}-${team.l}-${team.otl}-${team.t}, ${team.pts} PTS, ${team.gf} GF, ${team.ga} GA`),
    edition.standingsNote,
    'THE HEATER',
    ...(edition.hot.length ? edition.hot.map((item) => `${item.headline}: ${item.body}`) : ['No supported heater item was available.']),
    'THE COLD TUB',
    ...(edition.cold.length ? edition.cold.map((item) => `${item.headline}: ${item.body}`) : ['No supported cold-tub item was available.']),
    'NEXT WEEK HEADLINES',
    ...(edition.upcoming.length ? edition.upcoming.map((item) => `${item.headline}: ${item.body}`) : [edition.upcomingNote]),
  ];
  return lines.filter(Boolean).join('\n\n');
}

export function isNewspaperEdition(value: unknown): value is EditionShape {
  if (!value || typeof value !== 'object') return false;
  const edition = value as Partial<EditionShape>;
  return edition.schemaVersion === 1
    && edition.title === 'Hockey Life Times'
    && edition.timezone === NEWSPAPER_TIMEZONE
    && (edition.status === 'draft' || edition.status === 'published')
    && Array.isArray(edition.games)
    && Array.isArray(edition.stars)
    && Array.isArray(edition.numbers)
    && Array.isArray(edition.standings)
    && Array.isArray(edition.upcoming)
    && Boolean(edition.source && Array.isArray(edition.source.gameIds));
}
