import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}));
jest.mock('../permissions', () => ({ verifyLeagueOwnerAccess: jest.fn() }));

import { createServiceRoleClient } from '@/lib/supabase/server';
import { verifyLeagueOwnerAccess } from '../permissions';
import { canonicalFactDigest, assertFreshPublicationFacts } from '../../hockey-life-times/fact-digest';
import { bindIllustrationsToEdition, decodeIllustrationResponse } from '../../hockey-life-times/media';
import { getHockeyLifeTimesSetup } from '../hockey-life-times';

const playerId = '33333333-3333-4333-8333-333333333333';
const outputSha256 = 'b'.repeat(64);
const publicUrl = `https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/newspaper-media-public/approved/v1/${outputSha256}.png`;
const illustration = {
  playerId,
  sourcePhotoSha256: 'a'.repeat(64),
  outputSha256,
  outputMime: 'image/png',
  outputBytes: 1024,
  privatePath: `outputs/v1/${outputSha256}.png`,
  publicPath: `approved/v1/${outputSha256}.png`,
  publicUrl,
  model: 'gpt-image-2',
  promptVersion: 'hockey-life-editorial-caricature-v1',
  cacheHit: false,
} as const;

describe('Hockey Life Times action authorization', () => {
  const verifyAccess = verifyLeagueOwnerAccess as jest.MockedFunction<typeof verifyLeagueOwnerAccess>;
  const createService = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;

  beforeEach(() => jest.clearAllMocks());

  it('rejects an unauthorized caller before creating a service-role client', async () => {
    verifyAccess.mockResolvedValue({ authorized: false, error: 'Not authorized' });
    await expect(getHockeyLifeTimesSetup('league-1')).resolves.toEqual({
      success: false,
      error: 'Not authorized',
    });
    expect(createService).not.toHaveBeenCalled();
  });

  it('does not expose the workflow to another tenant', async () => {
    verifyAccess.mockResolvedValue({ authorized: true, accessType: 'league_admin' });
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      single: jest.fn(async () => ({
        data: { id: 'league-1', name: 'Other League', slug: 'other-league', timezone: 'America/Toronto' },
        error: null,
      })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    createService.mockReturnValue({ from: jest.fn(() => query) } as never);

    await expect(getHockeyLifeTimesSetup('league-1')).resolves.toEqual({
      success: true,
      data: { enabled: false, seasons: [] },
    });
    expect(query.eq).toHaveBeenCalledWith('id', 'league-1');
  });
});

describe('Hockey Life Times artwork integration', () => {
  it('wires the real function between claim and completion and fails the claimed lease on errors', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../hockey-life-times.ts'), 'utf8');
    const invokeAt = source.indexOf("functions.invoke('generate-newspaper-illustrations'");
    const completeAt = source.indexOf("'complete_newspaper_generation'", invokeAt);
    const failAt = source.indexOf("'fail_newspaper_generation'", completeAt);
    expect(invokeAt).toBeGreaterThan(source.indexOf("'begin_newspaper_generation'"));
    expect(completeAt).toBeGreaterThan(invokeAt);
    expect(failAt).toBeGreaterThan(completeAt);
    expect(source).toContain('p_edition_json: illustratedEdition');
    expect(source).toContain('p_lease_seconds: 180');
  });

  it('strictly decodes the exact requested player mapping', () => {
    expect(decodeIllustrationResponse({ illustrations: [illustration] }, [playerId]).get(playerId)).toEqual(illustration);
  });

  it('binds lead, star, and game art only through matching featured player IDs', () => {
    const map = decodeIllustrationResponse({ illustrations: [illustration] }, [playerId]);
    const edition = {
      lead: { headline: 'Lead', dek: 'Dek', body: ['Body'] },
      stars: [{ playerId, name: 'Synthetic Player', teamName: 'Home', goals: 1, assists: 0, points: 1, reason: 'Verified.', photoUrl: 'https://source.invalid/photo.jpg' }],
      games: [{ contributors: [{ playerId, name: 'Synthetic Player', teamName: 'Home', goals: 1, assists: 0, points: 1 }] }],
    } as any;
    const bound = bindIllustrationsToEdition(edition, map);
    expect(bound.lead.imageUrl).toBe(publicUrl);
    expect(bound.stars[0].illustrationUrl).toBe(publicUrl);
    expect(bound.stars[0].photoUrl).toBeUndefined();
    expect(bound.games[0].imageUrl).toBe(publicUrl);
    expect(bound.media).toEqual({
      schemaVersion: 1,
      assets: [{
        playerId,
        sourcePhotoSha256: illustration.sourcePhotoSha256,
        outputSha256,
        outputMime: 'image/png',
        outputBytes: 1024,
        privatePath: `outputs/v1/${outputSha256}.png`,
        publicPath: `approved/v1/${outputSha256}.png`,
        publicUrl,
        model: 'gpt-image-2',
        promptVersion: 'hockey-life-editorial-caricature-v1',
      }],
    });
  });

  it.each([
    ['omission', { illustrations: [] }],
    ['duplicate', { illustrations: [illustration, illustration] }],
    ['foreign id', { illustrations: [{ ...illustration, playerId: '44444444-4444-4444-8444-444444444444' }] }],
    ['unsafe url', { illustrations: [{ ...illustration, publicUrl: 'https://example.com/source-photo.jpg' }] }],
    ['wrong model', { illustrations: [{ ...illustration, model: 'other-model' }] }],
    ['invalid hash', { illustrations: [{ ...illustration, sourcePhotoSha256: 'ABC' }] }],
  ])('rejects %s responses', (_label, response) => {
    expect(() => decodeIllustrationResponse(response, [playerId])).toThrow();
  });

  it('canonicalizes unordered facts while binding identity changes into the digest', () => {
    const base = {
      games: [] as never[], goals: [] as never[], standings: [] as never[], upcoming: [] as never[], playerStats: [] as never[],
      profiles: [{ id: playerId, name: 'Synthetic Player', photoUrl: 'https://example.invalid/a.png' }],
    };
    expect(canonicalFactDigest(base)).toBe(canonicalFactDigest({ ...base, profiles: [...base.profiles].reverse() }));
    expect(canonicalFactDigest(base)).not.toBe(canonicalFactDigest({ ...base, profiles: [{ ...base.profiles[0], name: 'Changed Name' }] }));
  });

  it('re-reads and validates the semantic fact snapshot after media promotion and immediately before publish', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../hockey-life-times.ts'), 'utf8');
    const publishAction = source.slice(source.indexOf('export async function publishHockeyLifeTimesEdition'));
    const promoteAt = publishAction.indexOf('await promoteApprovedMedia');
    const reloadAt = publishAction.indexOf('await loadPeriodGames', promoteAt);
    const regatherAt = publishAction.indexOf('await gatherEditionFacts', reloadAt);
    const finalReloadAt = publishAction.indexOf('await loadPeriodGames', reloadAt + 1);
    const validateAt = publishAction.indexOf('assertFreshPublicationFacts', finalReloadAt);
    const publishAt = publishAction.indexOf("'publish_newspaper_edition'", validateAt);

    expect(promoteAt).toBeGreaterThan(-1);
    expect(reloadAt).toBeGreaterThan(promoteAt);
    expect(regatherAt).toBeGreaterThan(reloadAt);
    expect(finalReloadAt).toBeGreaterThan(regatherAt);
    expect(validateAt).toBeGreaterThan(finalReloadAt);
    expect(publishAt).toBeGreaterThan(validateAt);
  });

  it('rejects score, final-status, and covered-game-set drift from a reviewed draft', () => {
    const game = {
      id: 'game-1', leagueId: 'league-1', seasonId: 'season-1',
      scheduledAt: '2026-09-23T01:00:00Z', status: 'completed', gameType: 'regular', location: 'Rink',
      homeScore: 3, awayScore: 2,
      homeTeam: { id: 'home', name: 'Home' }, awayTeam: { id: 'away', name: 'Away' },
    };
    const facts = {
      games: [game], goals: [] as never[], profiles: [] as never[], standings: [] as never[],
      upcoming: [] as never[], playerStats: [] as never[],
    };
    const snapshot = { gameIds: ['game-1'], factPackDigest: canonicalFactDigest(facts) };

    expect(() => assertFreshPublicationFacts(snapshot, facts, 'league-1', 'season-1')).not.toThrow();
    expect(() => assertFreshPublicationFacts(snapshot, {
      ...facts, games: [{ ...game, homeScore: 4 }],
    }, 'league-1', 'season-1')).toThrow(/facts changed/i);
    expect(() => assertFreshPublicationFacts(snapshot, {
      ...facts, games: [{ ...game, status: 'scheduled' }],
    }, 'league-1', 'season-1')).toThrow(/review.*again/i);
    expect(() => assertFreshPublicationFacts(snapshot, {
      ...facts, games: [game, { ...game, id: 'game-2' }],
    }, 'league-1', 'season-1')).toThrow(/game set changed/i);
  });
});
