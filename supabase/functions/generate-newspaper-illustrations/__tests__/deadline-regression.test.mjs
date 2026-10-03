import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_PROJECT_REF,
  HOCKEY_LIFE_LEAGUE_ID,
} from '../policy.ts';
import { generateIllustrations } from '../workflow.ts';
import { syntheticPng1024 } from './png-fixture.mjs';

const editionId = '11111111-1111-4111-8111-111111111111';
const generationToken = '22222222-2222-4222-8222-222222222222';
const gameId = '33333333-3333-4333-8333-333333333333';
const homeTeamId = '44444444-4444-4444-8444-444444444444';
const awayTeamId = '55555555-5555-4555-8555-555555555555';
const playerIds = [
  '66666666-6666-4666-8666-666666666661',
  '66666666-6666-4666-8666-666666666662',
  '66666666-6666-4666-8666-666666666663',
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function timedFixture({ providerDelayMs, overallDeadlineMs, failPlayerId = null, cache = new Map() }) {
  const providerStarts = [];
  let providerCalls = 0;
  const edition = {
    id: editionId,
    league_id: HOCKEY_LIFE_LEAGUE_ID,
    season_id: '77777777-7777-4777-8777-777777777777',
    period_start: '2026-09-21',
    period_end: '2026-09-27',
    status: 'generating',
    generation_token: generationToken,
    lease_expires_at: '2099-09-27T12:00:00.000Z',
    article_id: null,
  };
  const repository = {
    cacheKeyContextSha256: 'c'.repeat(64),
    loadEdition: async () => edition,
    loadCompletedGames: async () => [{
      id: gameId,
      league_id: edition.league_id,
      season_id: edition.season_id,
      status: 'completed',
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
    }],
    loadGoalEvents: async () => playerIds.map((playerId) => ({
      game_id: gameId,
      team_id: homeTeamId,
      player_id: playerId,
      assist1_player_id: null,
      assist2_player_id: null,
    })),
    loadProfiles: async () => playerIds.map((playerId) => ({
      id: playerId,
      full_name: `Synthetic ${playerId.at(-1)}`,
      avatar_url: `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/${playerId}/photo.jpg`,
    })),
    loadVerifiedCache: async (paths) => cache.get(paths.metadataPath) ?? null,
    storeCache: async (paths, image, metadata) => {
      if (!cache.has(paths.metadataPath)) cache.set(paths.metadataPath, { image, metadata });
    },
  };
  const photos = {
    load: async (url) => ({ bytes: new TextEncoder().encode(url), mime: 'image/jpeg', url }),
  };
  const provider = {
    generate: async ({ image }) => {
      providerCalls += 1;
      const playerId = new TextDecoder().decode(image).split('/').at(-2);
      providerStarts.push({ playerId, elapsedMs: Date.now() - startedAt });
      await sleep(providerDelayMs);
      if (playerId === failPlayerId) throw new Error('PROVIDER_REQUEST_FAILED');
      return { image: syntheticPng1024(Number(playerId.at(-1))), requestId: `request-${playerId.at(-1)}` };
    },
  };
  let startedAt = 0;
  const run = () => {
    startedAt = Date.now();
    return generateIllustrations(
      { editionId, generationToken, playerIds },
      {
        repository,
        photos,
        provider,
        concurrency: 4,
        deadlineAt: startedAt + overallDeadlineMs,
        now: () => '2026-09-27T12:00:00.000Z',
      },
    );
  };
  return {
    cache,
    providerStarts,
    run,
    providerCalls: () => providerCalls,
  };
}

test('three 50-second-equivalent provider calls finish inside the 85-second-equivalent request deadline', async () => {
  // 20ms represents one production second: 1000ms provider latency == 50s and
  // 1700ms overall == 85s. The production caller requests concurrency four.
  const setup = timedFixture({ providerDelayMs: 1_000, overallDeadlineMs: 1_700 });
  const startedAt = Date.now();
  const result = await setup.run();
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.illustrations.length, 3);
  assert.equal(setup.providerCalls(), 3);
  assert.ok(elapsedMs < 1_700, `expected success before simulated 85s; elapsed=${elapsedMs}ms`);
  assert.ok(
    Math.max(...setup.providerStarts.map((entry) => entry.elapsedMs)) < 500,
    `all three provider calls must be in the first wave: ${JSON.stringify(setup.providerStarts)}`,
  );
});

test('a failed batch keeps verified create-only partials so one retry generates only the missing image', async () => {
  const failedPlayerId = playerIds[1];
  const first = timedFixture({ providerDelayMs: 5, overallDeadlineMs: 500, failPlayerId: failedPlayerId });
  await assert.rejects(() => first.run(), /PROVIDER_REQUEST_FAILED/);
  assert.equal(first.cache.size, 2);

  const retry = timedFixture({ providerDelayMs: 1, overallDeadlineMs: 500, cache: first.cache });
  const result = await retry.run();

  assert.equal(result.illustrations.length, 3);
  assert.equal(retry.providerCalls(), 1);
  assert.equal(retry.cache.size, 3);
});
