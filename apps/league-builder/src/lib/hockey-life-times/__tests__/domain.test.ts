import {
  assessReadiness,
  applyNarrativePatch,
  buildDeterministicEdition,
  confirmedNextWeekFixtures,
  editionToArticleFallback,
  isNewspaperEdition,
  periodUtcBounds,
  reconcileGameContributors,
  type NewspaperGameInput,
} from '../domain';

const game: NewspaperGameInput = {
  id: 'game-1', leagueId: 'league-1', seasonId: 'season-1',
  scheduledAt: '2026-09-23T01:00:00Z', status: 'completed',
  homeScore: 3, awayScore: 2,
  homeTeam: { id: 'home', name: 'Home' }, awayTeam: { id: 'away', name: 'Away' },
};

describe('Hockey Life Times fact preparation', () => {
  it('gates an unfinished or cross-tenant selected game', () => {
    const result = assessReadiness([{ ...game, leagueId: 'other', status: 'scheduled' }], 'league-1', 'season-1');
    expect(result.ready).toBe(false);
    expect(result.errors.join(' ')).toMatch(/another league/i);
    expect(result.errors.join(' ')).toMatch(/not finalized/i);
  });

  it('gates a newspaper period that exceeds the two-game page contract', () => {
    expect(() => buildDeterministicEdition({
      issueNumber: 1, leagueId: 'league-1', leagueName: 'Hockey Life',
      seasonId: 'season-1', seasonName: 'Fall', seasonStatus: 'active',
      periodStart: '2026-09-21', periodEnd: '2026-09-27', issuedAt: '2026-09-27T12:00:00Z',
      games: [game, { ...game, id: 'game-2' }, { ...game, id: 'game-3' }],
      goals: [], profiles: [], standings: [], upcoming: [],
    })).toThrow(/canonical Monday-Sunday week/i);
  });

  it('uses neutral copy for a supported tied final instead of inventing a winner', () => {
    const tiedGame = { ...game, homeScore: 1, awayScore: 1 };
    const edition = buildDeterministicEdition({
      issueNumber: 5, leagueId: 'league-1', leagueName: 'Hockey Life',
      seasonId: 'season-1', seasonName: 'Fall', seasonStatus: 'active',
      periodStart: '2026-09-21', periodEnd: '2026-09-27', issuedAt: '2026-09-27T12:00:00Z',
      games: [tiedGame],
      goals: [
        { id: 'g1', gameId: game.id, teamId: 'home', scorerId: 'p1', assist1Id: 'p2', assist2Id: null },
        { id: 'g2', gameId: game.id, teamId: 'away', scorerId: 'p3', assist1Id: 'p4', assist2Id: null },
      ],
      profiles: [
        { id: 'p1', name: 'Home Scorer' }, { id: 'p2', name: 'Home Helper' },
        { id: 'p3', name: 'Away Scorer' }, { id: 'p4', name: 'Away Helper' },
      ],
      standings: [{ teamId: 'home', name: 'Home', gp: 1, w: 0, l: 0, otl: 0, t: 1, pts: 1, gf: 1, ga: 1 }],
      upcoming: [],
    });

    expect(edition.games[0].headline).toMatch(/level/i);
    expect(edition.games[0].headline).not.toMatch(/takes the points|wins?|victory|beats?/i);
    expect(edition.games[0].body[0]).toBe('Home and Away finished level at 1-1.');
  });

  it('blocks a finalized 0-0 issue because verified scoring cannot support Three Stars', () => {
    const result = assessReadiness([{ ...game, homeScore: 0, awayScore: 0 }], 'league-1', 'season-1');
    expect(result.ready).toBe(false);
    expect(result.errors.join(' ')).toMatch(/0-0.*Three Stars/i);
  });

  it('includes a 0-0 final when another game supplies the weekly Three Stars', () => {
    const scoreless = { ...game, id: 'game-zero', homeScore: 0, awayScore: 0 };
    expect(assessReadiness([game, scoreless], 'league-1', 'season-1').ready).toBe(true);
    const edition = buildDeterministicEdition({
      issueNumber: 6, leagueId: 'league-1', leagueName: 'Hockey Life',
      seasonId: 'season-1', seasonName: 'Fall', seasonStatus: 'active',
      periodStart: '2026-09-21', periodEnd: '2026-09-27', issuedAt: '2026-09-27T12:00:00Z',
      games: [game, scoreless],
      goals: ['p1', 'p2', 'p3'].map((playerId) => ({
        id: `goal-${playerId}`, gameId: game.id, teamId: 'home', scorerId: playerId,
        assist1Id: null, assist2Id: null,
      })),
      profiles: ['p1', 'p2', 'p3'].map((id) => ({ id, name: `Verified ${id}` })),
      standings: [{ teamId: 'home', name: 'Home', gp: 2, w: 1, l: 0, otl: 0, t: 1, pts: 3, gf: 3, ga: 2 }],
      upcoming: [],
    });
    const report = edition.games.find((item) => item.gameId === scoreless.id)!;
    expect(report.body[0]).toBe('Home and Away finished level at 0-0.');
    expect(edition.stars).toHaveLength(3);
  });

  it('describes whole-week readiness failures without suggesting a narrower period', () => {
    const result = assessReadiness([
      game,
      { ...game, id: 'game-2' },
      { ...game, id: 'game-3' },
    ], 'league-1', 'season-1');
    expect(result.ready).toBe(false);
    expect(result.errors.join(' ')).toMatch(/canonical Monday-Sunday week/i);
    expect(result.errors.join(' ')).not.toMatch(/narrower period/i);
  });

  it('uses Toronto local dates, including the DST offset', () => {
    expect(periodUtcBounds('2026-09-21', '2026-09-27')).toEqual({
      fromInclusive: '2026-09-21T04:00:00.000Z',
      toExclusive: '2026-09-28T04:00:00.000Z',
    });
  });

  it('rejects non-Monday and non-Sunday-ended coverage windows', () => {
    expect(() => periodUtcBounds('2026-09-22', '2026-09-28')).toThrow(/start on Monday/i);
    expect(() => periodUtcBounds('2026-09-21', '2026-09-26')).toThrow(/end on the Sunday/i);
  });

  it('includes only confirmed fixtures in the immediately following Toronto calendar week', () => {
    const fixtures = confirmedNextWeekFixtures('2026-09-21', '2026-09-27', [
      { ...game, id: 'next', status: 'scheduled', scheduledAt: '2026-09-29T01:00:00Z' },
      { ...game, id: 'postponed', status: 'postponed', scheduledAt: '2026-09-30T01:00:00Z' },
      { ...game, id: 'future-month', status: 'scheduled', scheduledAt: '2026-11-01T01:00:00Z' },
    ]);
    expect(fixtures.map((fixture) => fixture.id)).toEqual(['next']);
  });

  it('blocks a named contribution when the player identity is unresolved', () => {
    expect(() => reconcileGameContributors(game, [
      { id: 'g1', gameId: game.id, teamId: 'home', scorerId: 'missing', assist1Id: null, assist2Id: null },
    ], new Map())).toThrow(/identity.*unresolved/i);
  });

  it('derives playoff context from scoped games instead of a stale season label', () => {
    const playoffGame = { ...game, gameType: 'playoff' };
    const edition = buildDeterministicEdition({
      issueNumber: 3, leagueId: 'league-1', leagueName: 'Hockey Life',
      seasonId: 'season-1', seasonName: 'Fall', seasonStatus: 'completed',
      periodStart: '2026-09-21', periodEnd: '2026-09-27', issuedAt: '2026-09-27T12:00:00Z',
      games: [playoffGame],
      goals: [
        { id: 'g1', gameId: game.id, teamId: 'home', scorerId: 'p1', assist1Id: null, assist2Id: null },
        { id: 'g2', gameId: game.id, teamId: 'home', scorerId: 'p2', assist1Id: null, assist2Id: null },
        { id: 'g3', gameId: game.id, teamId: 'home', scorerId: 'p3', assist1Id: null, assist2Id: null },
      ],
      profiles: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }, { id: 'p3', name: 'Three' }],
      standings: [{ teamId: 'home', name: 'Home', gp: 1, w: 1, l: 0, otl: 0, t: 0, pts: 2, gf: 3, ga: 2 }],
      upcoming: [],
    });
    expect(edition.stage).toBe('playoffs');
    expect(edition.standingsNote).toMatch(/playoff results/i);
  });

  it('reconciles named and team goals to each score and de-duplicates assists', () => {
    const result = reconcileGameContributors(game, [
      { id: 'g1', gameId: game.id, teamId: 'home', scorerId: 'p1', assist1Id: 'p2', assist2Id: 'p2' },
      { id: 'g2', gameId: game.id, teamId: 'home', scorerId: null, assist1Id: null, assist2Id: null },
      { id: 'g3', gameId: game.id, teamId: 'away', scorerId: 'p3', assist1Id: null, assist2Id: null },
    ], new Map([
      ['p1', { id: 'p1', name: 'One' }], ['p2', { id: 'p2', name: 'Two' }], ['p3', { id: 'p3', name: 'Three' }],
    ]));
    expect(result.contributors.find((player) => player.playerId === 'p2')?.assists).toBe(1);
    expect(result.uncredited).toEqual({ home: 1, away: 1 });
    expect(result.warnings).toHaveLength(2);
  });

  it('rejects source goal rows that exceed a final score', () => {
    expect(() => reconcileGameContributors(
      { ...game, homeScore: 0 },
      [{ id: 'g1', gameId: game.id, teamId: 'home', scorerId: null, assist1Id: null, assist2Id: null }],
      new Map(),
    )).toThrow(/exceed/i);
  });

  it('produces a validated edition and readable non-JSON fallback without fixtures', () => {
    const edition = buildDeterministicEdition({
      issueNumber: 1, leagueId: 'league-1', leagueName: 'Hockey Life',
      seasonId: 'season-1', seasonName: 'Fall', seasonStatus: 'active',
      periodStart: '2026-09-21', periodEnd: '2026-09-27', issuedAt: '2026-09-27T12:00:00Z',
      games: [game],
      goals: [
        { id: 'g1', gameId: game.id, teamId: 'home', scorerId: 'p1', assist1Id: null, assist2Id: null },
        { id: 'g2', gameId: game.id, teamId: 'home', scorerId: 'p2', assist1Id: null, assist2Id: null },
        { id: 'g3', gameId: game.id, teamId: 'home', scorerId: 'p3', assist1Id: null, assist2Id: null },
      ],
      profiles: [{ id: 'p1', name: 'Verified One' }, { id: 'p2', name: 'Verified Two' }, { id: 'p3', name: 'Verified Three' }],
      standings: [{ teamId: 'home', name: 'Home', gp: 1, w: 1, l: 0, otl: 0, t: 0, pts: 2, gf: 3, ga: 2 }],
      upcoming: [],
    });
    expect(isNewspaperEdition(edition)).toBe(true);
    expect(edition.status).toBe('draft');
    expect(edition.upcomingNote).toMatch(/No future fixtures/i);
    expect(edition.source.standingsAsOf).toBe('2026-09-27');
    expect(edition.hot[0]?.headline).toContain('Home');
    expect(edition.cold[0]?.headline).toContain('Home');
    edition.upcoming.push({ gameId: 'future', homeName: 'Home', awayName: 'Away', scheduledAt: '2026-10-01T01:00:00Z', headline: 'Future game', body: 'Preview.' });
    edition.upcomingNote = 'Fictional lines are not sportsbook prices.';
    const fallback = editionToArticleFallback(edition);
    expect(fallback).toContain('THIS WEEK ON THE ICE');
    expect(fallback).toContain('Fictional lines are not sportsbook prices.');
    expect(fallback).not.toContain('"schemaVersion"');
  });

  it('omits unsupported player-zero and goalie claims', () => {
    const edition = buildDeterministicEdition({
      issueNumber: 2, leagueId: 'league-1', leagueName: 'Hockey Life',
      seasonId: 'season-1', seasonName: 'Fall', seasonStatus: 'active',
      periodStart: '2026-09-21', periodEnd: '2026-09-27', issuedAt: '2026-09-27T12:00:00Z',
      games: [game],
      goals: [
        { id: 'g1', gameId: game.id, teamId: 'home', scorerId: 'p1', assist1Id: null, assist2Id: null },
        { id: 'g2', gameId: game.id, teamId: 'home', scorerId: 'p2', assist1Id: null, assist2Id: null },
        { id: 'g3', gameId: game.id, teamId: 'home', scorerId: 'p3', assist1Id: null, assist2Id: null },
      ],
      profiles: [{ id: 'p1', name: 'Verified One' }, { id: 'p2', name: 'Verified Two' }, { id: 'p3', name: 'Verified Three' }, { id: 'bench', name: 'Bench Player' }],
      standings: [{ teamId: 'home', name: 'Home', gp: 1, w: 1, l: 0, otl: 0, t: 0, pts: 2, gf: 3, ga: 2 }],
      upcoming: [],
    });
    const copy = JSON.stringify(edition);
    expect(copy).not.toContain('Bench Player');
    expect(copy).not.toMatch(/save percentage|saves|shutout/i);
  });

  it('applies narrative edits without changing facts, source IDs, or digest', () => {
    const edition = buildDeterministicEdition({
      issueNumber: 4, leagueId: 'league-1', leagueName: 'Hockey Life', seasonId: 'season-1',
      seasonName: 'Fall', seasonStatus: 'active', periodStart: '2026-09-21', periodEnd: '2026-09-27',
      issuedAt: '2026-09-27T12:00:00Z', games: [game],
      goals: [
        { id: 'g1', gameId: game.id, teamId: 'home', scorerId: 'p1', assist1Id: null, assist2Id: null },
        { id: 'g2', gameId: game.id, teamId: 'home', scorerId: 'p2', assist1Id: null, assist2Id: null },
        { id: 'g3', gameId: game.id, teamId: 'home', scorerId: 'p3', assist1Id: null, assist2Id: null },
      ],
      profiles: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }, { id: 'p3', name: 'Three' }],
      standings: [{ teamId: 'home', name: 'Home', gp: 1, w: 1, l: 0, otl: 0, t: 0, pts: 2, gf: 3, ga: 2 }],
      upcoming: [], factPackDigest: 'immutable-digest',
    });
    const edited = applyNarrativePatch(edition, {
      lead: { headline: 'Edited headline', dek: 'Edited dek', body: ['Edited lead body.'] },
      games: [{ gameId: game.id, headline: 'Edited game headline', body: ['Edited game body.'] }],
    });
    expect(edited.lead.headline).toBe('Edited headline');
    expect(edited.games[0].homeScore).toBe(edition.games[0].homeScore);
    expect(edited.games[0].contributors).toEqual(edition.games[0].contributors);
    expect(edited.numbers).toEqual(edition.numbers);
    expect(edited.standings).toEqual(edition.standings);
    expect(edited.source).toEqual(edition.source);
    expect(edited.source.factPackDigest).toBe('immutable-digest');
    expect(() => applyNarrativePatch(edition, {
      lead: { headline: 'A', dek: 'B', body: ['C'] },
      games: [{ gameId: 'other-game', headline: 'D', body: ['E'] }],
    })).toThrow(/exactly match/i);
  });
});
