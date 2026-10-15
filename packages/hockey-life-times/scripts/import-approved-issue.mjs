#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderNewspaperText, validateNewspaperEdition } from '../src/index.ts';

const PRIVATE_BUCKET = 'newspaper-media-private';
const PUBLIC_BUCKET = 'newspaper-media-public';
const MEDIA_HOST = 'ntplczcmhvfkijjxavdl.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const STAGES = new Set(['prepare', 'draft', 'publish']);
const PROJECT_REF = /^[a-z0-9]{20}$/;
// Frozen receipt from the approved export evidence. Each key is the manifest-
// bound original PNG; each value is the exact Pillow derivative produced by
// assemble-review.py (RGBA over #f4eee0, RGB JPEG, quality 92, 4:4:4,
// optimize=true, no resize) and embedded in the reviewed export.
const APPROVED_PORTRAIT_DERIVATIVES = new Map([
  ['2203a9835c8e8f1c0b70cc8988556889f3c00093eb74df68935386230d4581dd', { jpegSha256: '72bcb86690dce8afea9b6fdd59c5c47618535bf51609b89d512b8825dd7fb328', pixelSha256: '0eda27090aff355d9b94a6b330b812ef3957ef5717d071f1c23400425295d009' }],
  ['6baa539a75a6db3acce63aa18e4379557e4d867b26b8520dff11cefed43af856', { jpegSha256: '842c7ea3a3df542429ce961dd41c1962a49875896fc9cc410df97bcb87725bb0', pixelSha256: 'b015edda229abb279ca2f542b313aafebbc3178394d0e923141b4c70cd972962' }],
  ['147251881352c2f37b5a0950b42baea7924fe564cadf27be760478968a3cd42f', { jpegSha256: 'bb44348f519def16cab6bf688a37a72a9e996dad1df5b8d3828a0f05a9b97d31', pixelSha256: 'c6811cd2f0d0db4a56707a16d37ab3884685fa6abb23a4eba904925a270576d2' }],
  ['704585bacc5b24089b3016a4f73cce49cc445b865d792857f4d6cfc11af9e3b3', { jpegSha256: 'e8be070c4b724254bb8325a3d440b9779c1cb07ef60ee4eb7888b4c0a06971e9', pixelSha256: '7bb5cc6b6ad733f6bbe5327d5bd96e67f88783fdc0d7b13e458836bd8308960c' }],
]);
const PUBLISH_MIGRATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations/20260927100000_hockey_life_times_editions.sql');
const PUBLISH_BODY_QUERY = "BEGIN READ ONLY; SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256 FROM pg_proc p WHERE p.oid='public.publish_newspaper_edition(uuid,integer,uuid,text,text,text,text,text)'::regprocedure; COMMIT;";
const require = createRequire(import.meta.url);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(`Usage: node packages/hockey-life-times/scripts/import-approved-issue.mjs [options]

Required for every stage:
  --source <edition-render.json>       --source-sha256 <sha256>
  --verification <verification.json>  --pdf <reviewed.pdf>
  --pdf-sha256 <sha256>                --fact-pack <fact-pack.json>
  --fact-pack-sha256 <sha256>          --assets <facts/assets.json>
  --art-manifest <illustrations/manifest.json>
  --actor-id <auth UUID>               --league-id <UUID>
  --season-id <UUID>                   --project-ref <Supabase ref>

Control:
  --stage prepare|draft|publish        default: prepare
  --execute                            opt in to storage/RPC writes
  --edition-id <UUID>                  binds an existing draft or publish target
  --expected-version <integer>         required for publish
  --plan <json>                        machine-readable plan output
  --prepared-edition <json>            transformed draft output
  --result <json>                      execution/dry-run result output

Credentials are read only from the current process environment when live
readback or --execute is possible. No .env file is loaded.
`);
  process.exit(message ? 2 : 0);
}

export function parseArgs(argv) {
  const args = { stage: 'prepare', execute: false };
  const boolean = new Set(['--execute']);
  const valued = new Set([
    '--stage', '--source', '--source-sha256', '--verification', '--pdf', '--pdf-sha256',
    '--fact-pack', '--fact-pack-sha256', '--assets', '--art-manifest', '--actor-id',
    '--league-id', '--season-id', '--project-ref', '--edition-id', '--expected-version',
    '--plan', '--prepared-edition', '--result',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') usage();
    if (boolean.has(token)) args[token.slice(2)] = true;
    else if (valued.has(token)) {
      if (!argv[index + 1]) usage(`Missing value for ${token}`);
      args[token.slice(2).replaceAll('-', '_')] = argv[++index];
    } else usage(`Unknown option: ${token}`);
  }
  const required = ['source', 'source_sha256', 'verification', 'pdf', 'pdf_sha256', 'fact_pack', 'fact_pack_sha256', 'assets', 'art_manifest', 'actor_id', 'league_id', 'season_id', 'project_ref'];
  for (const key of required) if (!args[key]) usage(`Missing --${key.replaceAll('_', '-')}`);
  if (!STAGES.has(args.stage)) usage('Invalid --stage');
  for (const key of ['source_sha256', 'pdf_sha256', 'fact_pack_sha256']) if (!SHA256.test(args[key])) usage(`Invalid --${key.replaceAll('_', '-')}`);
  for (const key of ['actor_id', 'league_id', 'season_id']) if (!UUID.test(args[key])) usage(`Invalid --${key.replaceAll('_', '-')}`);
  if (args.execute && args.actor_id === '00000000-0000-4000-8000-000000000000') usage('--execute requires the real authenticated actor UUID');
  if (!PROJECT_REF.test(args.project_ref)) usage('Invalid --project-ref');
  if (args.project_ref !== MEDIA_HOST.split('.')[0]) usage('The approved media contract is bound to the reviewed Supabase project');
  if (args.edition_id && !UUID.test(args.edition_id)) usage('Invalid --edition-id');
  if (args.stage === 'publish' && (!args.edition_id || !/^\d+$/.test(args.expected_version || ''))) usage('Publish requires --edition-id and --expected-version');
  return args;
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Semantic JSON hash: object key order is ignored; array and string bytes are preserved. */
export const semanticJsonHash = (value) => hash(Buffer.from(canonicalJson(value)));

export function extractPublishFunctionBody(sql) {
  const marker = 'CREATE OR REPLACE FUNCTION public.publish_newspaper_edition(';
  const start = sql.indexOf(marker);
  if (start < 0 || sql.indexOf(marker, start + marker.length) >= 0) fail('PUBLICATION_SOURCE_FUNCTION_AMBIGUOUS');
  const returnsAt = sql.indexOf(') RETURNS public.newspaper_editions', start + marker.length);
  if (returnsAt < 0) fail('PUBLICATION_SOURCE_SIGNATURE_INVALID');
  const parameters = sql.slice(start + marker.length, returnsAt).replace(/\s+/g, ' ').trim();
  const expected = 'p_edition_id UUID, p_expected_version INTEGER, p_published_by UUID, p_title TEXT, p_slug TEXT, p_content TEXT, p_excerpt TEXT, p_image_url TEXT DEFAULT NULL';
  if (parameters !== expected) fail('PUBLICATION_SOURCE_SIGNATURE_INVALID');
  const asMatch = /\bAS\s+(\$[A-Za-z0-9_]*\$)/g;
  asMatch.lastIndex = returnsAt;
  const delimiter = asMatch.exec(sql);
  if (!delimiter) fail('PUBLICATION_SOURCE_BODY_MISSING');
  const bodyStart = delimiter.index + delimiter[0].length;
  const bodyEnd = sql.indexOf(delimiter[1], bodyStart);
  if (bodyEnd < 0) fail('PUBLICATION_SOURCE_BODY_MISSING');
  return sql.slice(bodyStart, bodyEnd);
}

export function assertAtomicPublishBody(body) {
  const gameInsert = body.indexOf('INSERT INTO public.article_game_tags(article_id, game_id, is_primary)');
  const teamInsert = body.indexOf('INSERT INTO public.article_team_tags(article_id, team_id)');
  const playerInsert = body.indexOf('INSERT INTO public.article_player_tags(article_id, player_id, mention_type)');
  const editionUpdate = body.indexOf('UPDATE public.newspaper_editions');
  if (!(gameInsert >= 0 && gameInsert < teamInsert && teamInsert < playerInsert && playerInsert < editionUpdate)) fail('PUBLICATION_SOURCE_ATOMIC_LINKS_MISSING');
  if (!/SELECT\s+v_article_id,\s*g\.id,\s*false\b/.test(body)) fail('PUBLICATION_SOURCE_GAME_PRIMARY_INVALID');
  if (!/SELECT\s+DISTINCT\s+v_article_id,\s*\(contributor\s*->>\s*'playerId'\)::uuid,\s*'mentioned'/.test(body)) fail('PUBLICATION_SOURCE_PLAYER_LINKS_INVALID');
  const articleColumns = /INSERT INTO public\.articles\s*\(([^)]*)\)/.exec(body)?.[1];
  if (!articleColumns || articleColumns.split(',').map((column) => column.trim()).includes('game_id')) fail('PUBLICATION_SOURCE_GAME_PRIMARY_INVALID');
  return body;
}

export function expectedPublishBodyDigest(sql) {
  return hash(Buffer.from(assertAtomicPublishBody(extractPublishFunctionBody(sql)), 'utf8'));
}

export function parsePublishBodyDigestReceipt(stdout) {
  let receipt;
  try { receipt = JSON.parse(stdout); } catch { fail('PUBLICATION_CONTRACT_RECEIPT_INVALID'); }
  let rows = receipt;
  if (!Array.isArray(receipt)) {
    assertExactKeys(receipt, ['boundary', 'rows', 'warning'], 'PUBLICATION_CONTRACT_RECEIPT_INVALID');
    if (!/^[0-9a-f]{32}$/.test(receipt.boundary) || typeof receipt.warning !== 'string') fail('PUBLICATION_CONTRACT_RECEIPT_INVALID');
    rows = receipt.rows;
  }
  if (!Array.isArray(rows) || rows.length !== 1) fail('PUBLICATION_CONTRACT_RECEIPT_INVALID');
  assertExactKeys(rows[0], ['body_sha256'], 'PUBLICATION_CONTRACT_RECEIPT_INVALID');
  if (!SHA256.test(rows[0].body_sha256)) fail('PUBLICATION_CONTRACT_RECEIPT_INVALID');
  return rows[0].body_sha256;
}

export function assertLivePublishBody(projectRef, expectedDigest, execFile = execFileSync) {
  if (!PROJECT_REF.test(projectRef) || !SHA256.test(expectedDigest)) fail('PUBLICATION_CONTRACT_QUERY_INPUT_INVALID');
  let stdout;
  try {
    stdout = execFile('supabase', ['db', 'query', '--linked', '--project-ref', projectRef, '-o', 'json', PUBLISH_BODY_QUERY], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
    });
  } catch { fail('PUBLICATION_CONTRACT_QUERY_FAILED'); }
  const actualDigest = parsePublishBodyDigestReceipt(stdout);
  if (actualDigest !== expectedDigest) fail('PUBLICATION_CONTRACT_BODY_MISMATCH');
  return actualDigest;
}

async function readBoundFile(file, expectedHash, code) {
  const bytes = await readFile(path.resolve(file));
  if (hash(bytes) !== expectedHash) fail(code);
  return bytes;
}

function assertExactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(code);
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

export function approvedPortraitDigestForAlts(reviewHtml, expectedAlts) {
  const byAlt = new Map();
  for (const match of reviewHtml.matchAll(/<img\b[^>]*\bsrc="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"[^>]*\balt="([^"]*)"[^>]*>/g)) {
    const alt = decodeHtmlAttribute(match[2]);
    const digest = hash(Buffer.from(match[1], 'base64'));
    if (!byAlt.has(alt)) byAlt.set(alt, new Set());
    byAlt.get(alt).add(digest);
  }
  const matches = expectedAlts.flatMap((alt) => [...(byAlt.get(alt) || [])]);
  if (!matches.length || new Set(matches).size !== 1) fail('APPROVED_EXPORT_PORTRAIT_BINDING_MISSING');
  return matches[0];
}

export function assertApprovedPortraitBinding(reviewHtml, expectedAlts, jpegBytes) {
  const approvedDigest = approvedPortraitDigestForAlts(reviewHtml, expectedAlts);
  if (hash(jpegBytes) !== approvedDigest) fail('REVIEWED_PORTRAIT_DERIVATION_MISMATCH');
  return approvedDigest;
}

function portraitAltsByPath(edition) {
  const result = new Map();
  const add = (sourcePath, alt) => {
    if (!sourcePath) return;
    const key = path.resolve(sourcePath);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(alt);
  };
  add(edition.lead.imageUrl, edition.lead.headline);
  edition.games.forEach((game) => add(game.imageUrl, game.headline));
  edition.stars.forEach((star) => add(star.illustrationUrl, `${star.name}, ${star.teamName}`));
  for (const section of ['hot', 'cold', 'aroundRink']) {
    (edition[section] || []).forEach((brief) => add(brief.imageUrl, brief.headline));
  }
  return result;
}

function localDateAtZone(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function assertCurrentSourceGames(rows, snapshot, periodStart, periodEnd, timezone) {
  const expected = new Map(snapshot.map((game) => [game.id, game]));
  const actual = new Map(rows.map((game) => [game.id, game]));
  for (const game of snapshot) {
    const row = actual.get(game.id);
    if (!row) fail('SOURCE_GAME_SET_CHANGED');
    if (row.status !== 'completed') fail('SOURCE_GAME_STATUS_CHANGED');
    if (row.home_team_id !== game.homeTeamId || row.away_team_id !== game.awayTeamId) fail('SOURCE_GAME_TEAM_CHANGED');
    if (row.home_score !== game.homeScore || row.away_score !== game.awayScore) fail('SOURCE_GAME_SCORE_CHANGED');
    const localDate = localDateAtZone(row.scheduled_at, timezone);
    if (localDate < periodStart || localDate > periodEnd) fail('SOURCE_GAME_SET_CHANGED');
  }
  const covered = rows
    .filter((row) => row.status === 'completed')
    .filter((row) => {
      const localDate = localDateAtZone(row.scheduled_at, timezone);
      return localDate >= periodStart && localDate <= periodEnd;
    })
    .map((row) => row.id)
    .sort();
  const reviewed = [...expected.keys()].sort();
  if (semanticJsonHash(covered) !== semanticJsonHash(reviewed)) fail('SOURCE_GAME_SET_CHANGED');
}

const PYTHON_PIXEL_COPY = String.raw`
import hashlib, json, sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
image = Image.open(src).convert('RGBA')
before = image.tobytes()
image.save(dst, format='PNG', optimize=False)
roundtrip = Image.open(dst).convert('RGBA')
after = roundtrip.tobytes()
result = {
  'width': image.width, 'height': image.height,
  'sourcePixelSha256': hashlib.sha256(before).hexdigest(),
  'outputPixelSha256': hashlib.sha256(after).hexdigest(),
  'equivalent': image.size == roundtrip.size and before == after,
}
print(json.dumps(result, separators=(',', ':')))
`;

export async function losslessJpegToPng(source, destination) {
  try {
    const jpeg = require('jpeg-js');
    const { PNG } = require('pngjs');
    const decoded = jpeg.decode(await readFile(source), { useTArray: true, formatAsRGBA: true });
    const sourcePixels = Buffer.from(decoded.data);
    const output = PNG.sync.write({ width: decoded.width, height: decoded.height, data: sourcePixels }, { colorType: 6, inputColorType: 6, inputHasAlpha: true });
    await writeFile(destination, output);
    const roundtrip = PNG.sync.read(output);
    const outputPixels = Buffer.from(roundtrip.data);
    const result = {
      width: decoded.width,
      height: decoded.height,
      sourcePixelSha256: hash(sourcePixels),
      outputPixelSha256: hash(outputPixels),
      equivalent: decoded.width === roundtrip.width && decoded.height === roundtrip.height && sourcePixels.equals(outputPixels),
    };
    if (!result.equivalent || result.sourcePixelSha256 !== result.outputPixelSha256) fail('PIXEL_EQUIVALENCE_FAILED');
    return result;
  } catch (error) {
    if (error?.code === 'PIXEL_EQUIVALENCE_FAILED') throw error;
  }
  let raw;
  try {
    raw = execFileSync('python3', ['-c', PYTHON_PIXEL_COPY, source, destination], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    fail('IMAGE_DECODER_UNAVAILABLE');
  }
  const result = JSON.parse(raw);
  if (!result.equivalent || result.sourcePixelSha256 !== result.outputPixelSha256) fail('PIXEL_EQUIVALENCE_FAILED');
  return result;
}

function gameForPlayer(edition, playerId, preferredGameId) {
  const matches = edition.games.filter((game) => game.contributors.some((player) => player.playerId === playerId));
  const game = preferredGameId ? matches.find((candidate) => candidate.gameId === preferredGameId) : matches.length === 1 ? matches[0] : undefined;
  if (!game) fail('MEDIA_PLAYER_GAME_BINDING_AMBIGUOUS');
  return game;
}

function collectDiffs(left, right, prefix = '', output = []) {
  if (Object.is(left, right)) return output;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) output.push(prefix);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) collectDiffs(left[index], right[index], `${prefix}/${index}`, output);
    return output;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) collectDiffs(left[key], right[key], `${prefix}/${key}`, output);
    return output;
  }
  output.push(prefix);
  return output;
}

function narrativeProjection(value) {
  if (Array.isArray(value)) return value.map(narrativeProjection);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'media' && !key.endsWith('Url'))
    .map(([key, child]) => [key, narrativeProjection(child)]));
  return value;
}

export async function prepareApprovedIssue(args, workDir) {
  const publishBodySha256 = expectedPublishBodyDigest(await readFile(PUBLISH_MIGRATION, 'utf8'));
  const sourceBytes = await readBoundFile(args.source, args.source_sha256, 'SOURCE_SHA256_MISMATCH');
  const pdfBytes = await readBoundFile(args.pdf, args.pdf_sha256, 'PDF_SHA256_MISMATCH');
  const factBytes = await readBoundFile(args.fact_pack, args.fact_pack_sha256, 'FACT_PACK_SHA256_MISMATCH');
  const verificationPath = path.resolve(args.verification);
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  if (verification.editionSha256 !== args.source_sha256 || verification.pdfSha256 !== args.pdf_sha256 || verification.factPackSha256 !== args.fact_pack_sha256 || verification.status !== 'verified_unpublished_review_artifact' || verification.allPageImagesFromActualPdf !== true || !String(verification.visualReview || '').startsWith('passed:')) fail('VERIFICATION_BINDING_MISMATCH');
  if (path.resolve(verification.pdf) !== path.resolve(args.pdf) || verification.pdfBytes !== pdfBytes.length) fail('VERIFICATION_BINDING_MISMATCH');
  const reviewHtml = await readFile(path.join(path.dirname(verificationPath), 'edition.html'), 'utf8');
  const edition = JSON.parse(sourceBytes);
  validateNewspaperEdition(edition);
  if (edition.status !== 'draft' || edition.leagueId !== args.league_id || edition.seasonId !== args.season_id) fail('TARGET_IDENTITY_MISMATCH');
  if (edition.source?.factPackDigest !== args.fact_pack_sha256) fail('EDITION_FACT_DIGEST_MISMATCH');
  const facts = JSON.parse(factBytes);
  if (facts.league?.id !== args.league_id || facts.season?.id !== args.season_id || facts.periodStart !== edition.periodStart || facts.periodEnd !== edition.periodEnd) fail('FACT_TARGET_IDENTITY_MISMATCH');
  if (facts.sourceEvents?.length !== 29 || facts.players?.length !== 26) fail('FACT_COUNT_MISMATCH');
  const editionGames = new Map(edition.games.map((game) => [game.gameId, game]));
  const sourceGameIds = [...edition.source.gameIds];
  if (new Set(sourceGameIds).size !== sourceGameIds.length || semanticJsonHash([...sourceGameIds].sort()) !== semanticJsonHash([...editionGames.keys()].sort())) fail('EDITION_SOURCE_GAME_SET_MISMATCH');
  const sourceGames = facts.games?.map((game) => {
    const reviewed = editionGames.get(game.id);
    if (!reviewed || game.status !== 'completed') fail('FACT_GAME_BINDING_MISMATCH');
    if (reviewed.homeTeam.id !== game.home_team_id || reviewed.awayTeam.id !== game.away_team_id || reviewed.homeScore !== game.home_score || reviewed.awayScore !== game.away_score) fail('FACT_GAME_BINDING_MISMATCH');
    return { id: game.id, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: game.home_score, awayScore: game.away_score, status: game.status, scheduledAt: game.scheduled_at };
  });
  if (!Array.isArray(sourceGames) || semanticJsonHash(sourceGames.map((game) => game.id).sort()) !== semanticJsonHash([...sourceGameIds].sort())) fail('FACT_GAME_BINDING_MISMATCH');
  const contributorIds = [...new Set(edition.games.flatMap((game) => game.contributors.map((player) => player.playerId)))];
  const scoreGoals = edition.games.reduce((total, game) => total + game.homeScore + game.awayScore, 0);
  if (contributorIds.length !== 26 || scoreGoals !== 29) fail('EDITION_COUNT_MISMATCH');

  const assetFacts = JSON.parse(await readFile(path.resolve(args.assets), 'utf8'));
  const artManifest = JSON.parse(await readFile(path.resolve(args.art_manifest), 'utf8'));
  if (!Array.isArray(artManifest) || artManifest.length !== 4) fail('APPROVED_ART_COUNT_MISMATCH');
  const prepared = structuredClone(edition);
  const assets = [];
  const assetBySourcePath = new Map();
  const approvedAltsByPath = portraitAltsByPath(edition);
  for (const item of artManifest) {
    assertExactKeys(item, ['name', 'playerId', 'file', 'sha256', 'provider', 'model', 'actual_profile_reference_verified'], 'ART_MANIFEST_FIELDS_INVALID');
    if (!UUID.test(item.playerId) || !SHA256.test(item.sha256) || item.actual_profile_reference_verified !== true) fail('ART_MANIFEST_IDENTITY_INVALID');
    const approvedPng = await readBoundFile(item.file, item.sha256, 'APPROVED_ART_SHA256_MISMATCH');
    if (!approvedPng.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('APPROVED_ART_NOT_PNG');
    const jpegPath = path.resolve(path.dirname(item.file), 'optimized', `${item.name}.jpg`);
    const sourceJpeg = await readFile(jpegPath);
    if (sourceJpeg[0] !== 0xff || sourceJpeg[1] !== 0xd8) fail('REVIEWED_SOURCE_NOT_JPEG');
    const derivative = APPROVED_PORTRAIT_DERIVATIVES.get(hash(approvedPng));
    if (!derivative || hash(sourceJpeg) !== derivative.jpegSha256) fail('REVIEWED_PORTRAIT_DERIVATION_MISMATCH');
    const approvedAlts = approvedAltsByPath.get(jpegPath) || [];
    const approvedExportSha256 = assertApprovedPortraitBinding(reviewHtml, approvedAlts, sourceJpeg);
    if (approvedExportSha256 !== derivative.jpegSha256) fail('APPROVED_EXPORT_PORTRAIT_BINDING_MISSING');
    const outputPath = path.join(workDir, `${item.playerId}.png`);
    const pixel = await losslessJpegToPng(jpegPath, outputPath);
    if (pixel.width !== 1254 || pixel.height !== 1254 || pixel.sourcePixelSha256 !== derivative.pixelSha256) fail('REVIEWED_PORTRAIT_DERIVATION_MISMATCH');
    const output = await readFile(outputPath);
    const outputSha256 = hash(output);
    const publicPath = `approved/v1/${outputSha256}.png`;
    const asset = {
      playerId: item.playerId,
      outputSha256,
      outputMime: 'image/png',
      outputBytes: output.length,
      privatePath: `outputs/v1/${outputSha256}.png`,
      publicPath,
      publicUrl: `https://${MEDIA_HOST}/storage/v1/object/public/${PUBLIC_BUCKET}/${publicPath}`,
      provenance: 'trusted-reviewed-import-v1',
      sourceArtifactSha256: hash(sourceJpeg),
      approvedOriginalPngSha256: hash(approvedPng),
      approvedExportSha256,
      exactBytesEmbeddedInApprovedPdf: pdfBytes.includes(sourceJpeg),
      decodedPixelSha256: pixel.sourcePixelSha256,
      approvedEditionSha256: args.source_sha256,
      approvedPdfSha256: args.pdf_sha256,
    };
    assets.push({ ...asset, localOutputPath: outputPath, width: pixel.width, height: pixel.height });
    assetBySourcePath.set(jpegPath, asset);
  }
  if (new Set(assets.map((asset) => asset.playerId)).size !== 4) fail('APPROVED_ART_DUPLICATE_PLAYER');

  const bindings = [];
  const bind = (field, sourcePath, preferredGameId) => {
    const asset = assetBySourcePath.get(path.resolve(sourcePath));
    if (!asset) fail('UNAPPROVED_PORTRAIT_PATH');
    const game = gameForPlayer(edition, asset.playerId, preferredGameId);
    bindings.push({ field, playerId: asset.playerId, gameId: game.gameId });
    return asset.publicUrl;
  };
  prepared.lead.imageUrl = bind('lead.imageUrl', edition.lead.imageUrl);
  if (bindings[0].playerId !== edition.stars[0].playerId) fail('LEAD_PLAYER_BINDING_MISMATCH');
  prepared.games.forEach((game, index) => { game.imageUrl = bind(`games.${game.gameId}.imageUrl`, edition.games[index].imageUrl, game.gameId); });
  prepared.stars.forEach((star, index) => {
    star.illustrationUrl = bind(`stars.${star.playerId}.illustrationUrl`, edition.stars[index].illustrationUrl);
    delete star.photoUrl;
  });
  for (const section of ['hot', 'cold', 'aroundRink']) {
    (prepared[section] || []).forEach((brief, index) => {
      const sourceUrl = edition[section]?.[index]?.imageUrl;
      if (sourceUrl) brief.imageUrl = bind(`${section}.${index}.imageUrl`, sourceUrl);
    });
  }

  const teamFacts = new Map(assetFacts.teams.map((team) => [team.teamId, team]));
  const logoDigests = [];
  const replaceLogo = async (team, sourceTeam) => {
    const teamId = team.id || team.teamId;
    const fact = teamFacts.get(teamId);
    const expected = path.resolve(path.dirname(args.art_manifest), 'optimized', `team-${teamId}.png`);
    if (!fact || path.resolve(sourceTeam.logoUrl) !== expected || typeof fact.sourceUrl !== 'string' || !fact.sourceUrl.startsWith('https://')) fail('TEAM_LOGO_MAPPING_INVALID');
    const bytes = await readFile(expected);
    logoDigests.push({ teamId, reviewedRenderSha256: hash(bytes) });
    team.logoUrl = fact.sourceUrl;
  };
  for (let index = 0; index < prepared.games.length; index += 1) {
    await replaceLogo(prepared.games[index].homeTeam, edition.games[index].homeTeam);
    await replaceLogo(prepared.games[index].awayTeam, edition.games[index].awayTeam);
  }
  for (let index = 0; index < prepared.standings.length; index += 1) await replaceLogo(prepared.standings[index], edition.standings[index]);

  prepared.media = {
    schemaVersion: 2,
    assets: assets.map(({
      localOutputPath: _path,
      width: _width,
      height: _height,
      approvedOriginalPngSha256: _original,
      approvedExportSha256: _export,
      exactBytesEmbeddedInApprovedPdf: _pdf,
      ...asset
    }) => asset),
    bindings,
  };
  validateNewspaperEdition(prepared);
  const diffs = collectDiffs(edition, prepared);
  const invalidDiff = diffs.find((entry) => entry !== '/media' && !entry.endsWith('Url'));
  if (invalidDiff) fail('NON_MEDIA_FIELD_CHANGED');
  const sourceNarrativeSha256 = semanticJsonHash(narrativeProjection(edition));
  const preparedNarrativeSha256 = semanticJsonHash(narrativeProjection(prepared));
  if (sourceNarrativeSha256 !== preparedNarrativeSha256) fail('NARRATIVE_BYTES_CHANGED');
  if (new Set(bindings.map((binding) => binding.playerId)).size !== 4) fail('UNUSED_APPROVED_ART');
  if (!bindings.some((binding) => binding.playerId === 'ad0291eb-6575-4e7c-b39a-495eb972d5ff' && binding.field.startsWith('hot.'))) fail('TRISTAN_ART_BINDING_MISSING');

  const slug = `hockey-life-times-${edition.periodStart}-${edition.seasonId.slice(0, 8)}`;
  const playerIds = contributorIds.sort();
  const teamIds = [...new Set(edition.games.flatMap((game) => [game.homeTeam.id, game.awayTeam.id]))].sort();
  const plan = {
    schemaVersion: 1,
    stage: args.stage,
    dryRun: !args.execute,
    approval: { sourceSha256: hash(sourceBytes), pdfSha256: hash(pdfBytes), factPackSha256: hash(factBytes) },
    target: { projectRef: args.project_ref, actorId: args.actor_id, leagueId: args.league_id, seasonId: args.season_id, periodStart: edition.periodStart, periodEnd: edition.periodEnd, issueNumber: edition.issueNumber, slug },
    integrity: { sourceNarrativeSha256, preparedNarrativeSha256, preparedEditionSha256: semanticJsonHash(prepared), contributorCount: contributorIds.length, sourceGoalCount: facts.sourceEvents.length, scoreGoalCount: scoreGoals, portraitCount: assets.length, bindingCount: bindings.length },
    portraits: assets.map(({ localOutputPath: _path, ...asset }) => asset),
    logos: [...new Map(logoDigests.map((item) => [item.teamId, item])).values()],
    links: { gameIds: edition.source.gameIds, games: sourceGames, teamIds, playerIds, primaryGameId: null },
    publicationContract: { signature: 'publish_newspaper_edition(uuid,integer,uuid,text,text,text,text,text)', bodySha256: publishBodySha256 },
  };
  return { edition: prepared, plan, localAssets: assets };
}

async function clientFor(args) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== `${args.project_ref}.supabase.co`) fail('SUPABASE_TARGET_MISMATCH');
  const { createClient } = await import('@supabase/supabase-js');
  return { client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }), url, key };
}

async function preflight(service, prepared, args) {
  const { client } = service;
  const [editionResult, articleResult, gameResult, teamResult, statResult, leagueResult, seasonResult, profileResult, membershipResult] = await Promise.all([
    client.from('newspaper_editions').select('id,status,issue_number,version,article_id').eq('league_id', args.league_id).eq('season_id', args.season_id).eq('period_start', prepared.edition.periodStart).eq('period_end', prepared.edition.periodEnd),
    client.from('articles').select('id,slug').eq('league_id', args.league_id).eq('slug', prepared.plan.target.slug),
    client.from('games').select('id,league_id,season_id,home_team_id,away_team_id,home_score,away_score,status,scheduled_at').eq('league_id', args.league_id).eq('season_id', args.season_id),
    client.from('teams').select('id,league_id').in('id', prepared.plan.links.teamIds),
    client.from('player_stats').select('game_id,player_id').in('game_id', prepared.plan.links.gameIds).in('player_id', prepared.plan.links.playerIds),
    client.from('leagues').select('id,created_by,owner_id,slug,timezone').eq('id', args.league_id).single(),
    client.from('seasons').select('id,league_id').eq('id', args.season_id).single(),
    client.from('profiles').select('id,is_platform_admin').eq('id', args.actor_id).maybeSingle(),
    client.from('league_memberships').select('user_id,role,status').eq('league_id', args.league_id).eq('user_id', args.actor_id).eq('status', 'active').in('role', ['owner', 'admin']),
  ]);
  const { data: editions, error: editionError } = editionResult;
  const { data: articles, error: articleError } = articleResult;
  const { data: games, error: gameError } = gameResult;
  const { data: teams, error: teamError } = teamResult;
  const { data: stats, error: statError } = statResult;
  if (editionError || articleError || gameError || teamError || statError || leagueResult.error || seasonResult.error || profileResult.error || membershipResult.error) fail('READ_ONLY_PREFLIGHT_FAILED');
  if (leagueResult.data.slug !== 'hockey-life' || leagueResult.data.timezone !== 'America/Toronto' || seasonResult.data.league_id !== args.league_id) fail('TARGET_SCOPE_MISMATCH');
  const actorAuthorized = profileResult.data?.is_platform_admin === true || leagueResult.data.created_by === args.actor_id || leagueResult.data.owner_id === args.actor_id || membershipResult.data.length > 0;
  if (!profileResult.data || !actorAuthorized) fail('ACTOR_NOT_AUTHORIZED');
  if (articles.length) fail('SLUG_COLLISION');
  if (games.some((row) => row.league_id !== args.league_id || row.season_id !== args.season_id)) fail('GAME_TARGET_MISMATCH');
  assertCurrentSourceGames(games, prepared.plan.links.games, prepared.edition.periodStart, prepared.edition.periodEnd, prepared.edition.timezone);
  if (teams.length !== prepared.plan.links.teamIds.length || teams.some((row) => row.league_id !== args.league_id)) fail('TEAM_TARGET_MISMATCH');
  const linkedPlayers = new Set(stats.map((row) => row.player_id));
  if (prepared.plan.links.playerIds.some((id) => !linkedPlayers.has(id))) fail('PLAYER_GAME_LINK_MISSING');
  if (editions.length > 1) fail('DUPLICATE_CANONICAL_EDITION');
  if (editions.length === 1 && editions[0].id !== args.edition_id) fail('CANONICAL_EDITION_COLLISION');
  return { canonicalEdition: editions[0] || null, slugCollision: false, actorAuthorized: true, gamesVerified: prepared.plan.links.games.length, teamsVerified: teams.length, playersVerified: linkedPlayers.size };
}

async function verifyObject(client, bucket, objectPath, expected) {
  const { data, error } = await client.storage.from(bucket).download(objectPath);
  if (error || !data) fail('STORAGE_READBACK_FAILED');
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== expected.outputBytes || hash(bytes) !== expected.outputSha256) fail('STORAGE_HASH_MISMATCH');
  return bytes;
}

async function uploadPrivate(client, prepared) {
  for (const asset of prepared.localAssets) {
    const bytes = await readFile(asset.localOutputPath);
    const { error } = await client.storage.from(PRIVATE_BUCKET).upload(asset.privatePath, bytes, { contentType: 'image/png', cacheControl: '31536000, immutable', upsert: false });
    if (error && !/already exists|duplicate|409/i.test(`${error.statusCode || ''} ${error.message || ''}`)) fail('PRIVATE_UPLOAD_FAILED');
    await verifyObject(client, PRIVATE_BUCKET, asset.privatePath, asset);
  }
}

async function requirePrivate(client, prepared) {
  for (const asset of prepared.localAssets) await verifyObject(client, PRIVATE_BUCKET, asset.privatePath, asset);
}

async function promotePublic(client, prepared) {
  for (const asset of prepared.localAssets) {
    const bytes = await verifyObject(client, PRIVATE_BUCKET, asset.privatePath, asset);
    const { error } = await client.storage.from(PUBLIC_BUCKET).upload(asset.publicPath, bytes, { contentType: 'image/png', cacheControl: '31536000, immutable', upsert: false });
    if (error && !/already exists|duplicate|409/i.test(`${error.statusCode || ''} ${error.message || ''}`)) fail('PUBLIC_PROMOTION_FAILED');
    await verifyObject(client, PUBLIC_BUCKET, asset.publicPath, asset);
  }
}

async function assertRestPublishContract(service) {
  const response = await fetch(`${service.url}/rest/v1/`, { headers: { apikey: service.key, authorization: `Bearer ${service.key}`, accept: 'application/openapi+json' } });
  if (!response.ok) fail('PUBLICATION_CONTRACT_INTROSPECTION_FAILED');
  const schema = await response.json();
  const operation = schema.paths?.['/rpc/publish_newspaper_edition']?.post;
  const referenced = [];
  const queue = [operation];
  const seen = new Set();
  while (queue.length) {
    const value = queue.pop();
    if (!value || typeof value !== 'object') continue;
    if (typeof value.$ref === 'string' && !seen.has(value.$ref)) {
      seen.add(value.$ref);
      const resolved = value.$ref.replace(/^#\//, '').split('/').reduce((current, key) => current?.[key], schema);
      if (resolved) { referenced.push(resolved); queue.push(resolved); }
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') queue.push(child);
  }
  const body = JSON.stringify([operation || {}, ...referenced]);
  for (const parameter of ['p_edition_id', 'p_expected_version', 'p_published_by', 'p_title', 'p_slug', 'p_content', 'p_excerpt', 'p_image_url']) {
    if (!body.includes(parameter)) fail('PUBLICATION_REST_CONTRACT_INVALID');
  }
  if (body.includes('p_team_ids') || body.includes('p_player_ids')) fail('PUBLICATION_REST_CONTRACT_INVALID');
}

export function buildPublishPayload(prepared, args) {
  return {
    p_edition_id: args.edition_id,
    p_expected_version: Number(args.expected_version),
    p_published_by: args.actor_id,
    p_title: `Hockey Life Times — ${prepared.edition.periodStart} to ${prepared.edition.periodEnd}`,
    p_slug: prepared.plan.target.slug,
    p_content: articleFallback(prepared.edition),
    p_excerpt: prepared.edition.lead.dek,
    p_image_url: prepared.edition.lead.imageUrl,
  };
}

function articleFallback(edition) {
  return renderNewspaperText({ ...edition, status: 'published' });
}

async function executeStage(service, prepared, args, preflightResult) {
  const { client } = service;
  if (args.stage === 'prepare') {
    await uploadPrivate(client, prepared);
    return { privateObjectsVerified: prepared.localAssets.length };
  }
  if (args.stage === 'draft') {
    await requirePrivate(client, prepared);
    let claimed;
    try {
      const begin = await client.rpc('begin_newspaper_generation', { p_league_id: args.league_id, p_season_id: args.season_id, p_period_start: prepared.edition.periodStart, p_period_end: prepared.edition.periodEnd, p_created_by: args.actor_id, p_lease_seconds: 120 });
      if (begin.error || !begin.data) fail('DRAFT_LEASE_FAILED');
      claimed = begin.data;
      if (args.edition_id && claimed.id !== args.edition_id) fail('DRAFT_EDITION_ID_MISMATCH');
      if (String(claimed.issue_number) !== String(prepared.edition.issueNumber)) fail('DRAFT_ISSUE_NUMBER_MISMATCH');
      const complete = await client.rpc('complete_newspaper_generation', { p_edition_id: claimed.id, p_generation_token: claimed.generation_token, p_edition_json: prepared.edition, p_generation_method: `trusted-reviewed-import-v1:${args.source_sha256}` });
      if (complete.error || !complete.data) fail('DRAFT_COMPLETE_FAILED');
      if (complete.data.status !== 'draft' || complete.data.article_id !== null || semanticJsonHash(complete.data.edition_json) !== prepared.plan.integrity.preparedEditionSha256) fail('DRAFT_READBACK_MISMATCH');
      return { editionId: complete.data.id, version: complete.data.version, status: complete.data.status, articleId: null };
    } catch (error) {
      if (claimed?.id && claimed?.generation_token) await client.rpc('fail_newspaper_generation', { p_edition_id: claimed.id, p_generation_token: claimed.generation_token, p_error: 'APPROVED_IMPORT_ABORTED' });
      throw error;
    }
  }
  await requirePrivate(client, prepared);
  await assertRestPublishContract(service);
  const currentBodySha256 = expectedPublishBodyDigest(await readFile(PUBLISH_MIGRATION, 'utf8'));
  if (currentBodySha256 !== prepared.plan.publicationContract.bodySha256) fail('PUBLICATION_SOURCE_CHANGED_DURING_RUN');
  assertLivePublishBody(args.project_ref, currentBodySha256);
  const row = preflightResult.canonicalEdition;
  if (!row || row.id !== args.edition_id || row.status !== 'draft' || row.article_id !== null || row.version !== Number(args.expected_version)) fail('PUBLISH_DRAFT_BINDING_MISMATCH');
  const stored = await client.from('newspaper_editions').select('edition_json').eq('id', args.edition_id).single();
  if (stored.error || semanticJsonHash(stored.data.edition_json) !== prepared.plan.integrity.preparedEditionSha256) fail('PUBLISH_EDITION_HASH_MISMATCH');
  await promotePublic(client, prepared);
  const publish = await client.rpc('publish_newspaper_edition', buildPublishPayload(prepared, args));
  if (publish.error || !publish.data) fail('PUBLISH_RPC_FAILED');
  const articleId = publish.data.article_id;
  const [article, gameTags, teamTags, playerTags] = await Promise.all([
    client.from('articles').select('id,league_id,season_id,slug,published,published_at,game_id').eq('id', articleId).single(),
    client.from('article_game_tags').select('game_id,is_primary').eq('article_id', articleId),
    client.from('article_team_tags').select('team_id').eq('article_id', articleId),
    client.from('article_player_tags').select('player_id').eq('article_id', articleId),
  ]);
  if (article.error || gameTags.error || teamTags.error || playerTags.error) fail('PUBLISH_READBACK_FAILED');
  if (!article.data.published || !article.data.published_at || article.data.game_id !== null || article.data.slug !== prepared.plan.target.slug) fail('PUBLISHED_ARTICLE_MISMATCH');
  if (gameTags.data.length !== 2 || gameTags.data.some((tag) => tag.is_primary) || semanticJsonHash(gameTags.data.map((tag) => tag.game_id).sort()) !== semanticJsonHash([...prepared.plan.links.gameIds].sort())) fail('PUBLISHED_GAME_LINK_MISMATCH');
  if (semanticJsonHash(teamTags.data.map((tag) => tag.team_id).sort()) !== semanticJsonHash(prepared.plan.links.teamIds)) fail('PUBLISHED_TEAM_LINK_MISMATCH');
  if (semanticJsonHash(playerTags.data.map((tag) => tag.player_id).sort()) !== semanticJsonHash(prepared.plan.links.playerIds)) fail('PUBLISHED_PLAYER_LINK_MISMATCH');
  return { editionId: args.edition_id, articleId, status: 'published', primaryGameId: null, linkedGames: 2, linkedTeams: teamTags.data.length, linkedPlayers: playerTags.data.length };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const workDir = await mkdtemp(path.join(tmpdir(), 'hlt-approved-import-'));
  const startedAt = new Date().toISOString();
  try {
    const prepared = await prepareApprovedIssue(args, workDir);
    if (args.plan) await writeFile(path.resolve(args.plan), `${JSON.stringify(prepared.plan, null, 2)}\n`);
    if (args.prepared_edition) await writeFile(path.resolve(args.prepared_edition), `${JSON.stringify(prepared.edition, null, 2)}\n`);
    const service = await clientFor(args);
    let livePreflight = { status: 'not_run_missing_runtime_credentials' };
    if (service) livePreflight = { status: 'passed', ...(await preflight(service, prepared, args)) };
    if (args.execute && !service) fail('RUNTIME_CREDENTIALS_REQUIRED');
    const action = args.execute ? await executeStage(service, prepared, args, livePreflight) : { status: 'dry_run_no_mutations' };
    const result = { schemaVersion: 1, stage: args.stage, dryRun: !args.execute, startedAt, completedAt: new Date().toISOString(), approvalVerified: true, pixelEquivalenceVerified: true, narrativePreserved: true, livePreflight, action };
    if (args.result) await writeFile(path.resolve(args.result), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`approved-import failed: ${error.code || 'UNEXPECTED_ERROR'}\n`);
    process.exitCode = 1;
  });
}
