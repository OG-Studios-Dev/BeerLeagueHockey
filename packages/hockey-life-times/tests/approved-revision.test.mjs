import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildPreflightSql, buildRevisionSql, parsePreflightTransport, prepareApprovedRevision } from '../scripts/prepare-approved-revision.mjs';

const fixture = (name) => new URL(`./fixtures/approved-revision/${name}`, import.meta.url);
const baseline = JSON.parse(await readFile(fixture('baseline.json'), 'utf8'));
const factsBytes = await readFile(fixture('facts.json'));
const facts = JSON.parse(factsBytes.toString('utf8'));
const manuscript = await readFile(fixture('reviewed-draft.md'), 'utf8');
const receipt = JSON.parse(await readFile(fixture('proof-receipt.json'), 'utf8'));
const pdfBytes = await readFile(fixture('approved-proof.pdf'));

test('exact approved manuscript maps onto the frozen published baseline', () => {
  const result = prepareApprovedRevision({ baseline, facts, factsBytes, manuscript, receipt, pdfBytes });
  assert.equal(result.edition.id, undefined);
  assert.equal(result.edition.status, 'published');
  assert.equal(result.edition.numbers.length, 5);
  assert.equal(Object.keys(result.scoringFacts).length, 24);
  assert.deepEqual(result.edition.numbers.map((row) => row.value), ['15 goals', '4-goal margin', '3 points each', '1 goal, 4 assists', '2 games']);
  assert.equal(result.edition.games[0].gameId, baseline.editions[0].edition_json.games[0].gameId);
  assert.deepEqual(result.edition.source, baseline.editions[0].edition_json.source);
  assert.deepEqual(result.edition.media, baseline.editions[0].edition_json.media);
  assert.match(result.text, /fictional Vegas-style lines/);
  assert.match(result.text, /Bad Bunny -150 \/ Liuna Premier \+150/);
  assert.match(result.text, /Bad Bunny's opening-game goalie is not identified/);
  assert.doesNotMatch(result.text, /No published article or live generator was changed/);

  const approvedParagraphs = manuscript.split('\n---')[0].split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/^(?:#|\*|- \*\*|Editorial review draft)/.test(paragraph));
  const normalizedText = result.text.replace(/[\u2010-\u2015\u2212]/g, '-');
  for (const paragraph of approvedParagraphs) {
    assert.match(normalizedText, new RegExp(paragraph.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('approval is bound to the actual reviewed PDF bytes', () => {
  assert.throws(() => prepareApprovedRevision({ baseline, facts, factsBytes, manuscript, receipt, pdfBytes: Buffer.from('not the approved PDF') }), /APPROVAL_RECEIPT_MISMATCH/);
  assert.throws(() => prepareApprovedRevision({ baseline, facts, factsBytes: Buffer.from('{}'), manuscript, receipt, pdfBytes }), /FACT_PACK_HASH_MISMATCH/);
});

test('read-only preflight binds live values to the saved baseline snapshot', () => {
  const sql = buildPreflightSql(baseline);
  assert.match(sql, /baseline_edition_matches/);
  assert.match(sql, /baseline_content_matches/);
  assert.match(sql, /baseline_excerpt_matches/);
  assert.match(sql, new RegExp(baseline.editions[0].id));
  assert.match(sql, /extensions\.digest/);
  const rehearsal = buildPreflightSql(baseline, true);
  assert.match(rehearsal, /^BEGIN;\nSET LOCAL lock_timeout/);
  assert.match(rehearsal, /ROLLBACK;\n$/);
  assert.doesNotMatch(rehearsal.slice(0, rehearsal.lastIndexOf('ROLLBACK;')), /(^|\n)COMMIT;\s*$/m);
});

test('behavior rehearsal executes ACL controls and mutation as service_role under one rollback', () => {
  const prepared = prepareApprovedRevision({ baseline, facts, factsBytes, manuscript, receipt, pdfBytes });
  const sql = buildRevisionSql(prepared, { edition_sha256: 'a'.repeat(64), content_sha256: 'b'.repeat(64) }, false);
  assert.match(sql, /^BEGIN;\nSET LOCAL lock_timeout/);
  assert.match(sql, /SET LOCAL ROLE anon;/);
  assert.match(sql, /SET LOCAL ROLE authenticated;/);
  assert.match(sql, /SET LOCAL ROLE service_role;\nSELECT id/);
  assert.match(sql, /ROLLBACK;\n$/);
  assert.doesNotMatch(sql.slice(0, sql.lastIndexOf('ROLLBACK;')), /(^|\n)COMMIT;\s*$/m);
});

test('strict preflight transport accepts only the saved CLI envelope and exact row', () => {
  const row = { article_id: 'a', edition_id: 'e', version: 1 };
  assert.deepEqual(parsePreflightTransport(JSON.stringify({ boundary: 'a'.repeat(32), rows: [row], warning: 'untrusted' }), ['article_id', 'edition_id', 'version']), row);
  for (const invalid of [JSON.stringify({ rows: [row] }), JSON.stringify([row]), JSON.stringify({ boundary: 'a'.repeat(32), rows: [row, row], warning: 'x' }), 'nope']) {
    assert.throws(() => parsePreflightTransport(invalid, ['article_id', 'edition_id', 'version']), /PREFLIGHT_TRANSPORT_INVALID/);
  }
});
