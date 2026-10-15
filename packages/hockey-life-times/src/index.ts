export interface NewspaperTeam {
  id: string;
  name: string;
  logoUrl?: string;
}

export interface NewspaperContributor {
  playerId: string;
  name: string;
  teamName: string;
  goals: number;
  assists: number;
  points: number;
}

export interface NewspaperGame {
  gameId: string;
  homeTeam: NewspaperTeam;
  awayTeam: NewspaperTeam;
  homeScore: number;
  awayScore: number;
  headline: string;
  body: string[];
  imageUrl?: string;
  contributors: NewspaperContributor[];
}

export interface NewspaperStar {
  playerId: string;
  name: string;
  teamName: string;
  goals: number;
  assists: number;
  points: number;
  reason: string;
  photoUrl?: string;
  illustrationUrl?: string;
}

export interface NewspaperNumber {
  label: string;
  value: string;
  detail?: string;
}

export interface NewspaperStanding {
  teamId: string;
  name: string;
  logoUrl?: string;
  gp: number;
  w: number;
  l: number;
  otl: number;
  t: number;
  pts: number;
  gf: number;
  ga: number;
}

export interface NewspaperBrief {
  headline: string;
  body: string;
  imageUrl?: string;
}

export interface NewspaperUpcoming {
  gameId: string;
  homeName: string;
  awayName: string;
  scheduledAt: string;
  venue?: string;
  headline: string;
  body: string;
  line?: string;
  pick?: string;
  bodyParagraphs?: string[];
}

export interface NewspaperEdition {
  schemaVersion: 1;
  title: 'Hockey Life Times';
  issueNumber: string | number;
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
  lead: {
    headline: string;
    dek: string;
    body: string[];
    imageUrl?: string;
    caption?: string;
  };
  games: NewspaperGame[];
  stars: NewspaperStar[];
  numbers: NewspaperNumber[];
  standings: NewspaperStanding[];
  standingsNote: string;
  hot: NewspaperBrief[];
  cold: NewspaperBrief[];
  upcoming: NewspaperUpcoming[];
  upcomingNote: string;
  editorial?: {
    standings?: { headline: string; body: string[] };
    upcoming?: { heading: string };
    sourceNote?: string[];
  };
  aroundRink?: NewspaperBrief[];
  source: {
    gameIds: string[];
    verifiedAt: string;
    standingsAsOf?: string;
    factPackDigest?: string;
    warnings: string[];
  };
}

const PAGE_COUNT = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function escapeHtml(value: unknown): string {
  return normalizeDashes(String(value ?? ''))
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeDashes(value: string): string {
  return value.replace(/[\u2010-\u2015\u2212]/g, '-');
}

function safeImageUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const candidate = value.trim();
  if (/^(https?:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,|blob:|file:\/\/|\/)/i.test(candidate)) {
    return escapeHtml(candidate);
  }
  return undefined;
}

function image(value: string | undefined, alt: string, className = ''): string {
  const src = safeImageUrl(value);
  return src
    ? `<img class="${escapeHtml(className)}" src="${src}" alt="${escapeHtml(alt)}" loading="eager" decoding="sync">`
    : `<div class="art-placeholder ${escapeHtml(className)}" role="img" aria-label="${escapeHtml(`${alt}; artwork not supplied`)}"><span>Hockey Life</span><b>Times</b></div>`;
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
}

function assertString(value: unknown, path: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`${path} must be a non-empty string`);
}

function assertNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
}

function assertStringArray(value: unknown, path: string, allowEmpty = true): asserts value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${path} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  value.forEach((item, index) => assertString(item, `${path}[${index}]`));
}

function assertKnownKeys(value: Record<string, unknown>, path: string, keys: string[]): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) throw new Error(`${path} contains unknown key ${unknown}`);
}

function validateBriefs(value: unknown, path: string, max = 3): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > max) throw new Error(`${path} supports at most ${max} render-ready items`);
  value.forEach((entry, index) => {
    assertRecord(entry, `${path}[${index}]`);
    assertString(entry.headline, `${path}[${index}].headline`);
    assertString(entry.body, `${path}[${index}].body`);
  });
}

/** Throws a path-specific error. Rendering never silently fills required editorial facts. */
export function validateNewspaperEdition(input: unknown): asserts input is NewspaperEdition {
  assertRecord(input, 'edition');
  if (input.schemaVersion !== 1) throw new Error('edition.schemaVersion must equal 1');
  if (input.title !== 'Hockey Life Times') throw new Error('edition.title must equal "Hockey Life Times"');
  if (!((typeof input.issueNumber === 'string' && input.issueNumber.trim()) || (typeof input.issueNumber === 'number' && Number.isFinite(input.issueNumber)))) {
    throw new Error('edition.issueNumber must be a non-empty string or finite number');
  }
  ['leagueId', 'leagueName', 'seasonId', 'seasonName', 'issuedAt'].forEach((key) => assertString(input[key], `edition.${key}`));
  ['periodStart', 'periodEnd'].forEach((key) => {
    assertString(input[key], `edition.${key}`);
    if (!DATE_RE.test(input[key] as string)) throw new Error(`edition.${key} must use local YYYY-MM-DD`);
  });
  if (input.timezone !== 'America/Toronto') throw new Error('edition.timezone must equal "America/Toronto"');
  if (!['regular', 'playoffs', 'offseason'].includes(input.stage as string)) throw new Error('edition.stage is invalid');
  if (!['draft', 'published'].includes(input.status as string)) throw new Error('edition.status is invalid');

  assertRecord(input.lead, 'edition.lead');
  assertString(input.lead.headline, 'edition.lead.headline');
  assertString(input.lead.dek, 'edition.lead.dek');
  assertStringArray(input.lead.body, 'edition.lead.body', false);

  if (!Array.isArray(input.games) || input.games.length === 0) throw new Error('edition.games must contain at least one completed game');
  if (input.games.length > 2) throw new Error('edition.games supports at most 2 completed games per issue');
  input.games.forEach((game, index) => {
    const p = `edition.games[${index}]`;
    assertRecord(game, p);
    assertString(game.gameId, `${p}.gameId`);
    ['homeTeam', 'awayTeam'].forEach((side) => {
      assertRecord(game[side], `${p}.${side}`);
      assertString(game[side].id, `${p}.${side}.id`);
      assertString(game[side].name, `${p}.${side}.name`);
    });
    assertNumber(game.homeScore, `${p}.homeScore`);
    assertNumber(game.awayScore, `${p}.awayScore`);
    assertString(game.headline, `${p}.headline`);
    assertStringArray(game.body, `${p}.body`, false);
    if (!Array.isArray(game.contributors)) throw new Error(`${p}.contributors must be an array`);
    game.contributors.forEach((player, pi) => {
      assertRecord(player, `${p}.contributors[${pi}]`);
      ['playerId', 'name', 'teamName'].forEach((key) => assertString(player[key], `${p}.contributors[${pi}].${key}`));
      ['goals', 'assists', 'points'].forEach((key) => assertNumber(player[key], `${p}.contributors[${pi}].${key}`));
    });
  });

  if (!Array.isArray(input.stars) || input.stars.length !== 3) throw new Error('edition.stars must contain exactly 3 stars');
  input.stars.forEach((star, index) => {
    assertRecord(star, `edition.stars[${index}]`);
    ['playerId', 'name', 'teamName', 'reason'].forEach((key) => assertString(star[key], `edition.stars[${index}].${key}`));
    ['goals', 'assists', 'points'].forEach((key) => assertNumber(star[key], `edition.stars[${index}].${key}`));
  });

  if (!Array.isArray(input.numbers) || input.numbers.length === 0) throw new Error('edition.numbers must contain at least one item');
  if (input.numbers.length > 10) throw new Error('edition.numbers supports at most 10 render-ready items');
  input.numbers.forEach((item, index) => {
    assertRecord(item, `edition.numbers[${index}]`);
    assertString(item.label, `edition.numbers[${index}].label`);
    assertString(item.value, `edition.numbers[${index}].value`);
  });

  if (!Array.isArray(input.standings) || input.standings.length === 0) throw new Error('edition.standings must contain at least one team');
  if (input.standings.length > 14) throw new Error('edition.standings supports at most 14 teams per issue');
  input.standings.forEach((row, index) => {
    assertRecord(row, `edition.standings[${index}]`);
    ['teamId', 'name'].forEach((key) => assertString(row[key], `edition.standings[${index}].${key}`));
    ['gp', 'w', 'l', 'otl', 't', 'pts', 'gf', 'ga'].forEach((key) => assertNumber(row[key], `edition.standings[${index}].${key}`));
  });
  assertString(input.standingsNote, 'edition.standingsNote', true);
  validateBriefs(input.hot, 'edition.hot');
  validateBriefs(input.cold, 'edition.cold');

  if (!Array.isArray(input.upcoming)) throw new Error('edition.upcoming must be an array');
  if (input.upcoming.length > 4) throw new Error('edition.upcoming supports at most 4 fixtures per issue');
  input.upcoming.forEach((game, index) => {
    assertRecord(game, `edition.upcoming[${index}]`);
    ['gameId', 'homeName', 'awayName', 'scheduledAt', 'headline', 'body'].forEach((key) => assertString(game[key], `edition.upcoming[${index}].${key}`));
    if (game.line !== undefined) assertString(game.line, `edition.upcoming[${index}].line`);
    if (game.pick !== undefined) assertString(game.pick, `edition.upcoming[${index}].pick`);
    if (game.bodyParagraphs !== undefined) assertStringArray(game.bodyParagraphs, `edition.upcoming[${index}].bodyParagraphs`, false);
  });
  assertString(input.upcomingNote, 'edition.upcomingNote', true);
  if (input.upcoming.length === 0 && !input.upcomingNote.trim()) throw new Error('edition.upcomingNote is required when no upcoming fixtures are scheduled');
  if (input.aroundRink !== undefined) {
    validateBriefs(input.aroundRink, 'edition.aroundRink', 4);
  }
  if (input.editorial !== undefined) {
    assertRecord(input.editorial, 'edition.editorial');
    assertKnownKeys(input.editorial, 'edition.editorial', ['standings', 'upcoming', 'sourceNote']);
    if (input.editorial.standings !== undefined) {
      assertRecord(input.editorial.standings, 'edition.editorial.standings');
      assertKnownKeys(input.editorial.standings, 'edition.editorial.standings', ['headline', 'body']);
      assertString(input.editorial.standings.headline, 'edition.editorial.standings.headline');
      assertStringArray(input.editorial.standings.body, 'edition.editorial.standings.body', false);
    }
    if (input.editorial.upcoming !== undefined) {
      assertRecord(input.editorial.upcoming, 'edition.editorial.upcoming');
      assertKnownKeys(input.editorial.upcoming, 'edition.editorial.upcoming', ['heading']);
      assertString(input.editorial.upcoming.heading, 'edition.editorial.upcoming.heading');
    }
    if (input.editorial.sourceNote !== undefined) assertStringArray(input.editorial.sourceNote, 'edition.editorial.sourceNote', false);
  }

  assertRecord(input.source, 'edition.source');
  assertStringArray(input.source.gameIds, 'edition.source.gameIds', false);
  assertString(input.source.verifiedAt, 'edition.source.verifiedAt');
  if (input.source.standingsAsOf !== undefined) {
    assertString(input.source.standingsAsOf, 'edition.source.standingsAsOf');
    if (!DATE_RE.test(input.source.standingsAsOf)) throw new Error('edition.source.standingsAsOf must use YYYY-MM-DD');
  }
  assertStringArray(input.source.warnings, 'edition.source.warnings');
}

function paragraphs(lines: string[], className = ''): string {
  return lines.map((line) => `<p class="${className}">${escapeHtml(line)}</p>`).join('');
}

function readerNumbers(edition: NewspaperEdition): NewspaperNumber[] {
  return edition.numbers.filter((item) => !/\b(?:source\s+warnings?|warning\s+count)\b/i.test(item.label));
}

function pageHeader(edition: NewspaperEdition, kicker: string): string {
  return `<header class="paper-header">
    <div class="folio-top"><span>Issue ${escapeHtml(edition.issueNumber)}</span><b>${escapeHtml(kicker)}</b><span>${escapeHtml(edition.periodStart)} - ${escapeHtml(edition.periodEnd)}</span></div>
    <div class="masthead"><span class="puck-mark" aria-hidden="true">●</span><div><div class="mast-title">Hockey Life Times</div><div class="mast-deck">Beer league news · frozen facts · hot takes</div></div><span class="league-mark">${escapeHtml(edition.leagueName)}<small>${escapeHtml(edition.seasonName)}</small></span></div>
    <div class="section-strip">THE WEEK ON ICE <i></i> STARS &amp; SCARS <i></i> NUMBERS THAT HURT <i></i> AROUND THE RINK</div>
  </header>`;
}

function pageFooter(edition: NewspaperEdition, page: number): string {
  return `<footer class="paper-footer"><span>Hockey Life Times</span><span>${escapeHtml(edition.leagueName)} · ${escapeHtml(edition.seasonName)}</span><b>Page ${page} of ${PAGE_COUNT}</b></footer>`;
}

function shell(edition: NewspaperEdition, page: number, kicker: string, body: string): string {
  return `<section class="newspaper-page page-${page}" data-newspaper-page="${page}" aria-label="Page ${page} of ${PAGE_COUNT}">${pageHeader(edition, kicker)}<main>${body}</main>${pageFooter(edition, page)}</section>`;
}

function scoreline(game: NewspaperGame): string {
  return `<div class="scoreline"><div>${image(game.awayTeam.logoUrl, `${game.awayTeam.name} logo`, 'team-logo')}<span>${escapeHtml(game.awayTeam.name)}</span><b>${game.awayScore}</b></div><em>FINAL</em><div>${image(game.homeTeam.logoUrl, `${game.homeTeam.name} logo`, 'team-logo')}<span>${escapeHtml(game.homeTeam.name)}</span><b>${game.homeScore}</b></div></div>`;
}

function leadPage(edition: NewspaperEdition): string {
  const teasers = edition.games.slice(0, 2).map((game) => `<article class="teaser"><span>Inside · Game report</span><h3>${escapeHtml(game.headline)}</h3>${scoreline(game)}</article>`).join('');
  return shell(edition, 1, 'The league’s independent record', `
    ${edition.status === 'draft' ? '<div class="draft-flag">Draft preview · not published</div>' : ''}
    <div class="front-head"><span>Extra</span><h1>${escapeHtml(edition.lead.headline)}</h1><p>${escapeHtml(edition.lead.dek)}</p></div>
    <div class="lead-grid">
      <figure class="lead-art">${image(edition.lead.imageUrl, edition.lead.headline)}${edition.lead.caption ? `<figcaption>${escapeHtml(edition.lead.caption)}</figcaption>` : ''}</figure>
      <article class="lead-copy"><div class="story-label">The big story</div>${paragraphs(edition.lead.body, 'dropcap')}</article>
    </div>
    <div class="front-teasers">${teasers}<aside><b>In this issue</b><ol><li>Both games, fully accounted for</li><li>Three stars and the week in numbers</li><li>The heater, the cold tub, and the table</li><li>Next week - or an honest lack thereof</li></ol></aside></div>
  `);
}

function gameReport(game: NewspaperGame, index: number): string {
  const densityClass = game.contributors.length > 12 ? ' game-report--dense' : '';
  const contributors = game.contributors.length
    ? game.contributors.map((p) => `<li><span>${escapeHtml(p.name)}</span><small>${escapeHtml(p.teamName)}</small><b>${p.goals}G · ${p.assists}A · ${p.points}P</b></li>`).join('')
    : '<li class="none-recorded">No individual contributors were supplied.</li>';
  return `<article class="game-report${densityClass}"><div class="game-no">Game ${index + 1}</div><h2>${escapeHtml(game.headline)}</h2>${scoreline(game)}<div class="game-columns"><div>${paragraphs(game.body)}</div><figure>${image(game.imageUrl, game.headline)}<figcaption>From the rink report</figcaption></figure></div><div class="contributors"><h3>Names on the scoresheet</h3><ol>${contributors}</ol></div></article>`;
}

function gamesPage(edition: NewspaperEdition): string {
  return shell(edition, 2, 'Scores, stories & consequences', `<div class="section-title"><span>Final buzzer edition</span><h1>This Week on the Ice</h1><p>${edition.games.length} completed game${edition.games.length === 1 ? '' : 's'}. The scoreboard gets the final word.</p></div><div class="games-grid games-${edition.games.length}">${edition.games.map(gameReport).join('')}</div>`);
}

function starsPage(edition: NewspaperEdition): string {
  const stars = edition.stars.map((star, i) => `<article class="star"><div class="star-rank">${i + 1}</div><figure>${image(star.illustrationUrl || star.photoUrl, `${star.name}, ${star.teamName}`)}</figure><div class="star-copy"><span>${escapeHtml(star.teamName)}</span><h2>${escapeHtml(star.name)}</h2><div class="statline"><b>${star.goals}</b> ${star.goals === 1 ? 'goal' : 'goals'} <b>${star.assists}</b> ${star.assists === 1 ? 'assist' : 'assists'} <strong>${star.points} ${star.points === 1 ? 'point' : 'points'}</strong></div><p>${escapeHtml(star.reason)}</p></div></article>`).join('');
  const numbers = readerNumbers(edition).map((item) => `<article class="${item.value.length > 10 ? 'number-long' : ''}"><b>${escapeHtml(item.value)}</b><h3>${escapeHtml(item.label)}</h3>${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ''}</article>`).join('');
  return shell(edition, 3, 'Performance deserves ink', `<div class="section-title compact"><span>The podium</span><h1>Three Stars of the Week</h1><p>The Times’ editorial picks from this week’s scoresheets.</p></div><div class="stars-grid">${stars}</div><div class="numbers-band"><div class="band-title"><i></i><h2>This Week by the Numbers</h2><i></i></div><div class="numbers-grid">${numbers}</div></div>`);
}

function standingsRows(edition: NewspaperEdition): string {
  return edition.standings.map((row, i) => `<tr><td>${i + 1}</td><th>${image(row.logoUrl, `${row.name} logo`, 'mini-logo')}<span>${escapeHtml(row.name)}</span></th><td>${row.gp}</td><td>${row.w}</td><td>${row.l}</td><td>${row.otl}</td><td>${row.t}</td><td><b>${row.pts}</b></td><td>${row.gf}</td><td>${row.ga}</td></tr>`).join('');
}

function temperatureStories(items: NewspaperBrief[], kind: 'hot' | 'cold'): string {
  if (!items.length) return `<p class="none-recorded">No ${kind === 'hot' ? 'heater' : 'cold tub'} item was supplied.</p>`;
  return items.map((item) => `<article${item.imageUrl ? '' : ' style="display:block"'}>${item.imageUrl ? image(item.imageUrl, item.headline) : ''}<div><h3>${escapeHtml(item.headline)}</h3><p>${escapeHtml(item.body)}</p></div></article>`).join('');
}

function standingsAnalysis(edition: NewspaperEdition): string {
  if (edition.editorial?.standings) {
    return `<section class="standings-analysis standings-analysis--editorial"><div class="analysis-label">Reading the table</div><article class="standings-context"><h3>${escapeHtml(edition.editorial.standings.headline)}</h3>${paragraphs(edition.editorial.standings.body)}</article></section>`;
  }
  const topPoints = Math.max(...edition.standings.map((row) => row.pts));
  const leaders = edition.standings.filter((row) => row.pts === topPoints);
  const topGoals = Math.max(...edition.standings.map((row) => row.gf));
  const topAttack = edition.standings.filter((row) => row.gf === topGoals);
  const fewestAgainst = Math.min(...edition.standings.map((row) => row.ga));
  const tightestDefence = edition.standings.filter((row) => row.ga === fewestAgainst);
  const leaderNames = leaders.map((row) => row.name).join(' / ');
  const attackNames = topAttack.map((row) => row.name).join(' / ');
  const defenceNames = tightestDefence.map((row) => row.name).join(' / ');
  const leader = leaders[0];
  const differential = leader.gf - leader.ga;
  return `<section class="standings-analysis">
    <div class="analysis-label">Reading the table</div>
    <article class="leader-pulse"><span>${leaders.length === 1 ? 'Current points leader' : 'Current points leaders'}</span><b>${topPoints}</b><h2>${escapeHtml(leaderNames)}</h2><p>${leaders.length === 1 ? 'Sets' : 'Set'} the pace through ${leader.gp} games. The listed goal differential is ${differential >= 0 ? '+' : ''}${differential}.</p></article>
    <div class="table-briefs"><article><span>Goals-for high</span><b>${topGoals}</b><h3>${escapeHtml(attackNames)}</h3><p>The largest goals-for total in the supplied table.</p></article><article><span>Fewest against</span><b>${fewestAgainst}</b><h3>${escapeHtml(defenceNames)}</h3><p>The smallest goals-against total in the supplied table.</p></article></div>
    <article class="standings-context"><h3>How to read this table</h3><p>${escapeHtml(edition.standingsNote)}</p></article>
  </section>`;
}

function standingsPage(edition: NewspaperEdition): string {
  const standingsHeading = edition.source.standingsAsOf && edition.source.standingsAsOf !== edition.periodEnd
    ? `Official table snapshot as of ${edition.source.standingsAsOf}`
    : `Official table through ${edition.periodEnd}`;
  return shell(edition, 4, 'The table never lies', `<div class="section-title standings-title"><span>Wins, losses & arithmetic</span><h1>Standings</h1><p>${escapeHtml(standingsHeading)}</p></div><div class="standings-layout"><section class="table-wrap"><table><thead><tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>T</th><th>PTS</th><th>GF</th><th>GA</th></tr></thead><tbody>${standingsRows(edition)}</tbody></table>${standingsAnalysis(edition)}</section><aside class="temperature"><section class="heater"><header><span>▲</span><div><small>Trending up</small><h2>The Heater</h2></div></header>${temperatureStories(edition.hot, 'hot')}</section><section class="cold"><header><span>▼</span><div><small>Proceed with mittens</small><h2>The Cold Tub</h2></div></header>${temperatureStories(edition.cold, 'cold')}</section></aside></div>`);
}

function readerUpcomingNote(note: string): string {
  return note.replace(/^\s*next week headlines\s*[\u2010-\u2015:\-]+\s*/i, '').trim();
}

function issueRecap(edition: NewspaperEdition): string {
  return `<section class="issue-recap"><div class="analysis-label">The issue in brief</div><div>${readerNumbers(edition).slice(0, 3).map((item) => `<article><b>${escapeHtml(item.value)}</b><h3>${escapeHtml(item.label)}</h3>${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ''}</article>`).join('')}</div></section>`;
}

function upcomingPage(edition: NewspaperEdition): string {
  const upcomingNote = readerUpcomingNote(edition.upcomingNote);
  const upcomingHeading = edition.editorial?.upcoming?.heading || 'Next Week Headlines';
  const fixtures = edition.upcoming.length
    ? `${edition.editorial?.upcoming ? `<p class="upcoming-note">${escapeHtml(upcomingNote)}</p>` : ''}<div class="upcoming-grid${edition.editorial?.upcoming ? ' upcoming-grid--editorial' : ''}">${edition.upcoming.map((game) => `<article><div class="date-tab"><time datetime="${escapeHtml(game.scheduledAt)}">${escapeHtml(formatScheduled(game.scheduledAt))}</time>${game.venue ? `<span>${escapeHtml(game.venue)}</span>` : ''}</div><div class="versus"><b>${escapeHtml(game.awayName)}</b><i>at</i><b>${escapeHtml(game.homeName)}</b></div><h2>${escapeHtml(game.headline)}</h2>${game.line ? `<p class="projection-line">${escapeHtml(game.line)}</p>` : ''}${game.pick ? `<p class="projection-pick">${escapeHtml(game.pick)}</p>` : ''}${paragraphs(game.bodyParagraphs || [game.body])}</article>`).join('')}</div>${edition.editorial?.upcoming ? '' : `<p class="upcoming-note">${escapeHtml(upcomingNote)}</p>`}`
    : `<section class="no-fixtures"><div class="empty-puck">●</div><span>Schedule desk</span><h2>No scheduled fixtures</h2><p>${escapeHtml(upcomingNote)}</p><small>Check the league schedule for upcoming games.</small></section>`;
  const rink = (edition.aroundRink || []).map((item) => `<article${item.imageUrl ? '' : ' style="display:block"'}>${item.imageUrl ? image(item.imageUrl, item.headline) : ''}<div><h3>${escapeHtml(item.headline)}</h3><p>${escapeHtml(item.body)}</p></div></article>`).join('');
  const aroundCount = edition.aroundRink?.length || 0;
  const sourceNote = edition.editorial?.sourceNote
    ? `<section class="reader-source-note"><h2>Editorial source note</h2>${paragraphs(edition.editorial.sourceNote)}</section>`
    : '';
  const replacesLegacyTail = Boolean(edition.editorial?.sourceNote?.length && edition.editorial?.upcoming);
  const legacyTail = replacesLegacyTail ? '' : `<section class="around around-count-${aroundCount}"><div class="band-title"><i></i><h2>Around the Rink</h2><i></i></div>${rink ? `<div class="around-grid">${rink}</div>` : '<p class="none-recorded around-empty">No additional rink notes were supplied for this edition.</p>'}</section>${issueRecap(edition)}`;
  return shell(edition, 5, 'The view beyond the blue line', `<div class="section-title next-title"><span>Schedule desk</span><h1>${escapeHtml(upcomingHeading)}</h1><p>The next fixtures and the next round of bragging rights.</p></div>${fixtures}${sourceNote}${legacyTail}`);
}

function formatScheduled(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('month')} ${part('day')}, ${part('year')} · ${part('hour')}:${part('minute')}`;
}

const CSS = String.raw`
:root{--paper:#f2ead8;--ink:#171715;--red:#a4161a;--muted:#756e63;--rule:#27241f;color-scheme:light}*{box-sizing:border-box}html,body{margin:0;background:#292927;color:var(--ink);font-family:Georgia,'Times New Roman',serif}body{padding:28px}.newspaper-edition{display:flex;flex-direction:column;align-items:center;gap:28px}.newspaper-page{position:relative;width:853px;height:1280px;overflow:hidden;background-color:var(--paper);background-image:repeating-linear-gradient(0deg,rgba(74,58,30,.025) 0,rgba(74,58,30,.025) 1px,transparent 1px,transparent 4px),radial-gradient(circle at 20% 15%,rgba(255,255,255,.7),transparent 32%),radial-gradient(circle at 80% 75%,rgba(120,90,45,.07),transparent 38%);padding:18px 20px 17px;box-shadow:0 12px 34px #0008;display:grid;grid-template-rows:142px 1fr 34px;break-after:page;page-break-after:always}.paper-header{border-top:2px solid var(--ink)}.folio-top{height:27px;display:grid;grid-template-columns:1fr 1.6fr 1fr;align-items:center;border-bottom:1px solid var(--rule);font:700 12px/1.1 Arial Narrow,Arial,sans-serif;text-transform:uppercase;letter-spacing:.55px}.folio-top b{text-align:center}.folio-top span:last-child{text-align:right}.masthead{height:90px;display:grid;grid-template-columns:64px 1fr 130px;align-items:center;border-bottom:2px solid var(--ink)}.mast-title{font-family:Georgia,'Times New Roman',serif;font-size:56px;font-weight:900;letter-spacing:-3.2px;text-align:center;line-height:.9}.mast-deck{text-align:center;text-transform:uppercase;font:700 10px/1 Arial,sans-serif;letter-spacing:3px;margin-top:7px}.puck-mark{width:52px;height:52px;border:5px double var(--ink);border-radius:50%;font-size:31px;display:grid;place-items:center;line-height:1}.league-mark{text-align:right;text-transform:uppercase;font:900 15px/1.05 Arial Narrow,Arial,sans-serif;overflow-wrap:anywhere}.league-mark small{display:block;font-size:11px;margin-top:7px}.section-strip{height:25px;border-bottom:5px double var(--ink);display:flex;justify-content:center;align-items:center;gap:13px;font:800 10px/1 Arial,sans-serif;letter-spacing:1.25px}.section-strip i{height:11px;width:1px;background:var(--ink)}main{min-height:0;overflow:hidden}.paper-footer{height:34px;background:var(--ink);color:var(--paper);align-self:end;display:grid;grid-template-columns:1fr 1.6fr 112px;align-items:center;padding-left:14px;font-size:10px;text-transform:uppercase;letter-spacing:1.3px}.paper-footer span:nth-child(2){text-align:center}.paper-footer b{height:34px;background:var(--red);display:grid;place-items:center;font:800 11px Arial,sans-serif}.draft-flag{position:absolute;top:147px;right:20px;z-index:4;background:var(--paper);border:1px solid var(--red);color:var(--red);padding:4px 8px;font:800 9px Arial,sans-serif;text-transform:uppercase;letter-spacing:1px}.front-head{padding:13px 0 9px;border-bottom:2px solid var(--ink);position:relative}.front-head>span,.section-title>span{display:block;color:var(--red);font:900 12px Arial Narrow,Arial,sans-serif;text-transform:uppercase;letter-spacing:2px}.front-head h1{margin:1px 0 2px;font:900 55px/.87 Arial Narrow,Impact,sans-serif;letter-spacing:-2px;text-transform:uppercase;max-width:760px;overflow-wrap:anywhere}.front-head p{margin:5px 0 0;font:700 17px/1.12 Georgia,serif}.lead-grid{display:grid;grid-template-columns:1.63fr 1fr;height:520px;border-bottom:2px solid var(--ink)}figure{margin:0}.lead-art{border-right:2px solid var(--ink);padding:10px 10px 7px 0;display:grid;grid-template-rows:1fr auto;min-height:0}.lead-art>img,.lead-art>.art-placeholder{width:100%;height:100%;min-height:0;object-fit:cover;filter:saturate(.78) contrast(1.04)}figcaption{font:italic 10px/1.25 Georgia,serif;padding-top:4px;color:#423e37}.lead-copy{padding:10px 0 0 12px;overflow:hidden}.story-label{border-top:5px solid var(--ink);border-bottom:1px solid var(--ink);padding:4px 0;font:900 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}.lead-copy p{font-size:14px;line-height:1.24;margin:0 0 9px}.lead-copy p:first-of-type:first-letter{float:left;font-size:47px;line-height:.75;padding:8px 5px 0 0;font-weight:900;color:var(--red)}.front-teasers{height:230px;display:grid;grid-template-columns:1fr 1fr .84fr;border-bottom:1px solid var(--ink)}.teaser{padding:10px;border-right:1px solid var(--ink);overflow:hidden}.teaser:first-child{padding-left:0}.teaser>span{font:800 9px Arial,sans-serif;color:var(--red);text-transform:uppercase;letter-spacing:1px}.teaser h3{font:900 22px/.95 Arial Narrow,Arial,sans-serif;text-transform:uppercase;margin:5px 0 9px;overflow-wrap:anywhere}.front-teasers aside{padding:10px 0 0 10px}.front-teasers aside>b{font:900 19px Arial Narrow,Arial,sans-serif;text-transform:uppercase}.front-teasers aside ol{margin:8px 0 0;padding-left:22px;font-size:11px;line-height:1.3}.front-teasers aside li{margin-bottom:6px}.scoreline{border-top:2px solid var(--ink);border-bottom:2px solid var(--ink);display:grid;grid-template-columns:1fr 42px 1fr;align-items:center;min-height:55px}.scoreline>div{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:5px}.scoreline>div:last-child{grid-template-columns:28px 1fr auto}.scoreline span{font:800 11px/1 Arial Narrow,Arial,sans-serif;text-transform:uppercase;overflow-wrap:anywhere}.scoreline b{font:900 27px/1 Arial Narrow,Arial,sans-serif;color:var(--red)}.scoreline em{text-align:center;font:800 8px Arial,sans-serif}.team-logo,.mini-logo{object-fit:contain}.team-logo{width:27px;height:27px}.team-logo.art-placeholder,.mini-logo.art-placeholder{border:1px solid var(--ink);border-radius:50%;font-size:0;background:transparent}.team-logo.art-placeholder:after,.mini-logo.art-placeholder:after{content:'HL';font:800 8px Arial,sans-serif}.team-logo.art-placeholder span,.team-logo.art-placeholder b,.mini-logo.art-placeholder span,.mini-logo.art-placeholder b{display:none}.art-placeholder{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(circle at 50% 43%,transparent 0 17%,var(--ink) 17% 18%,transparent 18% 31%,var(--red) 31% 32%,transparent 32%),linear-gradient(24deg,#d6cab1,#eee5d2 52%,#c9b99c);border:1px solid #867c6b;text-transform:uppercase}.art-placeholder:before,.art-placeholder:after{content:'';position:absolute;background:rgba(20,20,18,.18)}.art-placeholder:before{height:1px;width:100%;top:50%}.art-placeholder:after{height:100%;width:1px;left:50%}.art-placeholder span,.art-placeholder b{position:relative;z-index:1;background:var(--paper);padding:3px 8px;font:900 18px Arial Narrow,Arial,sans-serif;letter-spacing:2px}.art-placeholder b{font-size:28px;color:var(--red)}.section-title{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;padding:12px 0 9px;border-bottom:5px solid var(--ink)}.section-title span{grid-column:1/-1}.section-title h1{margin:0;font:900 50px/.95 Arial Narrow,Impact,sans-serif;text-transform:uppercase;letter-spacing:-1.6px}.section-title p{margin:0;align-self:end;font:700 12px/1.15 Georgia,serif;max-width:260px;text-align:right}.games-grid{display:grid;grid-template-columns:repeat(2,1fr);height:900px}.game-report{position:relative;padding:12px 11px 8px;border-right:1px solid var(--ink);border-bottom:1px solid var(--ink);overflow:hidden}.game-report:nth-child(2n){border-right:0}.game-no{font:900 10px Arial,sans-serif;text-transform:uppercase;color:var(--red);letter-spacing:1.3px}.game-report h2{font:900 30px/.9 Arial Narrow,Impact,sans-serif;text-transform:uppercase;margin:3px 0 7px;min-height:54px;overflow-wrap:anywhere}.game-report>.scoreline{margin-bottom:10px}.game-columns{display:grid;grid-template-columns:1.16fr .84fr;gap:10px;height:360px}.game-columns p{font-size:12px;line-height:1.27;margin:0 0 8px}.game-columns figure{display:grid;grid-template-rows:1fr auto;min-height:0}.game-columns figure img,.game-columns figure>.art-placeholder{height:100%;width:100%;object-fit:cover;filter:grayscale(.15) saturate(.75)}.contributors{margin-top:9px;border-top:5px solid var(--ink)}.contributors h3{margin:0;padding:4px 0;border-bottom:1px solid;font:900 13px Arial Narrow,Arial,sans-serif;text-transform:uppercase}.contributors ol{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr}.contributors li{display:grid;grid-template-columns:1fr auto;padding:5px 4px;border-bottom:1px solid #9c9383;font:800 10px/1.05 Arial Narrow,Arial,sans-serif}.contributors li:nth-child(odd){border-right:1px solid #9c9383}.contributors li small{grid-row:2;font-weight:400;margin-top:2px}.contributors li b{grid-row:1/3;grid-column:2;align-self:center;color:var(--red);font-size:10px}.none-recorded{font-style:italic;color:var(--muted);padding:8px!important}.section-title.compact h1{font-size:46px}.stars-grid{height:535px;display:grid;grid-template-columns:repeat(3,1fr);border-bottom:2px solid var(--ink)}.star{display:grid;grid-template-rows:275px 1fr;position:relative;padding:10px;border-right:1px solid var(--ink);overflow:hidden}.star:last-child{border-right:0}.star-rank{position:absolute;z-index:2;top:18px;left:18px;width:42px;height:42px;background:var(--red);color:#fff;border-radius:50%;display:grid;place-items:center;font:900 25px Georgia,serif;border:3px solid var(--paper)}.star figure{min-height:0}.star figure img,.star figure>.art-placeholder{width:100%;height:100%;object-fit:cover;object-position:center top;filter:saturate(.76)}.star-copy>span{display:block;color:var(--red);font:900 10px Arial,sans-serif;text-transform:uppercase;margin-top:7px}.star h2{margin:2px 0 5px;font:900 25px/.92 Arial Narrow,Arial,sans-serif;text-transform:uppercase;overflow-wrap:anywhere}.statline{border-top:1px solid;border-bottom:1px solid;padding:4px 0;font:700 10px Arial,sans-serif}.statline b{font-size:16px}.statline strong{float:right;background:var(--ink);color:var(--paper);padding:3px 5px}.star p{font-size:11px;line-height:1.22;margin:7px 0}.numbers-band{padding-top:8px}.band-title{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center}.band-title i{height:6px;border-top:2px solid;border-bottom:1px solid}.band-title h2{font:900 28px Arial Narrow,Arial,sans-serif;text-transform:uppercase;margin:0;letter-spacing:1px}.numbers-grid{display:grid;grid-template-columns:repeat(5,1fr);height:270px;border-top:2px solid var(--ink);border-left:1px solid var(--ink)}.numbers-grid article{padding:12px 8px 8px;border-right:1px solid var(--ink);border-bottom:1px solid var(--ink);text-align:center;overflow:hidden}.numbers-grid article>b{font:900 28px/.9 Georgia,serif;color:var(--red);overflow-wrap:anywhere}.numbers-grid h3{font:900 12px/1 Arial,sans-serif;text-transform:uppercase;margin:7px 0 4px}.numbers-grid p{font-size:10px;line-height:1.18;margin:0}.standings-title h1{color:var(--red)}.standings-layout{display:grid;grid-template-columns:1.52fr .78fr;height:917px}.table-wrap{padding:10px 10px 0 0;border-right:2px solid var(--ink)}table{border-collapse:collapse;width:100%;table-layout:fixed;font:700 12px Arial Narrow,Arial,sans-serif}thead{background:var(--ink);color:var(--paper)}th,td{padding:7px 3px;border-bottom:1px solid #9c9383;text-align:center}thead th{text-transform:uppercase;font-size:9px;border-right:1px solid #777}thead th:nth-child(2){width:42%;text-align:left}tbody th{text-align:left;display:flex;align-items:center;gap:7px;min-width:0}tbody th span{overflow-wrap:anywhere}.mini-logo{width:22px;height:22px;flex:0 0 22px}.table-note{font-style:italic;font-size:10px}.temperature{padding:10px 0 0 10px;display:grid;grid-template-rows:1fr 1fr;gap:10px}.temperature>section{border:2px solid var(--ink);overflow:hidden}.temperature header{background:var(--ink);color:var(--paper);display:flex;align-items:center;padding:7px;gap:8px}.temperature header>span{font:900 29px Arial,sans-serif;color:#e03535}.temperature header small{font:700 8px Arial,sans-serif;text-transform:uppercase;letter-spacing:1px}.temperature h2{font:900 25px/.9 Arial Narrow,Arial,sans-serif;text-transform:uppercase;margin:0}.temperature article{display:grid;grid-template-columns:60px 1fr;gap:7px;padding:7px;border-bottom:1px solid #9c9383}.temperature article>img,.temperature article>.art-placeholder{width:60px;height:64px;object-fit:cover}.temperature .art-placeholder span,.temperature .art-placeholder b{display:none}.temperature h3{font:900 14px/.95 Arial Narrow,Arial,sans-serif;text-transform:uppercase;margin:0 0 4px;overflow-wrap:anywhere}.temperature p{font-size:10px;line-height:1.18;margin:0}.cold header>span{color:#93b5c6}.next-title h1{color:var(--red)}.upcoming-grid{display:grid;grid-template-columns:1fr 1fr;border-left:1px solid var(--ink)}.upcoming-grid article{position:relative;padding:12px;border-right:1px solid;border-bottom:1px solid;min-height:210px}.date-tab{display:flex;justify-content:space-between;border-bottom:4px solid var(--ink);padding-bottom:4px;font:800 10px Arial,sans-serif;text-transform:uppercase}.versus{display:grid;grid-template-columns:1fr 28px 1fr;align-items:center;text-align:center;margin:8px 0;font:900 18px/.95 Arial Narrow,Arial,sans-serif;text-transform:uppercase;overflow-wrap:anywhere}.versus i{font:italic 11px Georgia,serif;color:var(--red)}.upcoming-grid h2{font:900 22px/.95 Arial Narrow,Arial,sans-serif;text-transform:uppercase;margin:0 0 5px;overflow-wrap:anywhere}.upcoming-grid p{font-size:11px;line-height:1.2;margin:0}.upcoming-note{font-style:italic;text-align:center;font-size:10px}.no-fixtures{height:400px;margin-top:14px;border:7px double var(--ink);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;background:radial-gradient(circle at 50% 50%,rgba(164,22,26,.08),transparent 48%)}.empty-puck{width:74px;height:74px;display:grid;place-items:center;border:6px double var(--ink);border-radius:50%;font-size:43px;margin-bottom:12px}.no-fixtures>span{font:900 11px Arial,sans-serif;color:var(--red);text-transform:uppercase;letter-spacing:2px}.no-fixtures h2{font:900 48px/.9 Arial Narrow,Impact,sans-serif;text-transform:uppercase;margin:6px 0}.no-fixtures p{font:700 17px/1.25 Georgia,serif;max-width:570px;margin:6px 0}.no-fixtures small{font:italic 11px Georgia,serif;margin-top:10px}.around{margin-top:13px}.around-grid{display:grid;grid-template-columns:repeat(2,1fr);border-left:1px solid;border-top:1px solid;margin-top:8px}.around-grid article{display:grid;grid-template-columns:82px 1fr;min-height:105px;padding:8px;border-right:1px solid;border-bottom:1px solid;gap:8px}.around-grid img,.around-grid .art-placeholder{width:82px;height:84px;object-fit:cover}.around-grid .art-placeholder span,.around-grid .art-placeholder b{display:none}.around-grid h3{font:900 16px/.95 Arial Narrow,Arial,sans-serif;text-transform:uppercase;margin:0 0 5px;overflow-wrap:anywhere}.around-grid p{font-size:10px;line-height:1.18;margin:0}.around-empty{border:1px solid;margin:8px 0;text-align:center}.source-notes{border-top:4px solid var(--ink);margin-top:10px;display:grid;grid-template-columns:160px 1fr;padding-top:6px}.source-notes h3{font:900 13px Arial,sans-serif;text-transform:uppercase;margin:0}.source-notes ul{columns:2;margin:0;padding-left:18px;font-size:9px}.colophon{position:absolute;bottom:55px;left:20px;right:20px;border-top:1px solid;display:flex;justify-content:space-between;padding-top:5px;font:700 9px Arial,sans-serif;text-transform:uppercase}.colophon b{color:var(--red)}
.lead-copy p{font-size:11px;line-height:1.18;margin-bottom:6px}.game-columns{height:510px}.game-columns p{font-size:10px;line-height:1.16;margin-bottom:5px}.contributors{margin-top:6px}.contributors h3{padding:3px 0;font-size:11px}.contributors li{padding:3px 3px;font-size:8.5px}.contributors li b{font-size:8.5px}.table-note{line-height:1.24;margin:10px 2px}
main,.game-report,.numbers-grid article{overflow:visible}.game-report--dense .game-columns{height:480px}.game-report--dense .contributors{margin-top:4px}.game-report--dense .contributors h3{padding:2px 0;font-size:10px}.game-report--dense .contributors li{padding:2px;font-size:7.7px;line-height:1}.game-report--dense .contributors li small{margin-top:1px}.game-report--dense .contributors li b{font-size:7.7px}.number-long>b{display:block;font-size:20px!important;line-height:.9!important}.number-long h3{font-size:10px;margin-top:5px}.number-long p{font-size:9px;line-height:1.12}.standings-analysis{margin:18px 2px 0;border-top:7px double var(--ink)}.analysis-label{padding:6px 0 5px;color:var(--red);font:900 10px Arial,sans-serif;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid var(--ink)}.leader-pulse{display:grid;grid-template-columns:1fr 95px;grid-template-rows:auto auto auto;padding:12px 0;border-bottom:2px solid var(--ink)}.leader-pulse>span{font:900 10px Arial,sans-serif;text-transform:uppercase;letter-spacing:1px}.leader-pulse>b{grid-row:1/4;grid-column:2;font:900 62px/.82 Georgia,serif;color:var(--red);text-align:right}.leader-pulse h2{margin:3px 0;font:900 29px/.94 Arial Narrow,Arial,sans-serif;text-transform:uppercase;overflow-wrap:anywhere}.leader-pulse p{margin:2px 0;font-size:11px;line-height:1.2}.table-briefs{display:grid;grid-template-columns:1fr 1fr;border-bottom:2px solid var(--ink)}.table-briefs article{padding:10px 8px 10px 0}.table-briefs article+article{padding-left:10px;border-left:1px solid var(--ink)}.table-briefs span{font:900 9px Arial,sans-serif;text-transform:uppercase;color:var(--red)}.table-briefs b{display:block;font:900 34px/.9 Georgia,serif}.table-briefs h3{font:900 15px/.95 Arial Narrow,Arial,sans-serif;text-transform:uppercase;margin:5px 0}.table-briefs p{font-size:10px;line-height:1.18;margin:0}.standings-context{padding-top:10px}.standings-context h3{margin:0 0 5px;font:900 16px Arial Narrow,Arial,sans-serif;text-transform:uppercase}.standings-context p{columns:2;column-gap:16px;column-rule:1px solid #9c9383;font:italic 10px/1.24 Georgia,serif;margin:0}.page-5 .no-fixtures{height:385px}.page-5 .around-grid article{min-height:155px;grid-template-columns:108px 1fr;padding:10px}.page-5 .around-grid img,.page-5 .around-grid .art-placeholder{width:108px;height:132px}.page-5 .around-grid h3{font-size:17px}.page-5 .around-grid p{font-size:11px;line-height:1.22}.page-5 .around-count-3 .around-grid article,.page-5 .around-count-4 .around-grid article{min-height:125px}.page-5 .around-count-3 .around-grid img,.page-5 .around-count-3 .around-grid .art-placeholder,.page-5 .around-count-4 .around-grid img,.page-5 .around-count-4 .around-grid .art-placeholder{height:102px}.issue-recap{margin-top:14px;border-top:7px double var(--ink)}.issue-recap>div:last-child{display:grid;grid-template-columns:repeat(3,1fr);border-left:1px solid var(--ink)}.issue-recap article{padding:9px 10px;border-right:1px solid var(--ink);min-height:112px;text-align:center}.issue-recap article>b{display:block;color:var(--red);font:900 25px/.95 Georgia,serif;overflow-wrap:anywhere}.issue-recap h3{margin:4px 0;font:900 11px/1 Arial,sans-serif;text-transform:uppercase}.issue-recap p{font-size:9px;line-height:1.15;margin:0}
.standings-analysis--editorial .standings-context{padding:12px 0}.standings-analysis--editorial .standings-context h3{font-size:21px}.standings-analysis--editorial .standings-context p{columns:auto;font-style:normal;font-size:11px;line-height:1.28;margin:0 0 9px}.upcoming-grid--editorial article{padding:9px 11px;min-height:0}.upcoming-grid--editorial .versus{margin:5px 0}.upcoming-grid--editorial h2{font-size:18px}.upcoming-grid--editorial p{font-size:9.5px;line-height:1.18;margin:0 0 7px}.upcoming-grid--editorial .projection-line,.upcoming-grid--editorial .projection-pick{font:bold 10px/1.2 Arial,sans-serif;border-top:1px solid;padding-top:4px}.reader-source-note{border-top:5px double var(--ink);margin-top:8px;padding-top:5px}.reader-source-note h2{font:900 14px Arial Narrow,Arial,sans-serif;text-transform:uppercase;margin:0 0 3px}.reader-source-note p{font-size:8.5px;line-height:1.15;margin:0 0 3px}
@media(max-width:900px){body{padding:12px}.newspaper-page{transform-origin:top center}.newspaper-edition{--scale:calc((100vw - 24px)/853);gap:calc(28px*var(--scale))}.newspaper-page{transform:scale(var(--scale));margin-bottom:calc((1280px*(var(--scale) - 1)))}}
@media print{@page{size:8.53in 12.8in;margin:0}html,body{background:transparent}body{padding:0}.newspaper-edition{display:block}.newspaper-page{width:8.53in;height:12.8in;box-shadow:none;margin:0;break-after:page;page-break-after:always}.newspaper-page:last-child{break-after:auto;page-break-after:auto}}
`;

/** Returns the exact five-page HTML used by preview, publication and export. */
export function renderNewspaperHtml(edition: NewspaperEdition): string {
  validateNewspaperEdition(edition);
  const pages = [leadPage(edition), gamesPage(edition), starsPage(edition), standingsPage(edition), upcomingPage(edition)].join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(edition.title)} · Issue ${escapeHtml(edition.issueNumber)}</title><style>${CSS}</style></head><body><article class="newspaper-edition" data-schema-version="1" data-status="${escapeHtml(edition.status)}">${pages}</article></body></html>`;
}

/** Native-readable fallback for indexing, accessibility and non-visual export. */
export function renderNewspaperText(edition: NewspaperEdition): string {
  validateNewspaperEdition(edition);
  const lines = [
    `${edition.title} - Issue ${edition.issueNumber}`,
    `${edition.leagueName} · ${edition.seasonName} · ${edition.periodStart} to ${edition.periodEnd}`,
    edition.status === 'draft' ? 'DRAFT PREVIEW - NOT PUBLISHED' : 'PUBLISHED EDITION',
    '', edition.lead.headline, edition.lead.dek, ...edition.lead.body,
    '', 'THIS WEEK ON THE ICE',
    ...edition.games.flatMap((g) => [`${g.awayTeam.name} ${g.awayScore} - ${g.homeTeam.name} ${g.homeScore}`, g.headline, ...g.body, 'Contributors:', ...g.contributors.map((player) => `${player.name}, ${player.teamName}: ${player.goals} G, ${player.assists} A, ${player.points} P`)]),
    '', 'THREE STARS OF THE WEEK',
    ...edition.stars.map((s, i) => `${i + 1}. ${s.name}, ${s.teamName} - ${s.goals} G, ${s.assists} A, ${s.points} P. ${s.reason}`),
    '', 'THIS WEEK BY THE NUMBERS',
    ...readerNumbers(edition).map((n) => `${n.value} - ${n.label}${n.detail ? `: ${n.detail}` : ''}`),
    '', 'STANDINGS',
    ...edition.standings.map((s, i) => `${i + 1}. ${s.name}: ${s.gp} GP, ${s.w}-${s.l}-${s.otl}-${s.t}, ${s.pts} PTS, ${s.gf} GF, ${s.ga} GA`),
    ...(edition.editorial?.standings ? [edition.editorial.standings.headline, ...edition.editorial.standings.body] : [edition.standingsNote]),
    '', 'THE HEATER', ...edition.hot.map((x) => `${x.headline}: ${x.body}`),
    '', 'THE COLD TUB', ...edition.cold.map((x) => `${x.headline}: ${x.body}`),
    '', edition.editorial?.upcoming?.heading || 'NEXT WEEK HEADLINES',
    ...(edition.upcoming.length ? [readerUpcomingNote(edition.upcomingNote)] : []),
    ...(edition.upcoming.length ? edition.upcoming.flatMap((g) => [`${g.awayName} at ${g.homeName}, ${formatScheduled(g.scheduledAt)}${g.venue ? `, ${g.venue}` : ''} - ${g.headline}`, g.line, g.pick, ...(g.bodyParagraphs || [g.body])]) : [`NO SCHEDULED FIXTURES - ${readerUpcomingNote(edition.upcomingNote)}`]),
    ...((edition.editorial?.sourceNote?.length ? ['', 'EDITORIAL SOURCE NOTE', ...edition.editorial.sourceNote] : [])),
    ...((edition.aroundRink?.length ? ['', 'AROUND THE RINK', ...edition.aroundRink.map((x) => `${x.headline}: ${x.body}`)] : [])),
  ];
  return lines.filter((line) => line !== undefined).map((line) => normalizeDashes(String(line))).join('\n');
}
