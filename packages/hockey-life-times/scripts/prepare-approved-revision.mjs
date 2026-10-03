#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderNewspaperHtml, renderNewspaperText, validateNewspaperEdition } from '../src/index.ts';

const APPROVED_MANUSCRIPT_SHA256 = 'b3be4940569ea077e2a2d9a2484b3b4f937b401de12e0f8e5b0f6b24838715ca';
const APPROVED_PDF_SHA256 = 'b27af337ddbb2e37121cdffb646bb8d66cd7f1ba17e45387a7383f7bcaff3e1b';
const APPROVED_FACTS_SHA256 = 'c67523972d682c1cb98ae26c2ce7aa54f9e7ab46160aff180294f2c699215e8d';
const APPROVED_EDITION_SEMANTIC_SHA256 = 'b1418e217e4a5dca9f43d8c32ed5765c33bafaef3fdac99deff462b3ae4efd59';
const APPROVED_SCORING_FACTS_SHA256 = '055d19611aa265dcc83f0c01589ea03f3c3d131b71fd9dfe62d00b1709032948';
const APPROVED_CONTENT_SHA256 = '59cdd7efc8a0deee4c83f91fac60f0fce4b70c74c730b60460cf906fa9c71d69';
const APPROVED_EXCERPT_SHA256 = '2ae3e1c77e030379eff595631986286b341c4bf0973605ab9816513671420867';
const IDS = {
  article: '05ed2736-a431-41fa-b919-2ddddee157c8', edition: '61196f33-0958-4752-8436-47601b2875f1',
  league: 'd6e55507-6eae-4d94-978c-47c6c30a36f1', season: '145ac7ee-99fb-4a50-a0b5-37f24e9991f3',
  actor: 'add94b26-b344-459f-9727-8cddae9783de',
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value) => Array.isArray(value)
  ? `[${value.map(canonicalJson).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const fail = (code) => { throw new Error(code); };
const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations/20261003190000_newspaper_editorial_revisions.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');
const revisionMarker = 'CREATE FUNCTION public.revise_published_newspaper_edition(';
const revisionStart = migrationSql.indexOf(revisionMarker);
const revisionBodyStart = migrationSql.indexOf('AS $$', revisionStart) + 5;
const revisionBodyEnd = migrationSql.indexOf('$$;', revisionBodyStart);
if (revisionStart < 0 || revisionBodyStart < 5 || revisionBodyEnd < 0) fail('REVISION_SOURCE_BODY_MISSING');
const REVISION_BODY_SHA256 = hash(Buffer.from(migrationSql.slice(revisionBodyStart, revisionBodyEnd)));
const cleanBold = (line) => line.replace(/^\*\*/, '').replace(/\*\*$/, '').trim();

function section(markdown, heading, nextHeading) {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) fail(`MANUSCRIPT_SECTION_MISSING:${heading}`);
  const from = start + `## ${heading}`.length;
  const end = nextHeading ? markdown.indexOf(`## ${nextHeading}`, from) : markdown.length;
  if (end < 0) fail(`MANUSCRIPT_SECTION_MISSING:${nextHeading}`);
  return markdown.slice(from, end).trim();
}

function h3Chunks(block) {
  const matches = [...block.matchAll(/^### (.+)$/gm)];
  return matches.map((match, index) => ({
    heading: match[1].trim(),
    body: block.slice(match.index + match[0].length, matches[index + 1]?.index ?? block.length).trim(),
  }));
}

function prose(block) {
  return block.split(/\n\s*\n/).map((item) => item.trim()).filter((item) => item && !item.startsWith('**') && !item.startsWith('*'));
}

function assertBaseline(baseline) {
  if (baseline.articles?.length !== 1 || baseline.editions?.length !== 1) fail('BASELINE_ROW_COUNT_MISMATCH');
  const article = baseline.articles[0]; const edition = baseline.editions[0];
  if (article.id !== IDS.article || edition.id !== IDS.edition || edition.article_id !== IDS.article) fail('BASELINE_ID_MISMATCH');
  if (article.league_id !== IDS.league || edition.league_id !== IDS.league || article.season_id !== IDS.season || edition.season_id !== IDS.season) fail('BASELINE_TENANT_MISMATCH');
  if (!article.published || !article.published_at || edition.status !== 'published' || !edition.published_at || edition.version !== 1) fail('BASELINE_PUBLICATION_MISMATCH');
  return { row: edition, edition: edition.edition_json };
}

function expectedNumbers(facts, oldEdition) {
  const rows = facts.standings.rows;
  if (rows.length !== oldEdition.standings.length || rows.some((row, index) => row.team !== oldEdition.standings[index].name || row.gf !== oldEdition.standings[index].gf || row.ga !== oldEdition.standings[index].ga)) fail('FACT_STANDINGS_MISMATCH');
  const contributors = facts.completed_games.flatMap((game) => game.contributors);
  const leaders = contributors.filter((player) => player.pts === Math.max(...contributors.map((item) => item.pts)));
  const defence = contributors.filter((player) => player.team === 'Bad Bunny' && player.position === 'Defense');
  const values = [
    `${rows.reduce((sum, row) => sum + row.gf, 0)} goals`,
    `${Math.max(...oldEdition.games.map((game) => Math.abs(game.homeScore - game.awayScore)))}-goal margin`,
    `${leaders[0].pts} points each`,
    `${defence.reduce((sum, player) => sum + player.g, 0)} goal, ${defence.reduce((sum, player) => sum + player.a, 0)} assists`,
    `${oldEdition.games.length} games`,
  ];
  if (leaders.length !== 2) fail('FACT_LEADER_COUNT_MISMATCH');
  return values;
}

function approvedScoringFacts(facts, oldEdition) {
  const snapshot = {};
  for (const game of facts.completed_games) {
    const editionGame = oldEdition.games.find((candidate) => candidate.homeTeam.name === game.home.team
      && candidate.awayTeam.name === game.away.team && candidate.homeScore === game.home.score && candidate.awayScore === game.away.score);
    if (!editionGame) fail('FACT_GAME_IDENTITY_MISMATCH');
    for (const player of game.contributors) {
      const key = `${editionGame.gameId}:${player.player}`;
      if (snapshot[key]) fail('FACT_CONTRIBUTOR_IDENTITY_DUPLICATE');
      snapshot[key] = {
        gameId: editionGame.gameId, playerName: player.player, teamName: player.team,
        position: player.position.toLowerCase(), goals: player.g, assists: player.a, points: player.pts,
      };
    }
  }
  if (Object.keys(snapshot).length !== 24 || hash(Buffer.from(canonicalJson(snapshot))) !== APPROVED_SCORING_FACTS_SHA256) fail('FACT_SCORING_SNAPSHOT_MISMATCH');
  return snapshot;
}

function frozenProjection(edition) {
  const top = structuredClone(edition);
  for (const key of ['editorial','numbers','lead','games','stars','hot','cold','upcoming','upcomingNote']) delete top[key];
  const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  return {
    ...top,
    lead: omit(edition.lead, ['headline','dek','body']),
    games: edition.games.map((row) => omit(row, ['headline','body'])),
    stars: edition.stars.map((row) => omit(row, ['reason'])),
    hot: edition.hot.map((row) => omit(row, ['headline','body'])),
    cold: edition.cold.map((row) => omit(row, ['headline','body'])),
    upcoming: edition.upcoming.map((row) => omit(row, ['headline','line','pick','bodyParagraphs'])),
  };
}

export function prepareApprovedRevision({ baseline, facts, factsBytes, manuscript, receipt, pdfBytes }) {
  if (hash(Buffer.from(manuscript)) !== APPROVED_MANUSCRIPT_SHA256 || receipt.source_sha256 !== APPROVED_MANUSCRIPT_SHA256 || receipt.pdf_sha256 !== APPROVED_PDF_SHA256 || !pdfBytes || hash(pdfBytes) !== APPROVED_PDF_SHA256) fail('APPROVAL_RECEIPT_MISMATCH');
  if (!factsBytes || hash(factsBytes) !== APPROVED_FACTS_SHA256) fail('FACT_PACK_HASH_MISMATCH');
  const { edition: old } = assertBaseline(baseline);
  if (facts.scope.league.id !== IDS.league || facts.scope.season.id !== IDS.season) fail('FACT_TENANT_MISMATCH');

  const front = h3Chunks(section(manuscript, 'Front Page', 'This Week on the Ice'))[0];
  const frontLines = front.body.split('\n').map((line) => line.trim());
  const gameDrafts = h3Chunks(section(manuscript, 'This Week on the Ice', 'Three Stars of the Week'));
  const starDrafts = h3Chunks(section(manuscript, 'Three Stars of the Week', 'This Week by the Numbers'));
  const numberLines = section(manuscript, 'This Week by the Numbers', 'Standings — Enjoy the View; You Have Not Bought the Place').split('\n').filter((line) => line.startsWith('- **'));
  const standingsBody = section(manuscript, 'Standings — Enjoy the View; You Have Not Bought the Place', 'The Heater');
  const heater = h3Chunks(section(manuscript, 'The Heater', 'The Cold Tub'))[0];
  const cold = h3Chunks(section(manuscript, 'The Cold Tub', 'Next Week Headlines — Thursday, October 8'))[0];
  const upcomingBlock = section(manuscript, 'Next Week Headlines — Thursday, October 8', null).split('\n---')[0].trim();
  const upcomingDrafts = h3Chunks(upcomingBlock);
  const disclaimer = upcomingBlock.split('\n').find((line) => line.startsWith('*'))?.replace(/^\*|\*$/g, '').trim();
  if (!front || gameDrafts.length !== 2 || starDrafts.length !== 3 || numberLines.length !== 5 || !heater || !cold || upcomingDrafts.length !== 2 || !disclaimer) fail('MANUSCRIPT_SHAPE_MISMATCH');

  const values = expectedNumbers(facts, old);
  const scoringFacts = approvedScoringFacts(facts, old);
  const numbers = numberLines.map((line, index) => {
    const match = /^- \*\*(.+?):\*\* (.+)$/.exec(line); if (!match || match[1] !== values[index]) fail('MANUSCRIPT_NUMBER_MISMATCH');
    return { value: match[1], label: match[2] };
  });
  const mapByNames = (rows, drafts, nameForRow) => rows.map((row) => {
    const draft = drafts.find((item) => item.heading.includes(nameForRow(row))); if (!draft) fail(`MANUSCRIPT_IDENTITY_MISMATCH:${nameForRow(row)}`);
    return { row, draft };
  });
  const games = mapByNames(old.games, gameDrafts, (game) => game.homeTeam.name).map(({ row, draft }) => {
    const expectedScore = `${row.awayTeam.name} ${row.awayScore}, ${row.homeTeam.name} ${row.homeScore}`;
    if (!draft.heading.startsWith(`${expectedScore} —`)) fail('MANUSCRIPT_GAME_SCORE_MISMATCH');
    return { ...row, headline: draft.heading.replace(/^[^—]+—\s*/, ''), body: prose(draft.body) };
  });
  const stars = mapByNames(old.stars, starDrafts, (star) => star.name).map(({ row, draft }) => {
    const statLine = cleanBold(draft.body.split('\n')[0]);
    const expected = `${row.goals} ${row.goals === 1 ? 'goal' : 'goals'}, ${row.assists} ${row.assists === 1 ? 'assist' : 'assists'}, ${row.points} ${row.points === 1 ? 'point' : 'points'}.`;
    if (statLine !== expected) fail('MANUSCRIPT_STAR_STATS_MISMATCH');
    return { ...row, reason: prose(draft.body)[0] };
  });
  const upcoming = mapByNames(old.upcoming, upcomingDrafts, (game) => game.homeName).map(({ row, draft }) => {
    const lines = draft.body.split('\n').map((line) => line.trim()).filter(Boolean);
    const line = cleanBold(lines[0]); const pick = cleanBold(lines[1]);
    if (!line.startsWith('HLT line:') || !pick.startsWith("Columnist's pick:")) fail('MANUSCRIPT_PROJECTION_LABEL_MISMATCH');
    const fixture = facts.upcoming_fixtures.find((item) => item.home === row.homeName && item.away === row.awayName);
    if (!fixture || fixture.scheduled_at_utc !== row.scheduledAt || fixture.venue !== row.venue) fail('FACT_UPCOMING_MISMATCH');
    const ascii = (value) => value.replace(/[\u2010-\u2015\u2212]/g, '-');
    if (!facts.editorial_model.lines.some((modelLine) => ascii(line).endsWith(ascii(modelLine))) || !facts.editorial_model.picks.some((modelPick) => ascii(pick).includes(ascii(modelPick.split(' over ')[0])))) fail('FACT_PROJECTION_MISMATCH');
    return { ...row, headline: draft.heading.replace(/\s+—\s+.+$/, ''), line, pick, bodyParagraphs: prose(lines.slice(2).join('\n\n')) };
  });
  const sourceParagraph = /### Editorial source note\s+([\s\S]+)$/.exec(manuscript)?.[1].trim();
  if (!sourceParagraph) fail('MANUSCRIPT_SOURCE_NOTE_MISSING');
  const sourceNote = sourceParagraph.replace(/ No published article or live generator was changed for this review draft\.\s*$/, '').match(/[^.!?]+[.!?]+(?:['”])?/g)?.map((sentence) => sentence.trim()) || [];
  if (sourceNote.length !== 4) fail('MANUSCRIPT_SOURCE_NOTE_SHAPE_MISMATCH');

  const edition = {
    ...old, status: 'published',
    lead: { ...old.lead, headline: front.heading, dek: cleanBold(frontLines[0]), body: prose(frontLines.slice(1).join('\n\n')) },
    games, stars, numbers,
    hot: [{ ...old.hot[0], headline: heater.heading, body: prose(heater.body)[0] }],
    cold: [{ ...old.cold[0], headline: cold.heading, body: prose(cold.body)[0] }],
    upcoming, upcomingNote: disclaimer,
    editorial: {
      standings: { headline: 'Enjoy the View; You Have Not Bought the Place', body: prose(standingsBody) },
      upcoming: { heading: 'Next Week Headlines — Thursday, October 8' },
      sourceNote,
    },
  };
  validateNewspaperEdition(edition);
  if (JSON.stringify(frozenProjection(edition)) !== JSON.stringify(frozenProjection(old))) fail('PREPARED_FROZEN_FIELD_CHANGED');
  const text = renderNewspaperText(edition);
  const editionSemanticSha256 = hash(Buffer.from(canonicalJson(edition)));
  const articleContentSha256 = hash(Buffer.from(text));
  if (editionSemanticSha256 !== APPROVED_EDITION_SEMANTIC_SHA256 || articleContentSha256 !== APPROVED_CONTENT_SHA256 || hash(Buffer.from(edition.lead.dek)) !== APPROVED_EXCERPT_SHA256) fail('PREPARED_APPROVED_PAYLOAD_MISMATCH');
  return {
    edition, text, html: renderNewspaperHtml(edition), excerpt: edition.lead.dek, scoringFacts,
    mapping: {
      manuscriptSha256: APPROVED_MANUSCRIPT_SHA256, pdfSha256: APPROVED_PDF_SHA256,
      articleId: IDS.article, editionId: IDS.edition, oldVersion: 1, numericValues: values,
      factPackSha256: APPROVED_FACTS_SHA256, approvedScoringFactsSha256: APPROVED_SCORING_FACTS_SHA256,
      approvedScoringContributorCount: Object.keys(scoringFacts).length,
      preparedEditionSemanticSha256: editionSemanticSha256,
      articleContentSha256, frozenProjectionVerified: true,
    },
  };
}

export function parsePreflightTransport(raw, expectedKeys) {
  let envelope; try { envelope = JSON.parse(raw); } catch { fail('PREFLIGHT_TRANSPORT_INVALID'); }
  if (!envelope || Array.isArray(envelope) || Object.keys(envelope).sort().join(',') !== 'boundary,rows,warning' || !/^[0-9a-f]{32}$/.test(envelope.boundary) || typeof envelope.warning !== 'string' || !Array.isArray(envelope.rows) || envelope.rows.length !== 1) fail('PREFLIGHT_TRANSPORT_INVALID');
  const row = envelope.rows[0];
  if (!row || Array.isArray(row) || Object.keys(row).sort().join(',') !== [...expectedKeys].sort().join(',')) fail('PREFLIGHT_TRANSPORT_INVALID');
  return row;
}

const PREFLIGHT_KEYS = ['article_id','edition_id','league_id','season_id','version','edition_status','article_published','article_published_at','edition_published_at','title','slug','type','image_url','author_id','game_id','edition_sha256','content_sha256','game_tags','team_tags','player_tags','revision_count','duplicate_article_count','duplicate_edition_count','baseline_edition_matches','baseline_content_matches','baseline_excerpt_matches','rpc_exists','rpc_body_sha256','service_role_execute','anon_execute_denied','authenticated_execute_denied','service_gate_table_denied'];
const POSTFLIGHT_KEYS = ['article_id','edition_id','version','edition_status','article_published','article_published_at_unchanged','edition_published_at_unchanged','identity_unchanged','media_unchanged','content_matches','excerpt_matches','edition_matches','game_tags_unchanged','team_tags_unchanged','player_tags_unchanged','matching_audit_count','duplicate_article_count','duplicate_edition_count'];

function preflightSelect(baseline) {
  const { row, edition } = assertBaseline(baseline);
  const article = baseline.articles[0];
  return `SELECT a.id AS article_id, ne.id AS edition_id, a.league_id, a.season_id, ne.version,
 ne.status AS edition_status, a.published AS article_published, a.published_at AS article_published_at,
 ne.published_at AS edition_published_at, a.title, a.slug, a.type, a.image_url, a.author_id, a.game_id,
 encode(extensions.digest(convert_to(ne.edition_json::text,'UTF8'),'sha256'),'hex') AS edition_sha256,
 encode(extensions.digest(convert_to(a.content,'UTF8'),'sha256'),'hex') AS content_sha256,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY game_id) FROM public.article_game_tags x WHERE article_id=a.id) AS game_tags,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY team_id) FROM public.article_team_tags x WHERE article_id=a.id) AS team_tags,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY player_id) FROM public.article_player_tags x WHERE article_id=a.id) AS player_tags,
 (SELECT count(*) FROM public.newspaper_editorial_revision_audit r WHERE r.article_id=a.id) AS revision_count,
 (SELECT count(*) FROM public.articles d WHERE d.league_id=a.league_id AND d.slug=a.slug) AS duplicate_article_count,
 (SELECT count(*) FROM public.newspaper_editions d WHERE d.league_id=ne.league_id AND d.season_id=ne.season_id AND d.period_start=ne.period_start AND d.period_end=ne.period_end) AS duplicate_edition_count,
 ne.edition_json=${sqlLiteral(JSON.stringify(edition))}::jsonb AS baseline_edition_matches,
 a.content=${sqlLiteral(article.content)} AS baseline_content_matches,
 a.excerpt=${sqlLiteral(article.excerpt)} AS baseline_excerpt_matches,
 to_regprocedure('public.revise_published_newspaper_edition(uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,text,text,text,text,text,uuid)') IS NOT NULL AS rpc_exists,
 (SELECT encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') FROM pg_proc p WHERE p.oid=to_regprocedure('public.revise_published_newspaper_edition(uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,text,text,text,text,text,uuid)')) AS rpc_body_sha256,
 has_function_privilege('service_role','public.revise_published_newspaper_edition(uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,text,text,text,text,text,uuid)','EXECUTE') AS service_role_execute,
 NOT has_function_privilege('anon','public.revise_published_newspaper_edition(uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,text,text,text,text,text,uuid)','EXECUTE') AS anon_execute_denied,
 NOT has_function_privilege('authenticated','public.revise_published_newspaper_edition(uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,text,text,text,text,text,uuid)','EXECUTE') AS authenticated_execute_denied,
 NOT has_table_privilege('service_role','public.newspaper_article_revision_write_gate','SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('service_role','public.newspaper_edition_revision_write_gate','SELECT,INSERT,UPDATE,DELETE') AS service_gate_table_denied
FROM public.newspaper_editions ne JOIN public.articles a ON a.id=ne.article_id
WHERE ne.id='${row.id}'::uuid AND a.id='${IDS.article}'::uuid;\n`;
}

export function buildPreflightSql(baseline, withMigration = false) {
  return withMigration
    ? `BEGIN;\n${migrationSql}\n${preflightSelect(baseline)}ROLLBACK;\n`
    : `BEGIN READ ONLY;\n${preflightSelect(baseline)}COMMIT;\n`;
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export function assertPreflight(row) {
  if (row.article_id !== IDS.article || row.edition_id !== IDS.edition || row.league_id !== IDS.league || row.season_id !== IDS.season) fail('PREFLIGHT_IDENTITY_MISMATCH');
  if (Number(row.version) !== 1 || row.edition_status !== 'published' || row.article_published !== true || !row.article_published_at || !row.edition_published_at) fail('PREFLIGHT_PUBLICATION_MISMATCH');
  if (row.author_id !== IDS.actor || row.game_id !== null || Number(row.revision_count) !== 0 || Number(row.duplicate_article_count) !== 1 || Number(row.duplicate_edition_count) !== 1 || row.rpc_exists !== true) fail('PREFLIGHT_GUARD_MISMATCH');
  if (row.baseline_edition_matches !== true || row.baseline_content_matches !== true || row.baseline_excerpt_matches !== true) fail('PREFLIGHT_BASELINE_MISMATCH');
  if (!/^[0-9a-f]{64}$/.test(row.edition_sha256) || !/^[0-9a-f]{64}$/.test(row.content_sha256)) fail('PREFLIGHT_HASH_MISMATCH');
  if (row.rpc_body_sha256 !== REVISION_BODY_SHA256) fail('PREFLIGHT_RPC_BODY_MISMATCH');
  if (row.service_role_execute !== true || row.anon_execute_denied !== true || row.authenticated_execute_denied !== true || row.service_gate_table_denied !== true) fail('PREFLIGHT_ACL_MISMATCH');
  return row;
}

export function assertPostflight(row) {
  if (row.article_id !== IDS.article || row.edition_id !== IDS.edition || Number(row.version) !== 2 || row.edition_status !== 'published' || row.article_published !== true) fail('POSTFLIGHT_IDENTITY_MISMATCH');
  for (const key of POSTFLIGHT_KEYS.filter((key) => key.endsWith('_unchanged') || key.endsWith('_matches'))) if (row[key] !== true) fail(`POSTFLIGHT_CHECK_FAILED:${key}`);
  if (Number(row.matching_audit_count) !== 1 || Number(row.duplicate_article_count) !== 1 || Number(row.duplicate_edition_count) !== 1) fail('POSTFLIGHT_COUNT_MISMATCH');
  return row;
}

export function buildRevisionSql(prepared, preflight, commit) {
  const canonicalEdition = canonicalJson(prepared.edition);
  const canonicalScoringFacts = canonicalJson(prepared.scoringFacts);
  const call = `public.revise_published_newspaper_edition(${sqlLiteral(IDS.edition)}::uuid,${sqlLiteral(IDS.article)}::uuid,${sqlLiteral(IDS.league)}::uuid,${sqlLiteral(IDS.season)}::uuid,1,${sqlLiteral(preflight.edition_sha256)},${sqlLiteral(preflight.content_sha256)},${sqlLiteral(JSON.stringify(prepared.edition))}::jsonb,${sqlLiteral(canonicalEdition)},${sqlLiteral(canonicalScoringFacts)},${sqlLiteral(prepared.text)},${sqlLiteral(prepared.excerpt)},${sqlLiteral(APPROVED_MANUSCRIPT_SHA256)},${sqlLiteral(APPROVED_PDF_SHA256)},${sqlLiteral(IDS.actor)}::uuid)`;
  const deniedCall = `public.revise_published_newspaper_edition(NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid,NULL::integer,NULL::text,NULL::text,NULL::jsonb,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,NULL::uuid)`;
  const aclControls = commit ? '' : `SET LOCAL ROLE anon;
DO $acl$ BEGIN BEGIN EXECUTE 'SELECT ${deniedCall}'; RAISE EXCEPTION 'REVISION_ANON_EXECUTE_NOT_DENIED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $acl$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $acl$ BEGIN BEGIN EXECUTE 'SELECT ${deniedCall}'; RAISE EXCEPTION 'REVISION_AUTHENTICATED_EXECUTE_NOT_DENIED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $acl$;
RESET ROLE;\n`;
  return `BEGIN;\n${commit ? '' : `${migrationSql}\n`}${aclControls}SET LOCAL ROLE service_role;\nSELECT id, article_id, version, status FROM ${call};\nRESET ROLE;\nDO $guard$ BEGIN
IF (SELECT count(*) FROM public.articles WHERE id='${IDS.article}'::uuid AND league_id='${IDS.league}'::uuid) <> 1
 OR (SELECT count(*) FROM public.newspaper_editions WHERE id='${IDS.edition}'::uuid AND article_id='${IDS.article}'::uuid AND version=2) <> 1
 OR (SELECT count(*) FROM public.newspaper_editorial_revision_audit WHERE article_id='${IDS.article}'::uuid AND new_version=2 AND manuscript_sha256='${APPROVED_MANUSCRIPT_SHA256}') <> 1
THEN RAISE EXCEPTION 'REVISION_FIXTURE_POSTCONDITION_FAILED'; END IF; END $guard$;
${commit ? 'COMMIT' : 'ROLLBACK'};\n`;
}

export function buildPostflightSql(prepared, preflight) {
  return `BEGIN READ ONLY;
SELECT a.id AS article_id, ne.id AS edition_id, ne.version, ne.status AS edition_status, a.published AS article_published,
 a.published_at=${sqlLiteral(preflight.article_published_at)}::timestamptz AS article_published_at_unchanged,
 ne.published_at=${sqlLiteral(preflight.edition_published_at)}::timestamptz AS edition_published_at_unchanged,
 a.title=${sqlLiteral(preflight.title)} AND a.slug=${sqlLiteral(preflight.slug)} AND a.type=${sqlLiteral(preflight.type)} AS identity_unchanged,
 a.image_url IS NOT DISTINCT FROM ${preflight.image_url === null ? 'NULL' : sqlLiteral(preflight.image_url)} AS media_unchanged,
 a.content=${sqlLiteral(prepared.text)} AS content_matches, a.excerpt=${sqlLiteral(prepared.excerpt)} AS excerpt_matches,
 ne.edition_json=${sqlLiteral(JSON.stringify(prepared.edition))}::jsonb AS edition_matches,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY game_id) FROM public.article_game_tags x WHERE article_id=a.id)=${sqlLiteral(JSON.stringify(preflight.game_tags))}::jsonb AS game_tags_unchanged,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY team_id) FROM public.article_team_tags x WHERE article_id=a.id)=${sqlLiteral(JSON.stringify(preflight.team_tags))}::jsonb AS team_tags_unchanged,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY player_id) FROM public.article_player_tags x WHERE article_id=a.id)=${sqlLiteral(JSON.stringify(preflight.player_tags))}::jsonb AS player_tags_unchanged,
 (SELECT count(*) FROM public.newspaper_editorial_revision_audit r WHERE r.article_id=a.id AND r.new_version=2 AND r.manuscript_sha256='${APPROVED_MANUSCRIPT_SHA256}') AS matching_audit_count,
 (SELECT count(*) FROM public.articles d WHERE d.league_id=a.league_id AND d.slug=a.slug) AS duplicate_article_count,
 (SELECT count(*) FROM public.newspaper_editions d WHERE d.league_id=ne.league_id AND d.season_id=ne.season_id AND d.period_start=ne.period_start AND d.period_end=ne.period_end) AS duplicate_edition_count
FROM public.newspaper_editions ne JOIN public.articles a ON a.id=ne.article_id WHERE ne.id='${IDS.edition}'::uuid AND a.id='${IDS.article}'::uuid;
COMMIT;\n`;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => item.startsWith('--') ? [...pairs, [item.slice(2), all[index + 1]]] : pairs, []));
  for (const key of ['baseline','facts','manuscript','receipt','output']) if (!args[key]) fail(`MISSING_ARGUMENT:${key}`);
  const stage = args.stage || 'prepare';
  if (!['prepare','preflight-check','mutation-fixture','postflight-check'].includes(stage)) fail('INVALID_STAGE');
  const baseline = JSON.parse(await readFile(path.resolve(args.baseline), 'utf8'));
  const receipt = JSON.parse(await readFile(path.resolve(args.receipt), 'utf8'));
  const factsBytes = await readFile(path.resolve(args.facts));
  const prepared = prepareApprovedRevision({
    baseline, facts: JSON.parse(factsBytes.toString('utf8')), factsBytes,
    manuscript: await readFile(path.resolve(args.manuscript), 'utf8'), receipt,
    pdfBytes: await readFile(path.resolve(receipt.pdf)),
  });
  await mkdir(path.resolve(args.output), { recursive: true });
  await Promise.all([
    writeFile(path.join(path.resolve(args.output), 'prepared-edition.json'), `${JSON.stringify(prepared.edition, null, 2)}\n`),
    writeFile(path.join(path.resolve(args.output), 'rendered.html'), prepared.html),
    writeFile(path.join(path.resolve(args.output), 'rendered.txt'), prepared.text),
    writeFile(path.join(path.resolve(args.output), 'mapping.json'), `${JSON.stringify(prepared.mapping, null, 2)}\n`),
    writeFile(path.join(path.resolve(args.output), 'proof-report.json'), `${JSON.stringify({
      manuscriptParagraphsRetained: true, reviewWrapperAndH1Omitted: true, workflowSentenceOmitted: true,
      factualSourceSentencesRetained: 4, upcomingDisclaimerRetained: true, numericSidebarFactValidated: true,
      legacyRendererTestsRequired: true, browserOverflowCheckRequired: true, mapping: prepared.mapping,
    }, null, 2)}\n`),
    writeFile(path.join(path.resolve(args.output), 'migration-metadata-preflight.sql'), buildPreflightSql(baseline, true)),
    writeFile(path.join(path.resolve(args.output), 'preflight.sql'), buildPreflightSql(baseline)),
  ]);
  if (stage !== 'prepare') {
    if (args['project-ref'] !== 'ntplczcmhvfkijjxavdl' || path.resolve(args.cwd || '') !== path.resolve(process.cwd()) || !args.transport) fail('PREFLIGHT_CONTEXT_INVALID');
    if (stage === 'postflight-check') {
      const postflight = assertPostflight(parsePreflightTransport(await readFile(path.resolve(args.transport), 'utf8'), POSTFLIGHT_KEYS));
      await writeFile(path.join(path.resolve(args.output), 'postflight-proof.json'), `${JSON.stringify({ checked: true, projectRef: args['project-ref'], cwd: path.resolve(args.cwd), row: postflight }, null, 2)}\n`);
      return;
    }
    const preflight = assertPreflight(parsePreflightTransport(await readFile(path.resolve(args.transport), 'utf8'), PREFLIGHT_KEYS));
    await writeFile(path.join(path.resolve(args.output), 'preflight-proof.json'), `${JSON.stringify({ checked: true, projectRef: args['project-ref'], cwd: path.resolve(args.cwd), row: preflight }, null, 2)}\n`);
    if (stage === 'mutation-fixture') {
      const exactReceipt = `ADD_SAFE_REVISION_SUPPORT_AND_PUBLISH:${APPROVED_MANUSCRIPT_SHA256}:${APPROVED_PDF_SHA256}`;
      if (args['parent-approved-receipt'] !== exactReceipt) fail('PARENT_APPROVAL_RECEIPT_REQUIRED');
      await writeFile(path.join(path.resolve(args.output), 'revision-rollback-rehearsal.sql'), buildRevisionSql(prepared, preflight, false));
      await writeFile(path.join(path.resolve(args.output), 'revision-publish.sql'), buildRevisionSql(prepared, preflight, true));
      await writeFile(path.join(path.resolve(args.output), 'postflight.sql'), buildPostflightSql(prepared, preflight));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
