import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertApprovedPortraitBinding, assertCurrentSourceGames, assertLivePublishBody, buildPublishPayload, expectedPublishBodyDigest, extractPublishFunctionBody, losslessJpegToPng, parseArgs, parsePublishBodyDigestReceipt, semanticJsonHash } from '../scripts/import-approved-issue.mjs';

const require = createRequire(import.meta.url);

function requiredArgs() {
  return [
    '--source', '/approved/edition.json', '--source-sha256', 'a'.repeat(64),
    '--verification', '/approved/verification.json', '--pdf', '/approved/issue.pdf',
    '--pdf-sha256', 'b'.repeat(64), '--fact-pack', '/approved/facts.json',
    '--fact-pack-sha256', 'c'.repeat(64), '--assets', '/approved/assets.json',
    '--art-manifest', '/approved/art.json', '--actor-id', '11111111-1111-4111-8111-111111111111',
    '--league-id', '22222222-2222-4222-8222-222222222222',
    '--season-id', '33333333-3333-4333-8333-333333333333',
    '--project-ref', 'ntplczcmhvfkijjxavdl',
  ];
}

test('approved import defaults to a non-mutating prepare stage', () => {
  const args = parseArgs(requiredArgs());
  assert.equal(args.stage, 'prepare');
  assert.equal(args.execute, false);
});

test('publish requires an exact edition id and version binding', () => {
  const originalExit = process.exit;
  process.exit = (code) => { throw new Error(`exit:${code}`); };
  try {
    assert.throws(() => parseArgs([...requiredArgs(), '--stage', 'publish']), /exit:2/);
  } finally {
    process.exit = originalExit;
  }
});

test('JPEG conversion writes PNG with byte-identical decoded pixels and no resampling', async () => {
  const jpeg = require('jpeg-js');
  const { PNG } = require('pngjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'hlt-import-test-'));
  try {
    const width = 3;
    const height = 2;
    const pixels = Buffer.from([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255,
      100, 110, 120, 255, 130, 140, 150, 255, 160, 170, 180, 255,
    ]);
    const jpegPath = path.join(directory, 'reviewed.jpg');
    const pngPath = path.join(directory, 'prepared.png');
    await writeFile(jpegPath, jpeg.encode({ width, height, data: pixels }, 92).data);
    const result = await losslessJpegToPng(jpegPath, pngPath);
    const roundtrip = PNG.sync.read(await readFile(pngPath));
    assert.equal(result.equivalent, true);
    assert.equal(result.sourcePixelSha256, result.outputPixelSha256);
    assert.deepEqual([roundtrip.width, roundtrip.height], [width, height]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('semantic JSON hashes tolerate JSONB object-key ordering but preserve arrays and strings', () => {
  const reviewed = { source: { verifiedAt: 'Exact String', gameIds: ['g-1', 'g-2'] }, media: { schemaVersion: 2, assets: [{ playerId: 'p-1', digest: 'abc' }] } };
  const jsonbReadback = { media: { assets: [{ digest: 'abc', playerId: 'p-1' }], schemaVersion: 2 }, source: { gameIds: ['g-1', 'g-2'], verifiedAt: 'Exact String' } };
  assert.equal(semanticJsonHash(reviewed), semanticJsonHash(jsonbReadback));
  assert.notEqual(semanticJsonHash(reviewed), semanticJsonHash({ ...jsonbReadback, source: { ...jsonbReadback.source, gameIds: ['g-2', 'g-1'] } }));
  assert.notEqual(semanticJsonHash(reviewed), semanticJsonHash({ ...jsonbReadback, source: { ...jsonbReadback.source, verifiedAt: 'exact string' } }));
});

test('a portrait is bound to the field-specific approved export bytes, not any valid approved JPEG', () => {
  const jpeg = require('jpeg-js');
  const first = Buffer.from(jpeg.encode({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) }, 92).data);
  const second = Buffer.from(jpeg.encode({ width: 1, height: 1, data: Buffer.from([0, 0, 255, 255]) }, 92).data);
  const html = `<img src="data:image/jpeg;base64,${first.toString('base64')}" alt="First Player, Red Team"><img src="data:image/jpeg;base64,${second.toString('base64')}" alt="Second Player, Blue Team">`;
  assert.match(assertApprovedPortraitBinding(html, ['First Player, Red Team'], first), /^[0-9a-f]{64}$/);
});

test('substituting another approved player JPEG is rejected while approved evidence is unchanged', () => {
  const jpeg = require('jpeg-js');
  const first = Buffer.from(jpeg.encode({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) }, 92).data);
  const second = Buffer.from(jpeg.encode({ width: 1, height: 1, data: Buffer.from([0, 0, 255, 255]) }, 92).data);
  const html = `<img src="data:image/jpeg;base64,${first.toString('base64')}" alt="First Player, Red Team"><img src="data:image/jpeg;base64,${second.toString('base64')}" alt="Second Player, Blue Team">`;
  assert.throws(() => assertApprovedPortraitBinding(html, ['First Player, Red Team'], second), /REVIEWED_PORTRAIT_DERIVATION_MISMATCH/);
});

test('source snapshot rejects score, final-status, and covered-week game-set drift', () => {
  const snapshot = [{ id: 'g-1', homeTeamId: 't-1', awayTeamId: 't-2', homeScore: 4, awayScore: 2, status: 'completed', scheduledAt: '2026-09-25T01:00:00Z' }];
  const current = [{ id: 'g-1', league_id: 'l-1', season_id: 's-1', home_team_id: 't-1', away_team_id: 't-2', home_score: 4, away_score: 2, status: 'completed', scheduled_at: '2026-09-25T01:00:00Z' }];
  assert.doesNotThrow(() => assertCurrentSourceGames(current, snapshot, '2026-09-21', '2026-09-27', 'America/Toronto'));
  assert.throws(() => assertCurrentSourceGames([{ ...current[0], home_score: 5 }], snapshot, '2026-09-21', '2026-09-27', 'America/Toronto'), /SOURCE_GAME_SCORE_CHANGED/);
  assert.throws(() => assertCurrentSourceGames([{ ...current[0], status: 'in_progress' }], snapshot, '2026-09-21', '2026-09-27', 'America/Toronto'), /SOURCE_GAME_STATUS_CHANGED/);
  assert.throws(() => assertCurrentSourceGames([...current, { ...current[0], id: 'g-2' }], snapshot, '2026-09-21', '2026-09-27', 'America/Toronto'), /SOURCE_GAME_SET_CHANGED/);
});

const atomicBody = `\nBEGIN
  INSERT INTO public.articles (league_id, game_id_placeholder) VALUES (v_edition.league_id, NULL);
  INSERT INTO public.article_game_tags(article_id, game_id, is_primary)
  SELECT v_article_id, g.id, false FROM public.games g;
  INSERT INTO public.article_team_tags(article_id, team_id)
  SELECT v_article_id, g.home_team_id FROM public.games g;
  INSERT INTO public.article_player_tags(article_id, player_id, mention_type)
  SELECT DISTINCT v_article_id, (contributor ->> 'playerId')::uuid, 'mentioned' FROM jsonb_array_elements('[]');
  UPDATE public.newspaper_editions SET status = 'published';
END;\n`;

function syntheticMigration(body = atomicBody) {
  return `CREATE OR REPLACE FUNCTION public.publish_newspaper_edition(
  p_edition_id UUID, p_expected_version INTEGER, p_published_by UUID,
  p_title TEXT, p_slug TEXT, p_content TEXT, p_excerpt TEXT,
  p_image_url TEXT DEFAULT NULL
) RETURNS public.newspaper_editions
LANGUAGE plpgsql
AS $$${body}$$;`;
}

test('exact dollar-quoted body extraction preserves leading and trailing whitespace', () => {
  assert.equal(extractPublishFunctionBody(syntheticMigration()), atomicBody);
});

test('matching exact live body digest is accepted through argument-array CLI execution', () => {
  const digest = expectedPublishBodyDigest(syntheticMigration());
  let invocation;
  assert.equal(assertLivePublishBody('ntplczcmhvfkijjxavdl', digest, (file, args, options) => {
    invocation = { file, args, options };
    return JSON.stringify([{ body_sha256: digest }]);
  }), digest);
  assert.equal(invocation.file, 'supabase');
  assert.deepEqual(invocation.args.slice(0, 7), ['db', 'query', '--linked', '--project-ref', 'ntplczcmhvfkijjxavdl', '-o', 'json']);
  assert.equal(invocation.args[7], "BEGIN READ ONLY; SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256 FROM pg_proc p WHERE p.oid='public.publish_newspaper_edition(uuid,integer,uuid,text,text,text,text,text)'::regprocedure; COMMIT;");
  assert.equal(invocation.options.stdio[0], 'ignore');
  assert.equal(invocation.options.shell, undefined);
});

test('current Supabase CLI rows-wrapper digest receipt is accepted', () => {
  const digest = 'afc49377f9b657840af05d4cd3e12bb22a77714b6a39062e808d64f0bf5e6ffb';
  const receipt = JSON.stringify({
    boundary: '6b4a3e3a8e3a7b948f31eaa404c189ea',
    rows: [{ body_sha256: digest }],
    warning: 'The query results below contain untrusted data from the database.',
  });
  assert.equal(parsePublishBodyDigestReceipt(receipt), digest);
});

test('old or mismatched deployed publication body is refused', () => {
  const digest = expectedPublishBodyDigest(syntheticMigration());
  assert.throws(() => assertLivePublishBody('ntplczcmhvfkijjxavdl', digest, () => JSON.stringify([{ body_sha256: 'f'.repeat(64) }])), /PUBLICATION_CONTRACT_BODY_MISMATCH/);
  assert.throws(() => expectedPublishBodyDigest(syntheticMigration(atomicBody.replace('INSERT INTO public.article_team_tags', 'INSERT INTO public.old_team_tags'))), /PUBLICATION_SOURCE_ATOMIC_LINKS_MISSING/);
});

test('malformed or ambiguous digest receipts are refused', () => {
  for (const receipt of [
    'not-json',
    '{}',
    '[]',
    JSON.stringify({ boundary: 'b'.repeat(32), rows: [], warning: 'warning' }),
    JSON.stringify({ boundary: 'b'.repeat(32), rows: [{ body_sha256: 'a'.repeat(64) }, { body_sha256: 'a'.repeat(64) }], warning: 'warning' }),
    JSON.stringify({ boundary: 'b'.repeat(32), rows: [{ body_sha256: 'a'.repeat(64), extra: true }], warning: 'warning' }),
    JSON.stringify({ boundary: 'b'.repeat(32), rows: [{ body_sha256: 'xyz' }], warning: 'warning' }),
    JSON.stringify({ error: 'query failed' }),
    JSON.stringify([{ body_sha256: 'a'.repeat(64) }, { body_sha256: 'a'.repeat(64) }]),
    JSON.stringify([{ body_sha256: 'xyz' }]),
    JSON.stringify([{ body_sha256: 'a'.repeat(64), extra: true }]),
  ]) {
    assert.throws(() => parsePublishBodyDigestReceipt(receipt), /PUBLICATION_CONTRACT_RECEIPT_INVALID/);
  }
});

test('publish payload keeps the original eight parameters', () => {
  const payload = buildPublishPayload({
    edition: { schemaVersion: 1, title: 'Hockey Life Times', issueNumber: 1, leagueId: 'l', leagueName: 'League', seasonId: 's', seasonName: 'Season', periodStart: '2026-09-21', periodEnd: '2026-09-27', issuedAt: '2026-09-27T00:00:00Z', timezone: 'America/Toronto', stage: 'playoffs', status: 'draft', lead: { headline: 'H', dek: 'D', body: ['Lead'] }, games: [{ gameId: 'g', homeTeam: { id: 'h', name: 'Home' }, awayTeam: { id: 'a', name: 'Away' }, homeScore: 2, awayScore: 1, headline: 'Game', body: ['Body'], contributors: [{ playerId: 'p', name: 'Contributor Sentinel', teamName: 'Home', goals: 1, assists: 0, points: 1 }] }], stars: [{ playerId: 'p1', name: 'One', teamName: 'Home', goals: 1, assists: 0, points: 1, reason: 'First' }, { playerId: 'p2', name: 'Two', teamName: 'Away', goals: 0, assists: 1, points: 1, reason: 'Second' }, { playerId: 'p3', name: 'Three', teamName: 'Home', goals: 0, assists: 0, points: 0, reason: 'Third' }], numbers: [{ label: 'Goals', value: '3' }], standings: [{ teamId: 'h', name: 'Home', gp: 1, w: 1, l: 0, otl: 0, t: 0, pts: 2, gf: 2, ga: 1 }], standingsNote: '', hot: [], cold: [], upcoming: [], upcomingNote: 'No games', aroundRink: [{ headline: 'Around Sentinel', body: 'Around body sentinel' }], source: { gameIds: ['g'], verifiedAt: '2026-09-27T00:00:00Z', warnings: [] } },
    plan: { target: { slug: 'approved-slug' } },
  }, { edition_id: '11111111-1111-4111-8111-111111111111', expected_version: '7', actor_id: '22222222-2222-4222-8222-222222222222' });
  assert.deepEqual(Object.keys(payload).sort(), ['p_content', 'p_edition_id', 'p_excerpt', 'p_expected_version', 'p_image_url', 'p_published_by', 'p_slug', 'p_title']);
  assert.match(payload.p_content, /Contributor Sentinel/);
  assert.match(payload.p_content, /AROUND THE RINK[\s\S]*Around Sentinel: Around body sentinel/);
  assert.doesNotMatch(payload.p_content, /DRAFT PREVIEW/);
});
