import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderNewspaperHtml, renderNewspaperText, validateNewspaperEdition, type NewspaperEdition } from '../src/index.ts';

const fixturePath = new URL('../fixtures/validation-edition.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as NewspaperEdition;

test('renders all five required newspaper sections and pages', () => {
  const html = renderNewspaperHtml(fixture);
  assert.equal((html.match(/data-newspaper-page=/g) || []).length, 5);
  for (const heading of ['This Week on the Ice', 'Three Stars of the Week', 'This Week by the Numbers', 'Standings', 'The Heater', 'The Cold Tub', 'Next Week Headlines']) {
    assert.match(html, new RegExp(heading));
  }
});

test('escapes editorial strings and rejects scriptable image protocols', () => {
  const unsafe = structuredClone(fixture);
  unsafe.lead.headline = '<script>globalThis.pwned = true</script>';
  unsafe.lead.imageUrl = 'javascript:alert(1)';
  const html = renderNewspaperHtml(unsafe);
  assert.doesNotMatch(html, /<script>globalThis\.pwned/);
  assert.match(html, /&lt;script&gt;globalThis\.pwned/);
  assert.doesNotMatch(html, /javascript:alert/);
});

test('requires an honest note when upcoming fixtures are absent', () => {
  const invalid = structuredClone(fixture);
  invalid.upcomingNote = '';
  assert.throws(() => validateNewspaperEdition(invalid), /upcomingNote is required/);
  assert.match(renderNewspaperHtml(fixture), /No scheduled fixtures/);
  assert.equal((renderNewspaperText(fixture).match(/The validation edition intentionally contains no scheduled fixtures/g) || []).length, 1);
});

test('fails loudly when required game data is absent', () => {
  const invalid = structuredClone(fixture);
  invalid.games = [];
  assert.throws(() => renderNewspaperHtml(invalid), /games must contain at least one completed game/);
});

test('plain-text fallback is complete and native-readable', () => {
  const text = renderNewspaperText(fixture);
  assert.match(text, /DRAFT PREVIEW - NOT PUBLISHED/);
  assert.match(text, /NO SCHEDULED FIXTURES/);
  assert.match(text, /Alexandria Montgomery-Smythe/);
  assert.match(text, /Jean-Luc O'Rourke-Test, Visitors With A Remarkably Long Name: 2 G, 0 A, 2 P/);
  assert.doesNotMatch(text, /<article|<style/);
});

test('renders the complete approved editorial extension in HTML and text', () => {
  const edition = structuredClone(fixture) as NewspaperEdition;
  edition.upcoming = [{
    gameId: 'next-game', homeName: 'Bad Bunny', awayName: 'Liuna Premier',
    scheduledAt: '2026-10-09T02:15:00+00:00', headline: 'Liuna Premier at Bad Bunny',
    body: 'Legacy summary.', line: 'HLT line: Bad Bunny -150 / Liuna Premier +150',
    pick: "Columnist's pick: Bad Bunny 5-3",
    bodyParagraphs: ['First approved preview paragraph.', 'Second approved preview paragraph.'],
  }];
  edition.upcomingNote = 'Approved fictional-lines disclaimer.';
  edition.editorial = {
    standings: {
      headline: 'Enjoy the View; You Have Not Bought the Place',
      body: ['First approved standings paragraph.', 'Second approved standings paragraph.'],
    },
    upcoming: { heading: 'Next Week Headlines - Thursday, October 8' },
    sourceNote: ['Scores and contributions were checked.', 'No individual performance is invented.'],
  };

  for (const rawOutput of [renderNewspaperHtml(edition), renderNewspaperText(edition)]) {
    const output = rawOutput.replaceAll('&#39;', "'");
    for (const expected of [
      'Enjoy the View; You Have Not Bought the Place',
      'First approved standings paragraph.',
      'Second approved standings paragraph.',
      'Next Week Headlines - Thursday, October 8',
      'Approved fictional-lines disclaimer.',
      'HLT line: Bad Bunny -150 / Liuna Premier +150',
      "Columnist's pick: Bad Bunny 5-3",
      'First approved preview paragraph.',
      'Second approved preview paragraph.',
      'Scores and contributions were checked.',
      'No individual performance is invented.',
    ]) assert.match(output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('text fallback retains upcomingNote even when fixtures exist', () => {
  const edition = structuredClone(fixture);
  edition.upcoming = [{
    gameId: 'next-game', homeName: 'Home', awayName: 'Away',
    scheduledAt: '2026-10-09T02:15:00+00:00', headline: 'Next game', body: 'Scheduled.',
  }];
  edition.upcomingNote = 'This disclaimer must remain visible.';
  const text = renderNewspaperText(edition);
  assert.match(text, /This disclaimer must remain visible\./);
  assert.equal((text.match(/This disclaimer must remain visible\./g) || []).length, 1);
  const html = renderNewspaperHtml(edition);
  assert.ok(html.indexOf('Next game') < html.indexOf('This disclaimer must remain visible.'));
});

test('a partial standings extension preserves the legacy upcoming layout and tail', () => {
  const edition = structuredClone(fixture) as NewspaperEdition;
  edition.editorial = { standings: { headline: 'Editorial standings', body: ['Exact standings context.'] } };
  edition.upcoming = [{
    gameId: 'legacy-next', homeName: 'Home', awayName: 'Away', scheduledAt: '2026-10-09T02:15:00+00:00',
    headline: 'Legacy next game', body: 'Legacy scheduled-game copy.',
  }];
  edition.upcomingNote = 'Legacy note remains after the cards.';
  const html = renderNewspaperHtml(edition);
  assert.match(html, /Around the Rink/);
  assert.match(html, /The issue in brief/);
  assert.doesNotMatch(html, /<div class="upcoming-grid upcoming-grid--editorial">/);
  assert.ok(html.indexOf('Legacy next game') < html.indexOf('Legacy note remains after the cards.'));
});

test('rejects unknown and malformed editorial extension keys', () => {
  const unknown = structuredClone(fixture) as NewspaperEdition & { editorial: Record<string, unknown> };
  unknown.editorial = { surprise: 'not allowed' };
  assert.throws(() => validateNewspaperEdition(unknown), /editorial contains unknown key surprise/);

  const malformed = structuredClone(fixture) as NewspaperEdition;
  malformed.editorial = { standings: { headline: 'Heading', body: [] } };
  assert.throws(() => validateNewspaperEdition(malformed), /editorial\.standings\.body/);
});

test('keeps provenance in data but out of reader-facing HTML and text', () => {
  const html = renderNewspaperHtml(fixture);
  const text = renderNewspaperText(fixture);
  for (const output of [html, text]) {
    assert.doesNotMatch(output, /fixture-game-one/);
    assert.doesNotMatch(output, /TEST FIXTURE ONLY/);
    assert.doesNotMatch(output, /2026-09-27T12:00:00-04:00/);
    assert.doesNotMatch(output, /source warning/i);
  }
  assert.match(html, /Fixture Hockey League With A Deliberately Long Name · Renderer Validation Season 2026/);
});

test('adapts dense editorial regions without dropping content', () => {
  const dense = structuredClone(fixture);
  dense.games[1].contributors = Array.from({ length: 16 }, (_, index) => ({
    playerId: `dense-${index}`,
    name: `Complete Contributor ${index + 1}`,
    teamName: index % 2 ? 'Quotation Mark Athletic Club' : 'Ampersands & Angle Brackets',
    goals: index % 4,
    assists: index % 3,
    points: (index % 4) + (index % 3),
  }));
  dense.numbers[1].value = '5 G · 2 A · 7 P';
  dense.upcomingNote = 'NEXT WEEK HEADLINES — Fixtures unscheduled. The schedule remains empty.';
  const html = renderNewspaperHtml(dense);
  assert.match(html, /game-report--dense/);
  assert.match(html, /number-long/);
  assert.equal((html.match(/Complete Contributor/g) || []).length, 16);
  assert.equal((html.match(/Next Week Headlines/gi) || []).length, 1);
  assert.match(html, /Reading the table/);
  assert.match(html, /The issue in brief/);
});

test('renders fixture instants in Toronto local time across daylight-saving offsets', () => {
  const edition = structuredClone(fixture);
  edition.upcoming = [
    {
      gameId: 'next-game', homeName: 'Home', awayName: 'Away',
      scheduledAt: '2026-09-29T01:00:00+00:00', headline: 'Next game', body: 'Scheduled.',
    },
    {
      gameId: 'winter-game', homeName: 'Home', awayName: 'Away',
      scheduledAt: '2026-12-01T01:00:00+00:00', headline: 'Winter game', body: 'Scheduled.',
    },
  ];
  const html = renderNewspaperHtml(edition);
  const text = renderNewspaperText(edition);
  assert.match(html, /Sep 28, 2026 · 21:00/);
  assert.match(text, /Sep 28, 2026 · 21:00/);
  assert.match(html, /Nov 30, 2026 · 20:00/);
  assert.doesNotMatch(html, /Sep 29, 2026 · 01:00/);
});

test('dates generated standings to their Toronto snapshot while preserving truthful legacy copy', () => {
  assert.match(renderNewspaperHtml(fixture), /Official table through 2026-09-27/);

  const laterSnapshot = structuredClone(fixture);
  laterSnapshot.periodEnd = '2026-09-20';
  laterSnapshot.source.standingsAsOf = '2026-09-27';
  const html = renderNewspaperHtml(laterSnapshot);
  assert.match(html, /Official table snapshot as of 2026-09-27/);
  assert.doesNotMatch(html, /Official table through 2026-09-20/);
});
