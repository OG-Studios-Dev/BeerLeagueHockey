import { bindHockeyLifeTimesBracketFacts, buildHockeyLifeTimesArticleTitle } from '../article-title';

describe('Hockey Life Times article titles', () => {
  it('matches the exact live Fall issue metadata and normalizes the known season word', () => {
    expect(buildHockeyLifeTimesArticleTitle({
      seasonName: 'FALL 2026',
      seasonStart: '2026-10-01',
      periodStart: '2026-09-28',
      games: [
        { gameType: 'regular', roundNumber: 1, bracketRoundCount: null },
        { gameType: 'regular', roundNumber: 1, bracketRoundCount: null },
      ],
    })).toBe('HLT: Week 1 - Fall 2026');
  });

  it('preserves custom season names while normalizing only known standalone season labels', () => {
    expect(buildHockeyLifeTimesArticleTitle({
      seasonName: 'FALL CLASSIC',
      seasonStart: '2026-10-01',
      periodStart: '2026-09-28',
      games: [{ gameType: 'regular', roundNumber: 1, bracketRoundCount: null }],
    })).toBe('HLT: Week 1 - FALL CLASSIC 2026');
  });

  it('uses the season schedule week instead of the global issue sequence', () => {
    expect(buildHockeyLifeTimesArticleTitle({
      seasonName: 'Fall',
      seasonStart: '2026-09-09',
      periodStart: '2026-09-21',
      games: [{ gameType: 'regular', roundNumber: null, bracketRoundCount: null }],
    })).toBe('HLT: Week 3 - Fall 2026');
  });

  it('preserves a source season name that already includes its year', () => {
    expect(buildHockeyLifeTimesArticleTitle({
      seasonName: 'Fall 2026',
      seasonStart: '2026-09-09',
      periodStart: '2026-09-07',
      games: [{ gameType: null, roundNumber: null, bracketRoundCount: null }],
    })).toBe('HLT: Week 1 - Fall 2026');
  });

  it.each([
    [1, 1, 'HLT: Championships - Fall 2026'],
    [1, 2, 'HLT: Semis - Fall 2026'],
    [2, 2, 'HLT: Championships - Fall 2026'],
    [2, 3, 'HLT: Semis - Fall 2026'],
    [3, 3, 'HLT: Championships - Fall 2026'],
  ])('labels playoff round %s of %s from the authoritative bracket', (roundNumber, bracketRoundCount, expected) => {
    expect(buildHockeyLifeTimesArticleTitle({
      seasonName: 'Fall',
      seasonStart: '2026-09-09',
      periodStart: '2026-11-02',
      games: [{ gameType: 'playoff', roundNumber, bracketRoundCount }],
    })).toBe(expected);
  });

  it('derives two-team finals, four-team semis, and eight-team penultimate rounds from standard brackets', () => {
    const cases = [
      { rounds: 1, round: 1, expected: 'Championships' },
      { rounds: 2, round: 1, expected: 'Semis' },
      { rounds: 3, round: 2, expected: 'Semis' },
    ];
    for (const bracket of cases) {
      const series = Array.from({ length: bracket.rounds }, (_, index) => ({
        id: `series-${index + 1}`, divisionId: 'division-a', roundNumber: index + 1,
      }));
      const facts = bindHockeyLifeTimesBracketFacts([
        { id: 'game-1', gameType: 'playoff', roundNumber: bracket.round, playoffSeriesId: `series-${bracket.round}` },
      ], series);
      expect(buildHockeyLifeTimesArticleTitle({
        seasonName: 'Fall', seasonStart: '2026-10-01', periodStart: '2026-11-02', games: facts,
      })).toBe(`HLT: ${bracket.expected} - Fall 2026`);
    }
  });

  it('counts rounds inside the linked division rather than taking a league-wide maximum', () => {
    const facts = bindHockeyLifeTimesBracketFacts([
      { id: 'game-a', gameType: 'playoff', roundNumber: 2, playoffSeriesId: 'a-final' },
    ], [
      { id: 'a-semi', divisionId: 'division-a', roundNumber: 1 },
      { id: 'a-final', divisionId: 'division-a', roundNumber: 2 },
      { id: 'b-quarter', divisionId: 'division-b', roundNumber: 1 },
      { id: 'b-semi', divisionId: 'division-b', roundNumber: 2 },
      { id: 'b-final', divisionId: 'division-b', roundNumber: 3 },
    ]);
    expect(facts).toEqual([{ gameType: 'playoff', roundNumber: 2, bracketRoundCount: 2 }]);
  });

  it('rejects missing series links instead of guessing from legacy round numbers', () => {
    expect(() => bindHockeyLifeTimesBracketFacts([
      { id: 'legacy-game', gameType: 'playoff', roundNumber: 99, playoffSeriesId: null },
    ], [])).toThrow(/authoritative playoff series/i);
  });

  it.each(['Semis', 'Championships'] as const)('uses an explicit owner-selected %s phase only for the title', (playoffPhase) => {
    expect(buildHockeyLifeTimesArticleTitle({
      seasonName: 'Summer 2026',
      seasonStart: '2026-05-01',
      periodStart: '2026-09-21',
      games: [{ gameType: 'playoff', roundNumber: null, bracketRoundCount: null }],
      playoffPhase,
    })).toBe(`HLT: ${playoffPhase} - Summer 2026`);
  });

  it.each([
    ['an unsupported early playoff round', [
      { gameType: 'playoff', roundNumber: 1, bracketRoundCount: 4 },
    ]],
    ['missing bracket evidence', [
      { gameType: 'playoff', roundNumber: 2, bracketRoundCount: null },
    ]],
    ['mixed playoff stages', [
      { gameType: 'playoff', roundNumber: 2, bracketRoundCount: 3 },
      { gameType: 'playoff', roundNumber: 3, bracketRoundCount: 3 },
    ]],
    ['mixed regular and playoff games', [
      { gameType: 'regular', roundNumber: null, bracketRoundCount: null },
      { gameType: 'playoff', roundNumber: 3, bracketRoundCount: 3 },
    ]],
    ['an unknown game type', [
      { gameType: 'exhibition', roundNumber: null, bracketRoundCount: null },
    ]],
    ['an invalid zero-round bracket', [
      { gameType: 'playoff', roundNumber: 0, bracketRoundCount: 0 },
    ]],
  ])('fails closed for %s', (_label, games) => {
    expect(() => buildHockeyLifeTimesArticleTitle({
      seasonName: 'Fall',
      seasonStart: '2026-09-09',
      periodStart: '2026-11-02',
      games,
    })).toThrow(/title/i);
  });
});
