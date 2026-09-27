import {
  renderNewspaperHtml,
  validateNewspaperEdition,
  type NewspaperEdition,
} from '../../../../../../packages/hockey-life-times/src/index';

const edition: NewspaperEdition = {
  schemaVersion: 1, title: 'Hockey Life Times', issueNumber: '7',
  leagueId: 'league', leagueName: 'Hockey Life', seasonId: 'season', seasonName: 'Fall',
  periodStart: '2026-09-21', periodEnd: '2026-09-27', issuedAt: '2026-09-27T12:00:00Z',
  timezone: 'America/Toronto', stage: 'regular', status: 'draft',
  lead: { headline: 'Verified week', dek: 'Facts first.', body: ['Every score was checked.'] },
  games: [{
    gameId: 'game', homeTeam: { id: 'home', name: 'Home' }, awayTeam: { id: 'away', name: 'Away' },
    homeScore: 3, awayScore: 2, headline: 'Home wins', body: ['Home beat Away 3-2.'],
    contributors: [{ playerId: 'player', name: 'Player', teamName: 'Home', goals: 1, assists: 0, points: 1 }],
  }],
  stars: [
    { playerId: 'player-1', name: 'Player One', teamName: 'Home', goals: 1, assists: 0, points: 1, reason: 'One verified goal.' },
    { playerId: 'player-2', name: 'Player Two', teamName: 'Home', goals: 1, assists: 0, points: 1, reason: 'One verified goal.' },
    { playerId: 'player-3', name: 'Player Three', teamName: 'Home', goals: 1, assists: 0, points: 1, reason: 'One verified goal.' },
  ],
  numbers: [{ label: 'Goals', value: '5' }],
  standings: [{ teamId: 'home', name: 'Home', gp: 1, w: 1, l: 0, otl: 0, t: 0, pts: 2, gf: 3, ga: 2 }],
  standingsNote: 'Canonical standings.', hot: [], cold: [], upcoming: [], upcomingNote: 'No fixtures.',
  source: { gameIds: ['game'], verifiedAt: '2026-09-27T12:00:00Z', warnings: [] },
};

it('passes the shared parser and renders escaped five-page preview HTML', () => {
  expect(() => validateNewspaperEdition(edition)).not.toThrow();
  const html = renderNewspaperHtml({ ...edition, lead: { ...edition.lead, headline: '<script>alert(1)</script>' } });
  expect(html.match(/data-newspaper-page=/g)).toHaveLength(5);
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
});
