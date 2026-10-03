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

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { verifyLeagueOwnerAccess } from '../permissions';
import { updateArticleImage } from '../ai-articles';
import { updateNewsArticle } from '../news';

function queryResult(data: unknown, error: unknown = null) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'update']) {
    query[method] = jest.fn(() => query);
  }
  query.single = jest.fn(async () => ({ data, error }));
  query.maybeSingle = jest.fn(async () => ({ data, error }));
  return query;
}

describe('newspaper-linked generic article guards', () => {
  const verifyAccess = verifyLeagueOwnerAccess as jest.MockedFunction<typeof verifyLeagueOwnerAccess>;
  const createUser = createClient as jest.MockedFunction<typeof createClient>;
  const createService = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    verifyAccess.mockResolvedValue({ authorized: true, accessType: 'league_admin' });
  });

  it('rejects generic body mutation of a linked newspaper article before writing', async () => {
    const article = queryResult({ league_id: 'league-1', type: 'weekly_wrap', title: 'Original' });
    const linked = queryResult({ id: 'edition-1' });
    const service = { from: jest.fn((table: string) => table === 'articles' ? article : linked) };
    createService.mockReturnValue(service as never);
    createUser.mockResolvedValue({} as never);

    await expect(updateNewsArticle('article-1', { content: 'Tampered' })).resolves.toEqual({
      success: false,
      error: expect.stringMatching(/newspaper.*frozen/i),
    });
    expect(article.update).not.toHaveBeenCalled();
  });

  it('renames a linked newspaper article through the scoped audited RPC only', async () => {
    const existing = queryResult({ league_id: 'league-1', type: 'weekly_wrap', title: 'Original' });
    const linked = queryResult({ id: 'edition-1' });
    const renamed = { id: 'article-1', league_id: 'league-1', type: 'weekly_wrap', title: 'HLT: Week 1 - Fall 2026', published: true };
    const rpc = jest.fn(async () => ({ data: renamed, error: null }));
    const service = { from: jest.fn((table: string) => table === 'articles' ? existing : linked), rpc };
    createService.mockReturnValue(service as never);
    createUser.mockResolvedValue({ auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'admin-1' } } })) } } as never);

    await expect(updateNewsArticle('article-1', { title: '  HLT: Week 1 - Fall 2026  ', expectedTitle: 'Original' })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({ title: 'HLT: Week 1 - Fall 2026' }),
    });
    expect(rpc).toHaveBeenCalledWith('rename_newspaper_article', {
      p_article_id: 'article-1',
      p_league_id: 'league-1',
      p_changed_by: 'admin-1',
      p_expected_title: 'Original',
      p_title: 'HLT: Week 1 - Fall 2026',
    });
    expect(existing.update).not.toHaveBeenCalled();
  });

  it('requires the protected editor to supply its originally loaded title', async () => {
    const existing = queryResult({ league_id: 'league-1', type: 'weekly_wrap' });
    const linked = queryResult({ id: 'edition-1' });
    const rpc = jest.fn();
    createService.mockReturnValue({ from: jest.fn((table: string) => table === 'articles' ? existing : linked), rpc } as never);

    await expect(updateNewsArticle('article-1', { title: 'Renamed' })).resolves.toEqual({
      success: false,
      error: expect.stringMatching(/reload/i),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a linked title rename when the authenticated transport has no user', async () => {
    const existing = queryResult({ league_id: 'league-1', type: 'weekly_wrap', title: 'Original' });
    const linked = queryResult({ id: 'edition-1' });
    const rpc = jest.fn();
    createService.mockReturnValue({ from: jest.fn((table: string) => table === 'articles' ? existing : linked), rpc } as never);
    createUser.mockResolvedValue({ auth: { getUser: jest.fn(async () => ({ data: { user: null } })) } } as never);

    await expect(updateNewsArticle('article-1', { title: 'Renamed', expectedTitle: 'Original' })).resolves.toEqual({
      success: false,
      error: 'Not authenticated',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a linked title save when immutable fields are also submitted', async () => {
    const article = queryResult({ league_id: 'league-1', type: 'weekly_wrap', title: 'Original' });
    const linked = queryResult({ id: 'edition-1' });
    const service = { from: jest.fn((table: string) => table === 'articles' ? article : linked), rpc: jest.fn() };
    createService.mockReturnValue(service as never);

    await expect(updateNewsArticle('article-1', { title: 'Renamed', slug: 'changed' })).resolves.toEqual({
      success: false,
      error: expect.stringMatching(/newspaper.*frozen/i),
    });
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it('allows a linked article visibility-only update without touching entity tags', async () => {
    const existing = queryResult({ league_id: 'league-1', type: 'weekly_wrap' });
    const updated = queryResult({
      id: 'article-1', league_id: 'league-1', type: 'weekly_wrap', published: false,
    });
    const linked = queryResult({ id: 'edition-1' });
    let articleCalls = 0;
    const service = {
      from: jest.fn((table: string) => {
        if (table === 'newspaper_editions') return linked;
        articleCalls += 1;
        return articleCalls === 1 ? existing : updated;
      }),
    };
    createService.mockReturnValue(service as never);
    createUser.mockResolvedValue({} as never);

    const result = await updateNewsArticle('article-1', { published: false });
    expect(result.success).toBe(true);
    expect(updated.update).toHaveBeenCalledWith(expect.objectContaining({ published: false }));
    expect(updated.update.mock.calls[0][0]).not.toHaveProperty('title');
    expect(service.from).not.toHaveBeenCalledWith('article_game_tags');
    expect(service.from).not.toHaveBeenCalledWith('article_player_tags');
    expect(service.from).not.toHaveBeenCalledWith('article_team_tags');
  });

  it('preserves omitted tags on an ordinary article update', async () => {
    const existing = queryResult({ league_id: 'league-1', type: 'news' });
    const updated = queryResult({
      id: 'article-2', league_id: 'league-1', type: 'news', title: 'Updated', published: false,
    });
    const unlinked = queryResult(null);
    let articleCalls = 0;
    const service = {
      from: jest.fn((table: string) => {
        if (table === 'newspaper_editions') return unlinked;
        articleCalls += 1;
        return articleCalls === 1 ? existing : updated;
      }),
    };
    createService.mockReturnValue(service as never);

    const result = await updateNewsArticle('article-2', { title: 'Updated' });
    expect(result.success).toBe(true);
    expect(service.from).not.toHaveBeenCalledWith('article_game_tags');
    expect(service.from).not.toHaveBeenCalledWith('article_player_tags');
    expect(service.from).not.toHaveBeenCalledWith('article_team_tags');
  });

  it('rejects the separate image mutation path for a linked article', async () => {
    const article = queryResult({ league_id: 'league-1' });
    const linked = queryResult({ id: 'edition-1' });
    createUser.mockResolvedValue({ from: jest.fn(() => article) } as never);
    createService.mockReturnValue({ from: jest.fn(() => linked) } as never);

    await expect(updateArticleImage('article-1', 'https://example.invalid/replacement.png')).resolves.toEqual({
      success: false,
      error: expect.stringMatching(/newspaper.*frozen/i),
    });
    expect(article.update).not.toHaveBeenCalled();
  });

  it('keeps privileged tag synchronization out of the server-action export surface', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../article-entities.ts'), 'utf8');
    expect(source).not.toMatch(/export async function syncArticleEntityTags/);
  });
});

describe('admin busy cleanup contract', () => {
  it('clears busy state in finally for every awaited workflow handler', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../components/news/HockeyLifeTimesGenerator.tsx'),
      'utf8',
    );
    for (const handler of ['checkReadiness', 'generateDraft', 'publishEdition', 'saveNarrative']) {
      const body = source.match(new RegExp(`async function ${handler}\\(\\) \\{([\\s\\S]*?)\\n  \\}`, 'm'))?.[1] || '';
      expect(body).toMatch(/try\s*\{/);
      expect(body).toMatch(/finally\s*\{[\s\S]*?setBusy\(null\)/);
    }
  });
});
