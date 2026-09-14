import { NextRequest } from 'next/server';

let mockSupabaseClient: PublicContentDatabase;
jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => mockSupabaseClient,
  createClient: async () => mockSupabaseClient,
}));

import { handlePublicLeagueContentRequest } from '@/lib/public-league-content';
import {
  SOURCE_PAGE_SIZE,
  createDefaultPublicLeagueContentSource,
  createPublicLeagueContentSource,
  type PublicContentDatabase,
} from '@/lib/public-league-content-source';
import { getStandings, getUnifiedGoalieStatsRows, getUnifiedSkaterStatsRows } from '@/lib/data';

type Row = Record<string, unknown>;
type QueryLog = { table: string; projection: string; filters: Array<[string, string, unknown]>; range: [number, number] | null };

// SYNTHETIC FIXTURE: projection/filter-aware PostgREST fake, never production facts.
function semanticDatabase(fixtures: Record<string, Row[]>, fail?: { table: string; offset: number; error?: unknown; inContains?: unknown; maxInValues?: number }, rpcError?: unknown) {
  const logs: QueryLog[] = [];
  const project = (row: Row, projection: string) => {
    if (!projection || projection.trim() === '*') return { ...row };
    const fields: string[] = [];
    let token = '';
    let depth = 0;
    for (const character of projection) {
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (character === ',' && depth === 0) { fields.push(token); token = ''; continue; }
      token += character;
    }
    fields.push(token);
    return Object.fromEntries(fields.map((field) => {
      const normalized = field.trim();
      const key = normalized.includes(':') ? normalized.slice(0, normalized.indexOf(':')).trim() : normalized.split(/\s|\(/)[0];
      return [key, row[key]];
    }).filter(([key]) => Boolean(key)));
  };
  class Query {
    projection = '';
    filters: Array<[string, string, unknown]> = [];
    rangeValue: [number, number] | null = null;
    constructor(readonly table: string) {}
    select(value: string) { this.projection = value; return this; }
    eq(key: string, value: unknown) { this.filters.push(['eq', key, value]); return this; }
    in(key: string, value: unknown[]) { this.filters.push(['in', key, value]); return this; }
    is(key: string, value: unknown) { this.filters.push(['is', key, value]); return this; }
    lte(key: string, value: unknown) { this.filters.push(['lte', key, value]); return this; }
    or(value: string) { this.filters.push(['or', '', value]); return this; }
    order() { return this; }
    limit(value: number) { this.rangeValue = [0, value - 1]; return this; }
    range(from: number, to: number) { this.rangeValue = [from, to]; return this; }
    maybeSingle() { return this.execute(true); }
    single() { return this.execute(true); }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return this.execute(false).then(resolve, reject); }
    async execute(single: boolean) {
      logs.push({ table: this.table, projection: this.projection, filters: [...this.filters], range: this.rangeValue });
      const offset = this.rangeValue?.[0] ?? 0;
      const failedIn = fail?.inContains === undefined || this.filters.some(([kind, , value]) => kind === 'in' && (value as unknown[]).includes(fail.inContains));
      const oversizedIn = fail?.maxInValues != null && this.filters.some(([kind, , value]) => kind === 'in' && (value as unknown[]).length > fail.maxInValues!);
      if (fail?.table === this.table && ((fail.offset === offset && failedIn) || oversizedIn)) return { data: null, error: fail?.error ?? { code: 'SYNTHETIC_FAILURE', message: 'synthetic failure' }, count: null };
      let rows = [...(fixtures[this.table] || [])];
      for (const [kind, key, value] of this.filters) {
        if (kind === 'eq') rows = rows.filter((row) => row[key] === value);
        if (kind === 'in') rows = rows.filter((row) => (value as unknown[]).includes(row[key]));
        if (kind === 'lte') rows = rows.filter((row) => row[key] == null || String(row[key]) <= String(value));
        if (kind === 'is') rows = rows.filter((row) => row[key] === value);
        if (kind === 'or') {
          const match = /^start_time\.gte\.([^,]+),end_time\.gte\.(.+)$/.exec(String(value));
          if (!match) throw new Error(`Unsupported synthetic OR filter: ${String(value)}`);
          rows = rows.filter((row) => String(row.start_time) >= match[1] || (row.end_time != null && String(row.end_time) >= match[2]));
        }
      }
      if (this.rangeValue) rows = rows.slice(this.rangeValue[0], this.rangeValue[1] + 1);
      rows = rows.map((row) => project(row, this.projection));
      return { data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
    }
  }
  return {
    client: { from: (table: string) => new Query(table), rpc: async () => ({ data: null, error: rpcError ?? { code: 'PGRST202', message: "Could not find the function 'get_team_standings' in the schema cache" } }) } as unknown as PublicContentDatabase,
    logs,
  };
}

const LEAGUE = {
  id: '10000000-0000-4000-8000-000000000001',
  slug: 'hockey-life',
  name: 'Synthetic Hockey League',
  created_at: '2020-01-01T00:00:00.000Z',
};

function uuidFor(index: number) {
  return `f0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function syntheticArticle(index: number, extra: Row = {}): Row {
  return {
    id: uuidFor(index),
    league_id: LEAGUE.id,
    slug: `story-${index}`,
    title: `Synthetic story ${index}`,
    excerpt: null,
    image_url: 'https://images.example/story.jpg',
    type: 'news',
    published: true,
    published_at: `2026-09-${String((index % 9) + 1).padStart(2, '0')}T12:00:00.000Z`,
    created_at: '2026-09-01T12:00:00.000Z',
    author_id: null,
    author: null,
    private_editor_notes: 'must not be selected',
    ...extra,
  };
}

describe('default public content source news/gallery composition', () => {
  it('uses published/released projections and includes a unique later-page news sentinel', async () => {
    const articles = Array.from({ length: SOURCE_PAGE_SIZE + 1 }, (_, index) => syntheticArticle(index));
    articles.push(syntheticArticle(900, { id: 'draft', slug: 'draft', published: false }));
    articles.push(syntheticArticle(901, { slug: 'future', published_at: '2027-01-01T00:00:00.000Z' }));
    const { client, logs } = semanticDatabase({ articles });
    const source = createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00.000Z'));

    const result = await source.loadNews();

    expect(result).toHaveLength(SOURCE_PAGE_SIZE + 1);
    expect(result.some((article) => article.id === uuidFor(SOURCE_PAGE_SIZE))).toBe(true);
    expect(result.some((article) => article.id === uuidFor(900) || article.id === uuidFor(901))).toBe(false);
    expect(logs.filter((log) => log.table === 'articles').map((log) => log.range?.[0])).toEqual([0, SOURCE_PAGE_SIZE]);
    expect(logs.filter((log) => log.table === 'articles').every((log) => !log.projection.includes('*') && !log.projection.includes('private_editor_notes'))).toBe(true);
    expect(result.every((article) => !('private_editor_notes' in article))).toBe(true);
  });

  it('fails the real HTTP composition when a later page fails', async () => {
    const { client } = semanticDatabase(
      { articles: Array.from({ length: SOURCE_PAGE_SIZE + 1 }, (_, index) => syntheticArticle(index)) },
      { table: 'articles', offset: SOURCE_PAGE_SIZE },
    );
    const source = createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00.000Z'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await handlePublicLeagueContentRequest(
        new NextRequest('https://hockey-life.beerleaguehockey.ca/api/public/league-content?leagueSlug=hockey-life&view=news', { headers: { host: 'hockey-life.beerleaguehockey.ca' } }),
        {
          now: () => new Date('2026-09-13T12:00:00.000Z'),
          getLeagueBySlug: async () => ({ ...LEAGUE, status: 'active' }),
          hasPlatformSubscription: async () => true,
          createSource: () => source,
        },
      );
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe('CONTENT_DATA_UNAVAILABLE');
    } finally {
      log.mockRestore();
    }
  });

  it('binds a public album to the league before reading complete photos and reconciles counts', async () => {
    const albumId = '20000000-0000-4000-8000-000000000002';
    const photos = Array.from({ length: SOURCE_PAGE_SIZE + 1 }, (_, index) => ({
      id: uuidFor(1000 + index), gallery_id: albumId, url: `https://images.example/${index}.jpg`,
      thumbnail_url: null, caption: null, display_order: index, private_exif: 'hidden',
    }));
    const { client, logs } = semanticDatabase({
      league_gallery: [{ id: albumId, league_id: LEAGUE.id, season_id: null, title: 'Synthetic Album', description: null, cover_photo_url: null, is_published: true, created_at: '2026-04-02T00:00:00.000Z' }],
      gallery_photos: photos,
    });
    const source = createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00.000Z'));

    const result = await source.loadAlbum(albumId);

    expect(result?.photos).toHaveLength(SOURCE_PAGE_SIZE + 1);
    expect(result?.album.photoCount).toBe(SOURCE_PAGE_SIZE + 1);
    expect(result?.photos.every((photo) => !('private_exif' in photo))).toBe(true);
    expect(logs[0]).toMatchObject({ table: 'league_gallery', filters: expect.arrayContaining([
      ['eq', 'league_id', LEAGUE.id], ['eq', 'is_published', true], ['eq', 'id', albumId],
    ]) });
    expect(logs.findIndex((entry) => entry.table === 'gallery_photos')).toBeGreaterThan(0);
  });
});

describe('default public content source events/contact composition', () => {
  it('serializes the published tenant event window and preserves qualifying unknown types in deterministic order', async () => {
    const foreignLeague = '20000000-0000-4000-8000-000000000002';
    const { client, logs } = semanticDatabase({
      league_events: [
        { id: uuidFor(7001), league_id: LEAGUE.id, title: 'Future clinic', description: null, event_type: 'skills-clinic', location: 'Synthetic Rink', start_time: '2026-09-20T10:00:00Z', end_time: null, is_published: true, private_notes: 'hidden' },
        { id: uuidFor(7002), league_id: LEAGUE.id, title: 'Happening now', description: 'Synthetic ongoing event', event_type: 'general', location: null, start_time: '2026-09-01T10:00:00Z', end_time: '2026-09-13T13:00:00Z', is_published: true },
        { id: uuidFor(7003), league_id: LEAGUE.id, title: 'Recent event', description: null, event_type: 'social', location: null, start_time: '2026-09-07T12:00:00Z', end_time: '2026-09-07T13:00:00Z', is_published: true },
        { id: uuidFor(7004), league_id: LEAGUE.id, title: 'Expired old event', event_type: 'meeting', start_time: '2026-09-01T12:00:00Z', end_time: '2026-09-01T13:00:00Z', is_published: true },
        { id: uuidFor(7005), league_id: LEAGUE.id, title: 'Draft event', event_type: 'general', start_time: '2026-09-20T12:00:00Z', end_time: null, is_published: false },
        { id: uuidFor(7006), league_id: foreignLeague, title: 'Foreign event', event_type: 'general', start_time: '2026-09-20T12:00:00Z', end_time: null, is_published: true },
      ],
    });
    const source = createPublicLeagueContentSource(
      client,
      { ...LEAGUE, timezone: 'America/Toronto' },
      new Date('2026-09-13T12:00:00.000Z'),
    );

    const result = await source.loadEvents!();

    expect(result.timeZone).toBe('America/Toronto');
    expect(result.windowStart).toBe('2026-09-06T12:00:00.000Z');
    expect(result.events.map((event) => [event.title, event.eventType])).toEqual([
      ['Happening now', 'general'],
      ['Recent event', 'social'],
      ['Future clinic', 'skills-clinic'],
    ]);
    expect(result.events[2]).toEqual({
      id: uuidFor(7001), title: 'Future clinic', description: null, eventType: 'skills-clinic',
      location: 'Synthetic Rink', startTime: '2026-09-20T10:00:00.000Z', endTime: null,
    });
    expect(result.events.every((event) => !('private_notes' in event))).toBe(true);
    expect(logs[0]).toMatchObject({
      table: 'league_events',
      projection: 'id, league_id, title, description, event_type, location, start_time, end_time, is_published',
      filters: [
        ['eq', 'league_id', LEAGUE.id],
        ['eq', 'is_published', true],
        ['or', '', 'start_time.gte.2026-09-06T12:00:00.000Z,end_time.gte.2026-09-13T12:00:00.000Z'],
      ],
      range: [0, SOURCE_PAGE_SIZE - 1],
    });
  });

  it('maps public contact fields and suppresses values that cannot form safe native actions', async () => {
    const source = createPublicLeagueContentSource(
      semanticDatabase({}).client,
      {
        ...LEAGUE,
        contact_email: 'league@example.test',
        contact_phone: '+1 (416) 555-0100',
        website_url: 'javascript:alert(1)',
        address: '1 Synthetic Way',
        city: 'Toronto',
        state_province: 'ON',
        postal_code: 'A1A 1A1',
      },
      new Date('2026-09-13T12:00:00.000Z'),
    );

    await expect(source.loadContact!()).resolves.toEqual({
      email: 'league@example.test',
      phone: '+1 (416) 555-0100',
      websiteUrl: null,
      address: '1 Synthetic Way',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'A1A 1A1',
    });
  });

  it('freezes the Contact address boundary at 1000 and fails the HTTP producer explicitly at 1001', async () => {
    const exactAddress = 'A'.repeat(1000);
    const exactSource = createPublicLeagueContentSource(
      semanticDatabase({}).client,
      { ...LEAGUE, address: exactAddress },
      new Date('2026-09-13T12:00:00.000Z'),
    );
    await expect(exactSource.loadContact()).resolves.toMatchObject({ address: exactAddress });

    const oversizedLeague = { ...LEAGUE, status: 'active', address: 'A'.repeat(1001) };
    const oversizedSource = createPublicLeagueContentSource(
      semanticDatabase({}).client,
      oversizedLeague,
      new Date('2026-09-13T12:00:00.000Z'),
    );
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await handlePublicLeagueContentRequest(
        new NextRequest('https://hockey-life.beerleaguehockey.ca/api/public/league-content?leagueSlug=hockey-life&view=contact', { headers: { host: 'hockey-life.beerleaguehockey.ca' } }),
        {
          now: () => new Date('2026-09-13T12:00:00.000Z'),
          getLeagueBySlug: async () => oversizedLeague,
          hasPlatformSubscription: async () => true,
          createSource: () => oversizedSource,
        },
      );
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: { code: 'CONTENT_DATA_UNAVAILABLE', message: 'Public content is temporarily unavailable.' } });
    } finally {
      log.mockRestore();
    }
  });

  it('preserves LF, CRLF, and blank lines in display-only addresses while rejecting invalid controls', async () => {
    const address = '123 Test Street\nSuite 4\r\n\r\nToronto';
    const source = createPublicLeagueContentSource(
      semanticDatabase({}).client,
      { ...LEAGUE, address },
      new Date('2026-09-13T12:00:00.000Z'),
    );
    await expect(source.loadContact()).resolves.toMatchObject({ address });

    const blank = createPublicLeagueContentSource(
      semanticDatabase({}).client,
      { ...LEAGUE, address: ' \r\n ' },
      new Date('2026-09-13T12:00:00.000Z'),
    );
    await expect(blank.loadContact()).resolves.toMatchObject({ address: null });

    const invalid = createPublicLeagueContentSource(
      semanticDatabase({}).client,
      { ...LEAGUE, address: '123 Test Street\u0000Suite 4', contact_email: 'league@example.test\r\nBcc:other@example.test' },
      new Date('2026-09-13T12:00:00.000Z'),
    );
    await expect(invalid.loadContact()).resolves.toMatchObject({ address: null, email: null });
  });

  it('bounds Contact website URLs after canonicalization without changing shared media behavior', async () => {
    const rootRelative = createPublicLeagueContentSource(
      semanticDatabase({}).client,
      { ...LEAGUE, website_url: '/contact' },
      new Date('2026-09-13T12:00:00.000Z'),
    );
    await expect(rootRelative.loadContact()).resolves.toMatchObject({
      websiteUrl: 'https://hockey-life.beerleaguehockey.ca/contact',
    });

    const oversizedRelative = createPublicLeagueContentSource(
      semanticDatabase({}).client,
      { ...LEAGUE, website_url: `/${'a'.repeat(4079)}` },
      new Date('2026-09-13T12:00:00.000Z'),
    );
    await expect(oversizedRelative.loadContact()).resolves.toMatchObject({ websiteUrl: null });

    const expandingUnicode = createPublicLeagueContentSource(
      semanticDatabase({}).client,
      { ...LEAGUE, website_url: `https://example.test/${'é'.repeat(700)}` },
      new Date('2026-09-13T12:00:00.000Z'),
    );
    await expect(expandingUnicode.loadContact()).resolves.toMatchObject({ websiteUrl: null });
  });

  it('treats blank nullable event fields as missing without fabricating content', async () => {
    const { client } = semanticDatabase({ league_events: [{
      id: uuidFor(7010), league_id: LEAGUE.id, title: 'Synthetic blank optionals',
      description: '   ', event_type: 'general', location: '\t',
      start_time: '2026-09-14T12:00:00Z', end_time: null, is_published: true,
    }] });
    const source = createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00Z'));

    await expect(source.loadEvents!()).resolves.toMatchObject({
      events: [{ description: null, location: null }],
    });
  });

  it('reads every event page and turns a later provider failure into an explicit HTTP error', async () => {
    const rows = Array.from({ length: SOURCE_PAGE_SIZE + 1 }, (_, index) => ({
      id: uuidFor(7100 + index), league_id: LEAGUE.id, title: `Synthetic event ${index}`,
      description: null, event_type: 'general', location: null,
      start_time: '2026-09-20T12:00:00Z', end_time: null, is_published: true,
    }));
    const complete = semanticDatabase({ league_events: rows });
    const completeSource = createPublicLeagueContentSource(complete.client, LEAGUE, new Date('2026-09-13T12:00:00Z'));
    await expect(completeSource.loadEvents!()).resolves.toMatchObject({ events: expect.arrayContaining([
      expect.objectContaining({ id: uuidFor(7100 + SOURCE_PAGE_SIZE) }),
    ]) });
    expect(complete.logs.filter((entry) => entry.table === 'league_events').map((entry) => entry.range?.[0])).toEqual([0, SOURCE_PAGE_SIZE]);

    const failed = semanticDatabase({ league_events: rows }, { table: 'league_events', offset: SOURCE_PAGE_SIZE });
    const failedSource = createPublicLeagueContentSource(failed.client, LEAGUE, new Date('2026-09-13T12:00:00Z'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await handlePublicLeagueContentRequest(
        new NextRequest('https://hockey-life.beerleaguehockey.ca/api/public/league-content?leagueSlug=hockey-life&view=events', { headers: { host: 'hockey-life.beerleaguehockey.ca' } }),
        {
          now: () => new Date('2026-09-13T12:00:00Z'),
          getLeagueBySlug: async () => ({ ...LEAGUE, status: 'active' }),
          hasPlatformSubscription: async () => true,
          createSource: () => failedSource,
        },
      );
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: { code: 'CONTENT_DATA_UNAVAILABLE', message: 'Public content is temporarily unavailable.' } });
    } finally {
      log.mockRestore();
    }
  });

  it('rejects invalid event timestamps and ranges, and explicitly falls back to UTC for an invalid timezone', async () => {
    const invalidDate = semanticDatabase({ league_events: [{
      id: uuidFor(7301), league_id: LEAGUE.id, title: 'Invalid date', event_type: 'general',
      start_time: 'not-a-date', end_time: null, is_published: true,
    }] });
    await expect(createPublicLeagueContentSource(invalidDate.client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadEvents!())
      .rejects.toThrow('Invalid published event start time');

    const invalidRange = semanticDatabase({ league_events: [{
      id: uuidFor(7302), league_id: LEAGUE.id, title: 'Invalid range', event_type: 'general',
      start_time: '2026-09-20T12:00:00Z', end_time: '2026-09-19T12:00:00Z', is_published: true,
    }] });
    await expect(createPublicLeagueContentSource(invalidRange.client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadEvents!())
      .rejects.toThrow('Invalid published event time range');

    const empty = createPublicLeagueContentSource(semanticDatabase({}).client, { ...LEAGUE, timezone: 'Mars/Olympus_Mons' }, new Date('2026-09-13T12:00:00Z'));
    await expect(empty.loadEvents!()).resolves.toMatchObject({ timeZone: 'UTC', events: [] });
  });

  it('returns explicit null contact fields without querying a private table', async () => {
    const database = semanticDatabase({});
    const source = createPublicLeagueContentSource(database.client, {
      ...LEAGUE,
      contact_email: 'bad\r\n@example.test',
      contact_phone: 'call-me-maybe',
      website_url: 'data:text/html,bad',
    }, new Date('2026-09-13T12:00:00Z'));

    await expect(source.loadContact!()).resolves.toEqual({
      email: null, phone: null, websiteUrl: null, address: null,
      city: null, state: null, zipCode: null,
    });
    expect(database.logs).toEqual([]);
  });
});

describe('default public content source article/history integrity', () => {
  it('keeps published text unchanged and drops foreign related records', async () => {
    const articleId = '21000000-0000-4000-8000-000000000002';
    const gameId = '30000000-0000-4000-8000-000000000003';
    const playerLocal = '31000000-0000-4000-8000-000000000003';
    const playerForeign = '32000000-0000-4000-8000-000000000003';
    const teamLocal = '33000000-0000-4000-8000-000000000003';
    const teamForeign = '34000000-0000-4000-8000-000000000003';
    const seasonLocal = '35000000-0000-4000-8000-000000000003';
    const { client } = semanticDatabase({
      articles: [{ ...syntheticArticle(1), id: articleId, slug: 'detail', content: 'Exact **published** markdown.', game_id: gameId, season_id: seasonLocal }],
      article_player_tags: [
        { article_id: articleId, player_id: playerLocal },
        { article_id: articleId, player_id: playerForeign },
      ],
      article_team_tags: [{ article_id: articleId, team_id: teamLocal }, { article_id: articleId, team_id: teamForeign }],
      article_game_tags: [{ article_id: articleId, game_id: gameId, is_primary: true }],
      team_rosters: [{ league_id: LEAGUE.id, season_id: seasonLocal, player_id: playerLocal, team_id: teamLocal, profile: { id: playerLocal, full_name: 'Local Player', avatar_url: 'javascript:bad' }, team: { id: teamLocal, league_id: LEAGUE.id, name: 'Local Team' } }],
      teams: [{ id: teamLocal, league_id: LEAGUE.id, name: 'Local Team', logo_url: null }],
      seasons: [{ id: seasonLocal, league_id: LEAGUE.id, name: 'Synthetic Season', start_date: '2026-01-01', end_date: '2026-05-01', status: 'completed' }],
      games: [{ id: gameId, league_id: LEAGUE.id, season_id: seasonLocal, home_team_id: teamLocal, away_team_id: teamForeign, home_score: 4, away_score: 1, scheduled_at: '2026-04-01T00:00:00.000Z', status: 'completed' }],
    });
    const source = createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00.000Z'));

    const article = await source.loadArticle('detail');

    expect(article?.content).toBe('Exact **published** markdown.');
    expect(article?.taggedPlayers).toEqual([{ id: playerLocal, name: 'Local Player', photoUrl: null, teamId: teamLocal, teamName: 'Local Team' }]);
    expect(article?.mentions).toEqual(expect.arrayContaining([
      { text: 'Local Player', kind: 'player', id: playerLocal },
      { text: 'Local Team', kind: 'team', id: teamLocal },
    ]));
    expect(article?.relatedGame).toBeNull();
  });

  it('uses canonical all-time rows and honest championship provenance', async () => {
    const seasonOfficial = '40000000-0000-4000-8000-000000000004';
    const seasonLeader = '50000000-0000-4000-8000-000000000005';
    const seasonPlayoffs = '60000000-0000-4000-8000-000000000006';
    const seasonForeign = '70000000-0000-4000-8000-000000000007';
    const teamOne = '80000000-0000-4000-8000-000000000008';
    const teamTwo = '90000000-0000-4000-8000-000000000009';
    const playerOriginal = 'a0000000-0000-4000-8000-00000000000a';
    const wrongSeasonPlayer = 'b0000000-0000-4000-8000-00000000000b';
    const { client } = semanticDatabase({
      seasons: [
        { id: seasonPlayoffs, league_id: LEAGUE.id, name: 'Playoffs Past Date', start_date: '2026-01-01', end_date: '2026-02-01', status: 'playoffs', champion_team_id: null },
        { id: seasonForeign, league_id: LEAGUE.id, name: 'Foreign Champion', start_date: '2024-01-01', end_date: '2024-05-01', status: 'completed', champion_team_id: 'foreign-team' },
        { id: seasonLeader, league_id: LEAGUE.id, name: 'Same Year Alpha', start_date: '2025-06-01', end_date: '2025-09-01', status: 'completed', champion_team_id: null },
        { id: seasonOfficial, league_id: LEAGUE.id, name: 'Same Year Zulu', start_date: '2025-01-01', end_date: '2025-05-01', status: 'completed', champion_team_id: teamOne, season_summary: 'Recorded summary' },
      ],
      teams: [
        { id: teamOne, league_id: LEAGUE.id, name: 'Team One', logo_url: 'https://images.example/one.png' },
        { id: teamTwo, league_id: LEAGUE.id, name: 'Team Two', logo_url: null },
      ],
      games: [
        { id: uuidFor(2001), league_id: LEAGUE.id, season_id: seasonOfficial, home_team_id: teamOne, away_team_id: teamTwo, home_score: 3, away_score: 1, scheduled_at: '2025-04-01T00:00:00.000Z', status: 'completed', game_type: 'playoff', playoff_series_id: uuidFor(2101) },
        { id: uuidFor(2002), league_id: LEAGUE.id, season_id: seasonLeader, home_team_id: teamTwo, away_team_id: teamOne, home_score: 2, away_score: 1, scheduled_at: '2025-08-01T00:00:00.000Z', status: 'completed' },
        { id: uuidFor(2003), league_id: LEAGUE.id, season_id: seasonForeign, home_team_id: teamOne, away_team_id: teamTwo, home_score: 6, away_score: 0, scheduled_at: '2024-04-01T00:00:00.000Z', status: 'completed' },
        { id: uuidFor(2004), league_id: LEAGUE.id, season_id: seasonPlayoffs, home_team_id: teamTwo, away_team_id: teamOne, home_score: 5, away_score: 0, scheduled_at: '2026-01-20T00:00:00.000Z', status: 'completed' },
      ],
      playoff_series: [{ id: uuidFor(2101), league_id: LEAGUE.id, season_id: seasonOfficial, division_id: null, round_number: 1, series_number: 1, high_seed_id: teamOne, low_seed_id: teamTwo, winner_id: teamOne, status: 'completed' }],
      team_rosters: [
        { league_id: LEAGUE.id, season_id: seasonOfficial, team_id: teamOne, player_id: playerOriginal, jersey_number: 9, position: 'C', leadership_role: 'captain', status: 'active', profile: { id: playerOriginal, full_name: 'Original Leader' } },
        { league_id: LEAGUE.id, season_id: seasonLeader, team_id: teamOne, player_id: wrongSeasonPlayer, jersey_number: 1, position: 'G', leadership_role: null, status: 'active', profile: { id: wrongSeasonPlayer, full_name: 'Wrong Season' } },
      ],
      league_awards: [], player_stats: [], goalie_stats: [],
    });
    const canonical = {
      skaters: async () => [{ player_id: playerOriginal, player_name: 'Original Leader', team_id: teamOne, team_name: 'Team One', goals: 7, assists: 11, points: 18 }],
      goalies: async () => [
        { player_id: 'goalie-original', player_name: 'Original Goalie', team_id: teamTwo, team_name: 'Team Two', wins: 6, save_percentage: null, goals_against_average: null },
        { player_id: 'goalie-imported-default', player_name: 'Imported Unknown', team_id: '', team_name: 'Imported career totals', games_played: 10, wins: 5, saves: 0, goals_against: 0, save_percentage: 0, goals_against_average: 0, save_percentage_provenance: 'unmeasured' as const, goals_against_average_provenance: 'unmeasured' as const },
      ],
      legacyChampions: () => [],
    };
    const source = createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00.000Z'), canonical);

    const history = await source.loadHistory();

    expect(history.champions.map((entry) => [entry.seasonId, entry.source])).toEqual([
      [seasonOfficial, 'official'], [seasonLeader, 'standings_leader'],
    ]);
    expect(history.champions[0].roster.map((player) => player.id)).toEqual([playerOriginal]);
    expect(history.dynasties).toEqual([{ teamId: teamOne, teamName: 'Team One', teamLogoUrl: 'https://images.example/one.png', titles: 1 }]);
    expect(history.boards.find((board) => board.metric === 'points')?.entries[0]).toMatchObject({ id: `points:${playerOriginal}`, playerId: playerOriginal, value: 18 });
    expect(history.boards.find((board) => board.metric === 'wins')?.entries[0]).toMatchObject({ id: 'wins:goalie-original', playerId: null, value: 6, savePercentage: null, goalsAgainstAverage: null, provenance: 'canonical_all_time_unmeasured' });
    expect(history.boards.find((board) => board.metric === 'wins')?.entries[1]).toMatchObject({ id: 'wins:goalie-imported-default', value: 5, savePercentage: null, goalsAgainstAverage: null, provenance: 'canonical_all_time_unmeasured' });
    expect(history.seasonStandings.find((entry) => entry.seasonId === seasonOfficial)?.rows[0].teamId).toBe(teamOne);
  });
});

describe('public content adversarial corrections', () => {
  const emptyCanonical = {
    skaters: async () => [],
    goalies: async () => [],
    legacyChampions: () => [],
  };

  it('requires completed-season participation for official champions and uses only a winning playoff final', async () => {
    const seasonWrong = uuidFor(3001);
    const seasonPlayoffs = uuidFor(3002);
    const seasonOfficial = uuidFor(3003);
    const teamWrong = uuidFor(3101);
    const teamOfficial = uuidFor(3102);
    const opponent = uuidFor(3103);
    const { client } = semanticDatabase({
      seasons: [
        { id: seasonWrong, league_id: LEAGUE.id, name: 'Wrong pointer', start_date: '2025-01-01', end_date: '2025-03-01', status: 'completed', champion_team_id: teamWrong },
        { id: seasonPlayoffs, league_id: LEAGUE.id, name: 'Incomplete playoffs', start_date: '2025-04-01', end_date: '2025-06-01', status: 'playoffs', champion_team_id: teamWrong },
        { id: seasonOfficial, league_id: LEAGUE.id, name: 'Recorded champion', start_date: '2025-07-01', end_date: '2025-09-01', status: 'completed', champion_team_id: teamOfficial },
      ],
      teams: [
        { id: teamWrong, league_id: LEAGUE.id, name: 'Wrong Team', logo_url: null },
        { id: teamOfficial, league_id: LEAGUE.id, name: 'Official Team', logo_url: null },
        { id: opponent, league_id: LEAGUE.id, name: 'Opponent', logo_url: null },
      ],
      games: [
        { id: uuidFor(3201), league_id: LEAGUE.id, season_id: seasonOfficial, home_team_id: teamOfficial, away_team_id: opponent, home_score: 4, away_score: 1, scheduled_at: '2025-08-20T00:00:00Z', status: 'completed', game_type: 'playoff', playoff_series_id: uuidFor(3301) },
        { id: uuidFor(3202), league_id: LEAGUE.id, season_id: seasonOfficial, home_team_id: opponent, away_team_id: teamOfficial, home_score: 2, away_score: 1, scheduled_at: '2025-08-25T00:00:00Z', status: 'completed', game_type: 'regular', playoff_series_id: null },
      ],
      playoff_series: [{ id: uuidFor(3301), league_id: LEAGUE.id, season_id: seasonOfficial, division_id: null, round_number: 1, series_number: 1, high_seed_id: teamOfficial, low_seed_id: opponent, winner_id: teamOfficial, status: 'completed' }],
      team_rosters: [], league_awards: [], player_stats: [], goalie_stats: [],
    });
    const history = await createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00Z'), emptyCanonical).loadHistory();

    expect(history.champions.map((entry) => entry.seasonId)).toEqual([seasonOfficial]);
    expect(history.champions[0].finalGame?.id).toBe(uuidFor(3201));
    expect(history.stats.uniqueChampions).toBe(1);
  });

  it('proves a final from the completed maximum round within the same playoff division', async () => {
    const seasonId = uuidFor(3401);
    const champion = uuidFor(3402);
    const opponent = uuidFor(3403);
    const otherA = uuidFor(3404);
    const otherB = uuidFor(3405);
    const divisionA = uuidFor(3406);
    const divisionB = uuidFor(3407);
    const semifinal = uuidFor(3410);
    const pendingFinal = uuidFor(3411);
    const realFinal = uuidFor(3412);
    const otherFinal = uuidFor(3413);
    const base = {
      seasons: [{ id: seasonId, league_id: LEAGUE.id, name: 'Final proof', start_date: '2025-01-01', end_date: '2025-09-01', status: 'completed', champion_team_id: champion }],
      teams: [
        { id: champion, league_id: LEAGUE.id, name: 'Champion', logo_url: null },
        { id: opponent, league_id: LEAGUE.id, name: 'Opponent', logo_url: null },
        { id: otherA, league_id: LEAGUE.id, name: 'Other A', logo_url: null },
        { id: otherB, league_id: LEAGUE.id, name: 'Other B', logo_url: null },
      ],
      team_rosters: [], league_awards: [], player_stats: [], goalie_stats: [],
    };
    const semifinalDb = semanticDatabase({ ...base,
      playoff_series: [
        { id: semifinal, league_id: LEAGUE.id, season_id: seasonId, division_id: null, round_number: 1, series_number: 1, high_seed_id: champion, low_seed_id: opponent, winner_id: champion, status: 'completed' },
        { id: pendingFinal, league_id: LEAGUE.id, season_id: seasonId, division_id: null, round_number: 2, series_number: 1, high_seed_id: champion, low_seed_id: null, winner_id: null, status: 'pending' },
      ],
      games: [
        { id: uuidFor(3420), league_id: LEAGUE.id, season_id: seasonId, home_team_id: champion, away_team_id: opponent, home_score: 4, away_score: 1, scheduled_at: '2025-08-20T00:00:00Z', status: 'completed', game_type: 'playoff', playoff_series_id: semifinal },
      ],
    });
    const semifinalHistory = await createPublicLeagueContentSource(semifinalDb.client, LEAGUE, new Date('2026-09-13T12:00:00Z'), emptyCanonical).loadHistory();
    expect(semifinalHistory.champions[0].finalGame).toBeNull();

    const finalDb = semanticDatabase({ ...base,
      playoff_series: [
        { id: realFinal, league_id: LEAGUE.id, season_id: seasonId, division_id: divisionA, round_number: 2, series_number: 1, high_seed_id: champion, low_seed_id: opponent, winner_id: champion, status: 'completed' },
        { id: otherFinal, league_id: LEAGUE.id, season_id: seasonId, division_id: divisionB, round_number: 2, series_number: 1, high_seed_id: otherA, low_seed_id: otherB, winner_id: otherA, status: 'completed' },
      ],
      games: [
        { id: uuidFor(3421), league_id: LEAGUE.id, season_id: seasonId, home_team_id: champion, away_team_id: opponent, home_score: 3, away_score: 1, scheduled_at: '2025-08-20T00:00:00Z', status: 'completed', game_type: 'playoff', playoff_series_id: realFinal },
        { id: uuidFor(3422), league_id: LEAGUE.id, season_id: seasonId, home_team_id: otherA, away_team_id: otherB, home_score: 2, away_score: 0, scheduled_at: '2025-08-21T00:00:00Z', status: 'completed', game_type: 'playoff', playoff_series_id: otherFinal },
      ],
    });
    const finalHistory = await createPublicLeagueContentSource(finalDb.client, LEAGUE, new Date('2026-09-13T12:00:00Z'), emptyCanonical).loadHistory();
    expect(finalHistory.champions[0].finalGame?.id).toBe(uuidFor(3421));

    const inconsistentDb = semanticDatabase({ ...base,
      playoff_series: [
        { id: realFinal, league_id: 'foreign-league', season_id: seasonId, division_id: null, round_number: 1, series_number: 1, high_seed_id: champion, low_seed_id: opponent, winner_id: champion, status: 'completed' },
        { id: otherFinal, league_id: LEAGUE.id, season_id: seasonId, division_id: null, round_number: 1, series_number: 2, high_seed_id: otherA, low_seed_id: otherB, winner_id: champion, status: 'completed' },
      ],
      games: [
        { id: uuidFor(3423), league_id: LEAGUE.id, season_id: seasonId, home_team_id: champion, away_team_id: opponent, home_score: 3, away_score: 1, scheduled_at: '2025-08-20T00:00:00Z', status: 'completed', game_type: 'playoff', playoff_series_id: realFinal },
        { id: uuidFor(3424), league_id: LEAGUE.id, season_id: seasonId, home_team_id: champion, away_team_id: opponent, home_score: 4, away_score: 2, scheduled_at: '2025-08-21T00:00:00Z', status: 'completed', game_type: 'playoff', playoff_series_id: otherFinal },
      ],
    });
    const inconsistentHistory = await createPublicLeagueContentSource(inconsistentDb.client, LEAGUE, new Date('2026-09-13T12:00:00Z'), emptyCanonical).loadHistory();
    expect(inconsistentHistory.champions[0].finalGame).toBeNull();
  });

  it('keeps player editorial tags navigable while nulling wrong-season metadata and relations', async () => {
    const articleId = uuidFor(4001);
    const seasonArticle = uuidFor(4002);
    const seasonOther = uuidFor(4003);
    const playerHistorical = uuidFor(4004);
    const playerWrongSeason = uuidFor(4005);
    const teamArticle = uuidFor(4006);
    const teamOther = uuidFor(4007);
    const gameOther = uuidFor(4008);
    const { client } = semanticDatabase({
      articles: [{ ...syntheticArticle(4), id: articleId, slug: 'season-story', content: 'Unchanged Player Historical and Wrong Season copy.', season_id: seasonArticle }],
      article_player_tags: [{ article_id: articleId, player_id: playerHistorical }, { article_id: articleId, player_id: playerWrongSeason }],
      article_team_tags: [{ article_id: articleId, team_id: teamArticle }, { article_id: articleId, team_id: teamOther }],
      article_game_tags: [{ article_id: articleId, game_id: gameOther, is_primary: true }],
      seasons: [
        { id: seasonArticle, league_id: LEAGUE.id, name: 'Article Season', start_date: '2026-01-01', end_date: '2026-05-01', status: 'completed' },
        { id: seasonOther, league_id: LEAGUE.id, name: 'Other Season', start_date: '2026-06-01', end_date: '2026-10-01', status: 'active' },
      ],
      teams: [
        { id: teamArticle, league_id: LEAGUE.id, name: 'Article Team', logo_url: null },
        { id: teamOther, league_id: LEAGUE.id, name: 'Other Team', logo_url: null },
      ],
      team_rosters: [
        { league_id: LEAGUE.id, season_id: seasonArticle, player_id: playerHistorical, team_id: teamArticle, profile: { id: playerHistorical, full_name: 'Historical Player', avatar_url: null }, team: { id: teamArticle, league_id: LEAGUE.id, name: 'Article Team' } },
        { league_id: LEAGUE.id, season_id: seasonOther, player_id: playerWrongSeason, team_id: teamOther, profile: { id: playerWrongSeason, full_name: 'Wrong Season Player', avatar_url: null }, team: { id: teamOther, league_id: LEAGUE.id, name: 'Other Team' } },
      ],
      games: [{ id: gameOther, league_id: LEAGUE.id, season_id: seasonOther, home_team_id: teamOther, away_team_id: teamArticle, home_score: 2, away_score: 1, scheduled_at: '2026-08-01T00:00:00Z', status: 'completed' }],
    });
    const article = await createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadArticle('season-story');

    expect(article?.content).toBe('Unchanged Player Historical and Wrong Season copy.');
    expect(article?.taggedPlayers).toEqual([
      { id: playerHistorical, name: 'Historical Player', photoUrl: null, teamId: teamArticle, teamName: 'Article Team' },
      { id: playerWrongSeason, name: 'Wrong Season Player', photoUrl: null, teamId: null, teamName: null },
    ]);
    expect(article?.mentions).toContainEqual({ text: 'Article Team', kind: 'team', id: teamArticle });
    expect(article?.mentions).not.toContainEqual(expect.objectContaining({ id: teamOther }));
    expect(article?.relatedGame).toBeNull();
  });

  it('preserves a global article mention for a historical same-league player without fabricating a current team', async () => {
    const articleId = uuidFor(4051);
    const playerId = uuidFor(4052);
    const teamId = uuidFor(4053);
    const seasonId = uuidFor(4054);
    const { client } = semanticDatabase({
      articles: [{ ...syntheticArticle(5), id: articleId, slug: 'league-history', content: 'Historical league-wide profile.', season_id: null, published_at: '2026-09-01T00:00:00Z' }],
      article_player_tags: [{ article_id: articleId, player_id: playerId }], article_team_tags: [], article_game_tags: [],
      seasons: [{ id: seasonId, league_id: LEAGUE.id, name: 'Historical', start_date: '2020-01-01', end_date: '2020-05-01', status: 'completed' }],
      team_rosters: [{ league_id: LEAGUE.id, season_id: seasonId, player_id: playerId, team_id: teamId, profile: { id: playerId, full_name: 'Retired Player', avatar_url: null }, team: { id: teamId, league_id: LEAGUE.id, name: 'Historical Team' } }],
    });
    const article = await createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadArticle('league-history');
    expect(article?.taggedPlayers).toEqual([{ id: playerId, name: 'Retired Player', photoUrl: null, teamId: null, teamName: null }]);
    expect(article?.mentions).toContainEqual({ id: playerId, kind: 'player', text: 'Retired Player' });
  });

  it('nulls incoherent award winner links and preserves independently known goalie metrics', async () => {
    const seasonA = uuidFor(5001);
    const seasonB = uuidFor(5002);
    const teamA = uuidFor(5003);
    const teamB = uuidFor(5004);
    const playerA = uuidFor(5005);
    const playerB = uuidFor(5006);
    const importedProfile = uuidFor(5007);
    const { client } = semanticDatabase({
      seasons: [{ id: seasonA, league_id: LEAGUE.id, name: 'A', start_date: '2025-01-01', end_date: '2025-04-01', status: 'completed' }, { id: seasonB, league_id: LEAGUE.id, name: 'B', start_date: '2025-05-01', end_date: '2025-08-01', status: 'completed' }],
      teams: [{ id: teamA, league_id: LEAGUE.id, name: 'A Team', logo_url: null }, { id: teamB, league_id: LEAGUE.id, name: 'B Team', logo_url: null }],
      team_rosters: [{ league_id: LEAGUE.id, season_id: seasonA, team_id: teamA, player_id: playerA, status: 'active', profile: { id: playerA, full_name: 'A Player' } }, { league_id: LEAGUE.id, season_id: seasonB, team_id: teamB, player_id: playerB, status: 'active', profile: { id: playerB, full_name: 'B Player' } }],
      games: [], player_stats: [], goalie_stats: [],
      league_awards: [
        { id: uuidFor(5101), league_id: LEAGUE.id, season_id: seasonA, team_id: teamB, player_id: playerB, award_name: 'Wrong Season', description: null, image_url: null, player: { full_name: 'B Player' } },
        { id: uuidFor(5102), league_id: LEAGUE.id, season_id: seasonA, team_id: teamA, player_id: playerA, award_name: 'Valid Historical', description: null, image_url: null, player: { full_name: 'A Player' } },
      ],
    });
    const canonical = {
      skaters: async () => [],
      goalies: async () => [
        { player_id: uuidFor(5201), profile_id: importedProfile, profile_id_league_verified: true, player_name: 'Imported Unknown SV', team_name: 'Imported career totals', wins: 4, games_played: 5, saves: 0, goals_against: 20, save_percentage: 0, goals_against_average: 4 },
        { player_id: uuidFor(5202), player_name: 'Known SV', team_name: 'Imported career totals', wins: 3, games_played: 0, saves: 90, goals_against: 10, save_percentage: 90, goals_against_average: 0, goals_against_average_provenance: 'unmeasured' as const },
        { player_id: uuidFor(5203), player_name: 'Measured Zero', team_name: 'Native Team', wins: 2, games_played: 5, saves: 0, goals_against: 10, shots_against: 10, save_percentage: 0, goals_against_average: 2 },
        { player_id: uuidFor(5204), player_name: 'Measured Shutout', team_name: 'Native Team', wins: 1, games_played: 1, saves: 20, goals_against: 0, shots_against: 20, save_percentage: 100, goals_against_average: 0 },
      ],
      legacyChampions: () => [],
    };
    const history = await createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00Z'), canonical).loadHistory();

    expect(history.awards[0]).toMatchObject({ winnerName: null, playerId: null, teamId: null });
    expect(history.awards[1]).toMatchObject({ winnerName: 'A Player', playerId: playerA, teamId: teamA });
    const goalies = history.boards.find((board) => board.metric === 'wins')!.entries;
    expect(goalies[0]).toMatchObject({ playerId: importedProfile, savePercentage: null, goalsAgainstAverage: 4, provenance: 'canonical_all_time:sv_unmeasured:gaa_measured' });
    expect(goalies[1]).toMatchObject({ savePercentage: 90, goalsAgainstAverage: null, provenance: 'canonical_all_time:sv_measured:gaa_unmeasured' });
    expect(goalies[2]).toMatchObject({ savePercentage: 0, goalsAgainstAverage: 2 });
    expect(goalies[3]).toMatchObject({ savePercentage: 100, goalsAgainstAverage: 0 });
  });

  it('does not retain team metadata from an invalid explicit award season', async () => {
    const knownSeason = uuidFor(5301);
    const unknownSeason = uuidFor(5302);
    const teamId = uuidFor(5303);
    const globalPlayer = uuidFor(5304);
    const { client } = semanticDatabase({
      seasons: [{ id: knownSeason, league_id: LEAGUE.id, name: 'Known', start_date: '2025-01-01', end_date: '2025-04-01', status: 'completed' }],
      teams: [{ id: teamId, league_id: LEAGUE.id, name: 'Local Team', logo_url: null }],
      games: [], playoff_series: [], player_stats: [], goalie_stats: [],
      team_rosters: [{ league_id: LEAGUE.id, season_id: knownSeason, team_id: teamId, player_id: globalPlayer, status: 'active', profile: { id: globalPlayer, full_name: 'Global Player' } }],
      league_awards: [
        { id: uuidFor(5305), league_id: LEAGUE.id, season_id: unknownSeason, team_id: teamId, player_id: null, award_name: 'Malformed', player: null },
        { id: uuidFor(5306), league_id: LEAGUE.id, season_id: null, team_id: teamId, player_id: globalPlayer, award_name: 'Global valid', player: { full_name: 'Global Player' } },
      ],
    });
    const history = await createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00Z'), emptyCanonical).loadHistory();
    expect(history.awards[0]).toMatchObject({ seasonId: null, teamId: null, playerId: null, winnerName: null });
    expect(history.awards[1]).toMatchObject({ seasonId: null, teamId, playerId: globalPlayer, winnerName: 'Global Player' });
  });

  it('rejects a malformed published date before applying the valid future-release filter', async () => {
    const { client } = semanticDatabase({ articles: [syntheticArticle(5401, { published_at: 'not-a-date', created_at: 'also-not-a-date' })] });
    const source = createPublicLeagueContentSource(client, LEAGUE, new Date('2026-09-13T12:00:00Z'));
    await expect(source.loadNews()).rejects.toThrow('Invalid published article date');

    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await handlePublicLeagueContentRequest(
        new NextRequest('https://hockey-life.beerleaguehockey.ca/api/public/league-content?leagueSlug=hockey-life&view=news', { headers: { host: 'hockey-life.beerleaguehockey.ca' } }),
        { now: () => new Date('2026-09-13T12:00:00Z'), getLeagueBySlug: async () => ({ ...LEAGUE, status: 'active' }), hasPlatformSubscription: async () => true, createSource: () => source },
      );
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe('CONTENT_DATA_UNAVAILABLE');
    } finally {
      log.mockRestore();
    }
  });

  it('canonicalizes credential-free legacy media and fails closed for malformed required photos', async () => {
    const { client } = semanticDatabase({ seasons: [], teams: [], games: [], team_rosters: [], league_awards: [], player_stats: [], goalie_stats: [] });
    const history = await createPublicLeagueContentSource(client, { ...LEAGUE, slug: 'woha' }, new Date('2026-09-13T12:00:00Z'), {
      ...emptyCanonical,
      legacyChampions: () => [{ year: '1986-87', photo: '/leagues/woha/history/86_87.jpg' }],
    }).loadHistory();
    expect(history.champions[0].photoUrl).toBe('https://woha.beerleaguehockey.ca/leagues/woha/history/86_87.jpg');

    const albumId = uuidFor(6001);
    const malformed = semanticDatabase({
      league_gallery: [{ id: albumId, league_id: LEAGUE.id, title: 'Published', is_published: true, created_at: '2026-01-01T00:00:00Z' }],
      gallery_photos: [{ id: uuidFor(6002), gallery_id: albumId, url: 'javascript:bad', display_order: 0 }],
    });
    await expect(createPublicLeagueContentSource(malformed.client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadAlbum(albumId)).rejects.toThrow('Invalid published photo image URL');
  });

  it('accepts the exact photo cap, rejects overflow, and propagates a later photo page failure', async () => {
    const albumId = uuidFor(6100);
    const album = { id: albumId, league_id: LEAGUE.id, title: 'Bounded Album', is_published: true, created_at: '2026-01-01T00:00:00Z' };
    const photos = Array.from({ length: 5001 }, (_, index) => ({ id: uuidFor(20000 + index), gallery_id: albumId, url: `https://images.example/${index}.jpg`, display_order: index }));
    const exact = semanticDatabase({ league_gallery: [album], gallery_photos: photos.slice(0, 5000) });
    await expect(createPublicLeagueContentSource(exact.client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadAlbum(albumId)).resolves.toMatchObject({ album: { photoCount: 5000 } });

    const overflow = semanticDatabase({ league_gallery: [album], gallery_photos: photos });
    await expect(createPublicLeagueContentSource(overflow.client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadAlbum(albumId)).rejects.toThrow('gallery_photos exceeds its complete-source cap');

    const failed = semanticDatabase({ league_gallery: [album], gallery_photos: photos.slice(0, SOURCE_PAGE_SIZE + 1) }, { table: 'gallery_photos', offset: SOURCE_PAGE_SIZE });
    await expect(createPublicLeagueContentSource(failed.client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadAlbum(albumId)).rejects.toThrow('Public content read failed: gallery_photos');
  });

  it('rejects overlong published text, duplicate ids, negative jerseys, and negative canonical standings', async () => {
    const articleRows = [
      syntheticArticle(6201, { title: 'x'.repeat(501) }),
      syntheticArticle(6202, { id: uuidFor(6202) }),
      syntheticArticle(6203, { id: uuidFor(6202) }),
    ];
    await expect(createPublicLeagueContentSource(semanticDatabase({ articles: [articleRows[0]] }).client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadNews()).rejects.toThrow('Invalid published article title');
    await expect(createPublicLeagueContentSource(semanticDatabase({ articles: articleRows.slice(1) }).client, LEAGUE, new Date('2026-09-13T12:00:00Z')).loadNews()).rejects.toThrow('Invalid published duplicate article id');

    const seasonId = uuidFor(6301);
    const teamId = uuidFor(6302);
    const playerId = uuidFor(6303);
    const fixtures = { seasons: [{ id: seasonId, league_id: LEAGUE.id, name: 'Season', start_date: '2025-01-01', end_date: '2025-04-01', status: 'completed', champion_team_id: teamId }], teams: [{ id: teamId, league_id: LEAGUE.id, name: 'Team', logo_url: null }], games: [], team_rosters: [{ league_id: LEAGUE.id, season_id: seasonId, team_id: teamId, player_id: playerId, jersey_number: -1, position: 'C', leadership_role: null, status: 'active', profile: { id: playerId, full_name: 'Player' } }], league_awards: [], player_stats: [], goalie_stats: [] };
    await expect(createPublicLeagueContentSource(semanticDatabase(fixtures).client, LEAGUE, new Date('2026-09-13T12:00:00Z'), emptyCanonical).loadHistory()).rejects.toThrow('Invalid published champion jersey number');

    const canonical = { ...emptyCanonical, standings: async () => [{ team_id: teamId, team_name: 'Team', games_played: 1, wins: -1, losses: 0, ties: 0, points: 0 }] };
    await expect(createPublicLeagueContentSource(semanticDatabase({ ...fixtures, team_rosters: [] }).client, LEAGUE, new Date('2026-09-13T12:00:00Z'), canonical).loadHistory()).rejects.toThrow('Invalid published standing wins');
  });
});

describe('default canonical read boundary', () => {
  const baselineRow = (index: number, name = `Baseline ${index}`) => ({
    id: uuidFor(200000 + index), league_id: LEAGUE.id, player_id: uuidFor(210000 + index),
    full_name: name, is_goalie: false, games_played: 1, goals: 1, assists: 0, points: 1,
    wins: 0, ties: 0, saves: 0, goals_against: 0, shutouts: 0,
    save_percentage: 0, goals_against_average: 0,
  });

  it('batches and paginates canonical profile and badge hydration without dropping a later sentinel', async () => {
    const baselines = Array.from({ length: 205 }, (_, index) => baselineRow(index));
    const profiles = baselines.map((row, index) => ({ id: row.player_id, full_name: row.full_name, avatar_url: index === 204 ? 'https://images.example/sentinel.jpg' : null, photo_url: null }));
    const { client, logs } = semanticDatabase({
      league_player_career_baselines: [], player_career_baselines: baselines, profiles,
      player_stats: [], goalie_stats: [], team_rosters: [], teams: [], player_badges: [],
      leagues: [{ id: LEAGUE.id, logo_url: null }], seasons: [],
    }, { table: 'profiles', offset: -1, maxInValues: 100 });
    mockSupabaseClient = client;

    const rows = await getUnifiedSkaterStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug, undefined, { strict: true });

    expect(rows).toHaveLength(205);
    expect(rows.find((row) => row.player_id === baselines[204].player_id)?.avatar_url).toBe('https://images.example/sentinel.jpg');
    const idReads = logs.filter((log) => ['profiles', 'player_badges'].includes(log.table))
      .flatMap((log) => log.filters.filter(([kind, key]) => kind === 'in' && ['id', 'player_id'].includes(key)));
    expect(idReads.length).toBeGreaterThan(4);
    expect(idReads.every(([, , values]) => (values as unknown[]).length <= 100)).toBe(true);
  });

  it('propagates a strict failure from a later profile batch with structured provider cause details', async () => {
    const baselines = Array.from({ length: 205 }, (_, index) => baselineRow(index));
    const sentinel = baselines[204].player_id;
    const { client } = semanticDatabase({
      league_player_career_baselines: [], player_career_baselines: baselines,
      profiles: baselines.map((row) => ({ id: row.player_id, avatar_url: null, photo_url: null })),
      player_stats: [], goalie_stats: [], team_rosters: [], teams: [], player_badges: [],
    }, { table: 'profiles', offset: 0, inContains: sentinel, error: { code: 'REQUEST_TOO_LARGE', message: 'synthetic later batch failed' } });
    mockSupabaseClient = client;
    try {
      await getUnifiedSkaterStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug, undefined, { strict: true });
      throw new Error('expected strict canonical failure');
    } catch (error) {
      expect((error as Error).message).toContain('baseline profiles batch 3 page 0');
      expect(String((error as Error & { cause?: unknown }).cause)).toContain('REQUEST_TOO_LARGE: synthetic later batch failed');
    }
  });

  it('scopes imported name matching to a unique same-league historical identity', async () => {
    const localProfile = uuidFor(220001);
    const foreignProfile = uuidFor(220002);
    const { client } = semanticDatabase({
      league_player_career_baselines: [], player_career_baselines: [], player_stats: [], goalie_stats: [], player_badges: [],
      profiles: [
        { id: foreignProfile, full_name: 'Steve Almond', avatar_url: null, photo_url: null, position: 'C' },
        { id: localProfile, full_name: 'Steve Almond', avatar_url: null, photo_url: null, position: 'C' },
      ],
      team_rosters: [
        { league_id: 'foreign-league', season_id: uuidFor(220010), player_id: foreignProfile, team_id: uuidFor(220020), profile: { id: foreignProfile, full_name: 'Steve Almond' } },
        { league_id: LEAGUE.id, season_id: uuidFor(220011), player_id: localProfile, team_id: uuidFor(220021), profile: { id: localProfile, full_name: 'Steve Almond' } },
      ],
      teams: [], leagues: [{ id: LEAGUE.id, logo_url: null }], seasons: [],
    });
    mockSupabaseClient = client;
    const rows = await getUnifiedSkaterStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug, undefined, { strict: true });
    const steve = rows.find((row) => row.player_name === 'Steve Almond');
    expect(steve).toMatchObject({ player_id: localProfile, profile_id: localProfile, profile_id_league_verified: true });
    expect(rows.some((row) => row.player_id === foreignProfile)).toBe(false);
  });

  it('preserves an imported-only profile proven by the league-scoped career baseline FK', async () => {
    const localProfile = uuidFor(221001);
    const foreignProfile = uuidFor(221002);
    const baseline = { ...baselineRow(221003, 'Steve Almond'), player_id: localProfile };
    const { client } = semanticDatabase({
      league_player_career_baselines: [], player_career_baselines: [baseline], player_stats: [], goalie_stats: [], player_badges: [], team_rosters: [], teams: [], seasons: [],
      profiles: [
        { id: foreignProfile, full_name: 'Steve Almond', avatar_url: null, photo_url: null, position: 'C' },
        { id: localProfile, full_name: 'Steve Almond', avatar_url: null, photo_url: null, position: 'C' },
      ],
      leagues: [{ id: LEAGUE.id, logo_url: null }],
    });
    mockSupabaseClient = client;
    const rows = await getUnifiedSkaterStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug, undefined, { strict: true });
    const steve = rows.find((row) => row.player_name === 'Steve Almond');
    expect(steve).toMatchObject({ player_id: localProfile, profile_id: localProfile, profile_id_league_verified: true });
    expect(rows.some((row) => row.player_id === foreignProfile)).toBe(false);
  });

  it('preserves a legacy matched profile only when historical same-league roster evidence proves it', async () => {
    const provenProfile = uuidFor(222001);
    const unprovenProfile = uuidFor(222002);
    const { client } = semanticDatabase({
      league_player_career_baselines: [], player_career_baselines: [], career_stat_baselines: [], league_career_stat_baselines: [], imported_career_baselines: [], imported_career_stat_baselines: [],
      legacy_players: [
        { id: uuidFor(222010), matched_to_profile_id: provenProfile, full_name: 'Proven Legacy', is_goalie: false, games_played: 5, goals: 2, assists: 1 },
        { id: uuidFor(222011), matched_to_profile_id: unprovenProfile, full_name: 'Unproven Legacy', is_goalie: false, games_played: 5, goals: 1, assists: 1 },
      ],
      profiles: [
        { id: provenProfile, full_name: 'Proven Legacy', avatar_url: null, photo_url: null },
        { id: unprovenProfile, full_name: 'Unproven Legacy', avatar_url: null, photo_url: null },
      ],
      team_rosters: [{ league_id: LEAGUE.id, season_id: uuidFor(222020), player_id: provenProfile, team_id: uuidFor(222021), profile: { id: provenProfile, full_name: 'Proven Legacy' } }],
      player_stats: [], goalie_stats: [], player_badges: [], teams: [], seasons: [], leagues: [{ id: LEAGUE.id, logo_url: null }],
    });
    mockSupabaseClient = client;
    const rows = await getUnifiedSkaterStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug, undefined, { strict: true });
    expect(rows.find((row) => row.player_name === 'Proven Legacy')).toMatchObject({ profile_id: provenProfile, profile_id_league_verified: true });
    expect(rows.find((row) => row.player_name === 'Unproven Legacy')).toMatchObject({ profile_id: unprovenProfile, profile_id_league_verified: false });
  });

  it('accepts only exact optional capability failures and rejects vague or contradictory provider errors', async () => {
    const fallback = baselineRow(300001);
    const accepted = semanticDatabase({
      player_career_baselines: [fallback], profiles: [{ id: fallback.player_id, avatar_url: null, photo_url: null }],
      player_stats: [], goalie_stats: [], team_rosters: [], teams: [], player_badges: [], leagues: [{ id: LEAGUE.id, logo_url: null }], seasons: [],
    }, { table: 'league_player_career_baselines', offset: 0, error: { code: 'PGRST205', message: 'missing optional table' } });
    mockSupabaseClient = accepted.client;
    await expect(getUnifiedSkaterStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug, undefined, { strict: true })).resolves.toHaveLength(1);

    for (const error of [
      { code: 'NETWORK', message: 'upstream endpoint does not exist' },
      { code: '42501', message: "relation 'league_player_career_baselines' does not exist" },
    ]) {
      const rejected = semanticDatabase({ player_stats: [], goalie_stats: [], team_rosters: [], teams: [] }, { table: 'league_player_career_baselines', offset: 0, error });
      mockSupabaseClient = rejected.client;
      await expect(getUnifiedSkaterStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug, undefined, { strict: true }))
        .rejects.toThrow('Canonical read failed: league_player_career_baselines');
    }

    for (const rpcError of [
      { code: '42501', message: 'permission denied' },
      { code: 'NETWORK', message: 'provider unavailable' },
    ]) {
      const standingsDb = semanticDatabase({ teams: [], team_rosters: [], team_standings: [] }, undefined, rpcError);
      mockSupabaseClient = standingsDb.client;
      await expect(getStandings(LEAGUE.id, uuidFor(300010), { strict: true })).rejects.toThrow('Canonical read failed: get_team_standings');
    }
    const tableDenied = semanticDatabase(
      { teams: [], team_rosters: [], team_standings: [] },
      { table: 'team_standings', offset: 0, error: { code: '42501', message: 'permission denied' } },
      { code: 'PGRST202', message: "Could not find the function 'get_team_standings' in the schema cache" },
    );
    mockSupabaseClient = tableDenied.client;
    await expect(getStandings(LEAGUE.id, uuidFor(300011), { strict: true })).rejects.toThrow('Canonical read failed: team_standings');
  });

  it('propagates an actual goalie later-page failure in strict mode and remains fail-soft by default', async () => {
    const goalieRows = Array.from({ length: 1001 }, (_, index) => ({
      id: uuidFor(310000 + index), player_id: uuidFor(320000 + index), team_id: uuidFor(330000 + index),
      season_id: uuidFor(340000 + index), game_id: uuidFor(350000 + index), 'game.league_id': LEAGUE.id,
      'game.status': 'completed', saves: 1, shots_against: 1, goals_against: 0,
    }));
    const { client } = semanticDatabase({
      league_player_career_baselines: [], player_career_baselines: [], legacy_players: [], goalie_stats: goalieRows,
      player_stats: [], team_rosters: [], teams: [], seasons: [], games: [], playoff_series: [], league_awards: [],
    }, { table: 'goalie_stats', offset: 1000 });
    mockSupabaseClient = client;
    const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
    try {
      await expect(createDefaultPublicLeagueContentSource(LEAGUE, new Date('2026-09-13T12:00:00Z')).loadHistory())
        .rejects.toThrow('Canonical read failed: goalie_stats page 1000');
      await expect(getUnifiedGoalieStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug)).resolves.toEqual([]);
    } finally {
      if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
      if (priorKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
    }
  });

  it('lets the probe succeed but rejects a real canonical later-page failure while legacy callers remain fail-soft', async () => {
    const coreRows = Array.from({ length: 1001 }, (_, index) => ({
      id: uuidFor(7000 + index),
      player_id: uuidFor(9000 + index),
      team_id: uuidFor(11000 + index),
      season_id: uuidFor(13000 + index),
      game_id: uuidFor(15000 + index),
      'game.league_id': LEAGUE.id,
      'game.status': 'completed',
      goals: 0,
      assists: 0,
    }));
    const { client, logs } = semanticDatabase({
      seasons: [], teams: [], games: [], team_rosters: [], league_awards: [],
      player_stats: coreRows, goalie_stats: [], legacy_players: [],
    }, { table: 'player_stats', offset: 1000 });
    mockSupabaseClient = client;
    const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
    try {
      const source = createDefaultPublicLeagueContentSource(LEAGUE, new Date('2026-09-13T12:00:00Z'));
      await expect(source.loadHistory()).rejects.toThrow('Canonical read failed: player_stats page 1000');

      await expect(getUnifiedSkaterStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug)).resolves.toEqual([]);
      const playerStatsLogs = logs.filter((entry) => entry.table === 'player_stats');
      expect(playerStatsLogs).toEqual(expect.arrayContaining([
        expect.objectContaining({ projection: 'id, game:games!inner(league_id)', range: [0, 0] }),
        expect.objectContaining({ projection: expect.stringContaining('player_id'), range: [0, 999] }),
        expect.objectContaining({ projection: expect.stringContaining('player_id'), range: [1000, 1999] }),
      ]));
      expect(playerStatsLogs.some((entry) => entry.filters.some((filter) => filter[1] === 'game.league_id' && filter[2] === LEAGUE.id))).toBe(true);
    } finally {
      if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
      if (priorKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
    }
  });

  it('propagates a non-missing imported baseline failure only for strict public content reads', async () => {
    const { client } = semanticDatabase({
      seasons: [], teams: [], games: [], team_rosters: [], league_awards: [],
      player_stats: [], goalie_stats: [], legacy_players: [],
    }, { table: 'league_player_career_baselines', offset: 0 });
    mockSupabaseClient = client;
    const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
    try {
      await expect(createDefaultPublicLeagueContentSource(LEAGUE, new Date('2026-09-13T12:00:00Z')).loadHistory())
        .rejects.toThrow('Canonical read failed: league_player_career_baselines');
      await expect(getUnifiedSkaterStatsRows(LEAGUE.id, null, undefined, LEAGUE.slug)).resolves.toEqual([]);
    } finally {
      if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
      if (priorKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
    }
  });
});
