'use server';

import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { verifyLeagueOwnerAccess } from './permissions';
import {
  assessReadiness,
  addLocalDays,
  applyNarrativePatch,
  buildDeterministicEdition,
  confirmedNextWeekFixtures,
  editionToArticleFallback,
  isNewspaperEdition,
  periodUtcBounds,
  type EditionShape,
  type NewspaperGameInput,
  type NewspaperGoalInput,
  type NewspaperNarrativePatch,
  type NewspaperProfileInput,
  type NewspaperStandingInput,
} from '@/lib/hockey-life-times/domain';
import { assertFreshPublicationFacts, canonicalFactDigest } from '@/lib/hockey-life-times/fact-digest';
import {
  validateNewspaperEdition,
  type NewspaperEdition,
} from '../../../../../packages/hockey-life-times/src/index';
import {
  assertEditionMediaBinding,
  bindIllustrationsToEdition,
  decodeIllustrationResponse,
  hydrateDraftMedia,
  mediaStorageAdapter,
  promoteApprovedMedia,
  type EditionWithMedia,
} from '@/lib/hockey-life-times/media';

const HOCKEY_LIFE_SLUGS = new Set(['hockey-life', 'hockeylifehl', 'hockeylifehl-original']);

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export interface NewspaperSeasonOption {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
}

export interface NewspaperEditionRecord {
  id: string;
  league_id: string;
  season_id: string;
  period_start: string;
  period_end: string;
  issue_number: number;
  status: 'draft' | 'generating' | 'published';
  edition_json: EditionShape | null;
  article_id: string | null;
  generation_error: string | null;
  generation_method: string | null;
  lease_expires_at: string | null;
  generation_lease_active: boolean;
  version: number;
  updated_at: string;
}

export type { NewspaperIllustration } from '@/lib/hockey-life-times/media';

export interface NewspaperReadiness {
  ready: boolean;
  errors: string[];
  warnings: string[];
  games: Array<{
    id: string;
    scheduledAt: string;
    status: string;
    matchup: string;
    score: string | null;
  }>;
  existingEdition: NewspaperEditionRecord | null;
}

function publicError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('NEWSPAPER_ALREADY_PUBLISHED')) return 'This week already has a published edition and cannot be overwritten.';
  if (message.includes('NEWSPAPER_GENERATION_IN_PROGRESS')) return 'Generation is already in progress for this week.';
  if (message.includes('NEWSPAPER_PREVIEW_STALE')) return 'This preview is stale. Review the latest draft before publishing.';
  if (message.includes('NEWSPAPER_FACTS_CHANGED')) return 'Source facts changed after this draft was reviewed. Regenerate the draft and review every page again before publishing.';
  if (message.includes('SEASON_TENANT_MISMATCH')) return 'The selected season does not belong to this league.';
  if (message.includes('Covered week must')) return message;
  if (message.includes('INVALID_NEWSPAPER_PERIOD')) return 'The issue must cover one canonical Monday-through-Sunday week.';
  return fallback;
}

async function requireHockeyLifeAdmin(leagueId: string) {
  const access = await verifyLeagueOwnerAccess(leagueId);
  if (!access.authorized) throw new Error(access.error || 'Not authorized');
  const service = createServiceRoleClient();
  const { data: league, error } = await service
    .from('leagues')
    .select('id, name, slug, timezone')
    .eq('id', leagueId)
    .single();
  if (error || !league) throw new Error('League not found');
  if (!HOCKEY_LIFE_SLUGS.has(String(league.slug || '').toLowerCase())) {
    throw new Error('Hockey Life Times is available only for Hockey Life.');
  }
  if (league.timezone !== 'America/Toronto') {
    throw new Error('Hockey Life Times requires the league timezone America/Toronto.');
  }
  return { service, league };
}

function normalizeGame(row: any): NewspaperGameInput {
  const home = Array.isArray(row.home_team) ? row.home_team[0] : row.home_team;
  const away = Array.isArray(row.away_team) ? row.away_team[0] : row.away_team;
  if (!home?.id || !away?.id) throw new Error(`Game ${row.id} is missing team data.`);
  return {
    id: row.id,
    leagueId: row.league_id,
    seasonId: row.season_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    gameType: row.game_type,
    location: row.location,
    homeScore: row.home_score == null ? null : Number(row.home_score),
    awayScore: row.away_score == null ? null : Number(row.away_score),
    homeTeam: { id: home.id, name: home.name, logoUrl: home.logo_url },
    awayTeam: { id: away.id, name: away.name, logoUrl: away.logo_url },
  };
}

async function loadPeriodGames(
  service: ReturnType<typeof createServiceRoleClient>,
  leagueId: string,
  seasonId: string,
  periodStart: string,
  periodEnd: string,
) {
  const bounds = periodUtcBounds(periodStart, periodEnd);
  const { data, error } = await service
    .from('games')
    .select(`
      id, league_id, season_id, scheduled_at, status, game_type, location,
      home_score, away_score,
      home_team:teams!games_home_team_id_fkey(id, name, logo_url),
      away_team:teams!games_away_team_id_fkey(id, name, logo_url)
    `)
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .gte('scheduled_at', bounds.fromInclusive)
    .lt('scheduled_at', bounds.toExclusive)
    .order('scheduled_at', { ascending: true });
  if (error) throw new Error(`Failed to load selected games: ${error.message}`);
  return (data || []).map(normalizeGame);
}

async function loadExistingEdition(
  service: ReturnType<typeof createServiceRoleClient>,
  leagueId: string,
  seasonId: string,
  periodStart: string,
  periodEnd: string,
) {
  const { data, error } = await (service.from('newspaper_editions' as any) as any)
    .select('*')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle();
  if (error) throw new Error(`Failed to load edition: ${error.message}`);
  if (!data) return null;
  let edition = data.edition_json;
  if (data.status === 'draft' && isNewspaperEdition(edition)) {
    edition = await hydrateDraftMedia(edition as EditionShape & { media?: unknown }, mediaStorageAdapter(service));
  }
  return {
    ...data,
    edition_json: isNewspaperEdition(edition) ? edition : null,
    generation_lease_active: data.status === 'generating'
      && typeof data.lease_expires_at === 'string'
      && Date.parse(data.lease_expires_at) > Date.now(),
  } as NewspaperEditionRecord;
}

export async function getHockeyLifeTimesSetup(leagueId: string): Promise<ActionResult<{
  enabled: boolean;
  seasons: NewspaperSeasonOption[];
}>> {
  try {
    const { service } = await requireHockeyLifeAdmin(leagueId);
    const { data, error } = await service
      .from('seasons')
      .select('id, name, status, start_date, end_date')
      .eq('league_id', leagueId)
      .order('start_date', { ascending: false });
    if (error) throw error;
    return {
      success: true,
      data: {
        enabled: true,
        seasons: (data || []).map((season) => ({
          id: season.id,
          name: season.name,
          status: season.status || 'completed',
          startDate: season.start_date,
          endDate: season.end_date,
        })),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load newspaper setup.';
    if (message.includes('available only')) return { success: true, data: { enabled: false, seasons: [] } };
    return { success: false, error: message };
  }
}

export async function getHockeyLifeTimesReadiness(input: {
  leagueId: string;
  seasonId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<ActionResult<NewspaperReadiness>> {
  try {
    const { service } = await requireHockeyLifeAdmin(input.leagueId);
    const games = await loadPeriodGames(service, input.leagueId, input.seasonId, input.periodStart, input.periodEnd);
    const readiness = assessReadiness(games, input.leagueId, input.seasonId);
    const existingEdition = await loadExistingEdition(service, input.leagueId, input.seasonId, input.periodStart, input.periodEnd);
    if (existingEdition?.status === 'published') {
      readiness.errors.push('This period already has a published edition. Generation is locked to preserve it.');
      readiness.ready = false;
    }
    return {
      success: true,
      data: {
        ...readiness,
        games: games.map((game) => ({
          id: game.id,
          scheduledAt: game.scheduledAt,
          status: game.status,
          matchup: `${game.awayTeam.name} at ${game.homeTeam.name}`,
          score: game.homeScore == null || game.awayScore == null ? null : `${game.awayScore}-${game.homeScore}`,
        })),
        existingEdition,
      },
    };
  } catch (error) {
    return { success: false, error: publicError(error, 'Failed to check newspaper readiness.') };
  }
}

async function gatherEditionFacts(
  service: ReturnType<typeof createServiceRoleClient>,
  input: { leagueId: string; seasonId: string; periodStart: string; periodEnd: string },
  games: NewspaperGameInput[],
) {
  const gameIds = games.map((game) => game.id);
  const { data: goalRows, error: goalsError } = gameIds.length ? await service
    .from('game_events')
    .select('id, game_id, team_id, player_id, assist1_player_id, assist2_player_id')
    .in('game_id', gameIds)
    .eq('event_type', 'goal')
    .is('deleted_at', null) : { data: [], error: null };
  if (goalsError) throw new Error(`Failed to load goal attribution: ${goalsError.message}`);
  const goals: NewspaperGoalInput[] = (goalRows || []).map((goal: any) => ({
    id: goal.id, gameId: goal.game_id, teamId: goal.team_id,
    scorerId: goal.player_id, assist1Id: goal.assist1_player_id, assist2Id: goal.assist2_player_id,
  }));
  const { data: playerStatRows, error: playerStatsError } = gameIds.length ? await service
    .from('player_stats')
    .select('game_id, player_id, team_id, goals, assists')
    .in('game_id', gameIds) : { data: [], error: null };
  if (playerStatsError) throw new Error(`Failed to load official player statistics: ${playerStatsError.message}`);
  const playerStats = (playerStatRows || []).map((row: any) => ({
    gameId: row.game_id, playerId: row.player_id, teamId: row.team_id,
    goals: Number(row.goals) || 0, assists: Number(row.assists) || 0,
  }));
  if (playerStats.length) {
    const derived = new Map<string, { teamId: string; goals: number; assists: number }>();
    for (const goal of goals) {
      const add = (playerId: string, field: 'goals' | 'assists') => {
        const key = `${goal.gameId}:${playerId}`;
        const current = derived.get(key) || { teamId: goal.teamId, goals: 0, assists: 0 };
        if (current.teamId !== goal.teamId) throw new Error(`Player ${playerId} is attributed to multiple teams in game ${goal.gameId}.`);
        current[field] += 1;
        derived.set(key, current);
      };
      if (goal.scorerId) add(goal.scorerId, 'goals');
      for (const assistId of new Set([goal.assist1Id, goal.assist2Id].filter((id): id is string => Boolean(id)))) {
        if (assistId !== goal.scorerId) add(assistId, 'assists');
      }
    }
    const official = new Map(playerStats.map((row) => [`${row.gameId}:${row.playerId}`, row]));
    const scoringKeys = new Set([
      ...derived.keys(),
      ...playerStats.filter((row) => row.goals > 0 || row.assists > 0).map((row) => `${row.gameId}:${row.playerId}`),
    ]);
    for (const key of scoringKeys) {
      const event = derived.get(key);
      const stat = official.get(key);
      if (!event || !stat || event.teamId !== stat.teamId || event.goals !== stat.goals || event.assists !== stat.assists) {
        throw new Error(`Official player statistics diverge from goal events for ${key}; review the game before generating.`);
      }
    }
  }
  const playerIds = [...new Set(goals.flatMap((goal) => [goal.scorerId, goal.assist1Id, goal.assist2Id]).filter((id): id is string => Boolean(id)))];
  const { data: profileRows, error: profilesError } = playerIds.length ? await service
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', playerIds) : { data: [], error: null };
  if (profilesError) throw new Error(`Failed to load player identities: ${profilesError.message}`);
  const profileById = new Map((profileRows || []).map((profile: any) => [profile.id, profile]));
  const unresolvedPlayerId = playerIds.find((id) => {
    const profile: any = profileById.get(id);
    return !profile || typeof profile.full_name !== 'string' || !profile.full_name.trim();
  });
  if (unresolvedPlayerId) {
    throw new Error(`Player identity ${unresolvedPlayerId} is unresolved; review the scoresheet before generating.`);
  }
  const profiles: NewspaperProfileInput[] = playerIds.map((id) => {
    const profile: any = profileById.get(id);
    return { id, name: profile.full_name.trim(), photoUrl: profile.avatar_url };
  });

  const { data: teamRows, error: teamsError } = await service
    .from('teams')
    .select('id, name, logo_url')
    .eq('league_id', input.leagueId);
  if (teamsError) throw new Error(`Failed to load standings teams: ${teamsError.message}`);
  const teamMap = new Map((teamRows || []).map((team: any) => [team.id, team]));
  const { data: standingRows, error: standingsError } = await service.rpc('get_team_standings', {
    check_league_id: input.leagueId,
    check_season_id: input.seasonId,
  });
  if (standingsError) throw new Error(`Failed to load canonical season standings: ${standingsError.message}`);
  const standings: NewspaperStandingInput[] = (standingRows || [])
    .filter((standing: any) => Number(standing.games_played) > 0 && teamMap.has(standing.team_id))
    .map((standing: any) => {
      const team: any = teamMap.get(standing.team_id);
      return {
        teamId: standing.team_id, name: team.name, logoUrl: team.logo_url,
        gp: Number(standing.games_played) || 0, w: Number(standing.wins) || 0,
        l: Number(standing.losses) || 0, otl: Number(standing.overtime_losses) || 0,
        t: Number(standing.ties) || 0, pts: Number(standing.points) || 0,
        gf: Number(standing.goals_for) || 0, ga: Number(standing.goals_against) || 0,
      };
    })
    .sort((left, right) => right.pts - left.pts || right.w - left.w || (right.gf - right.ga) - (left.gf - left.ga));

  const afterPeriod = periodUtcBounds(input.periodStart, input.periodEnd).toExclusive;
  const afterNextWeek = periodUtcBounds(addLocalDays(input.periodStart, 7), addLocalDays(input.periodEnd, 7)).toExclusive;
  const { data: upcomingRows, error: upcomingError } = await service
    .from('games')
    .select(`
      id, league_id, season_id, scheduled_at, status, game_type, location,
      home_score, away_score,
      home_team:teams!games_home_team_id_fkey(id, name, logo_url),
      away_team:teams!games_away_team_id_fkey(id, name, logo_url)
    `)
    .eq('league_id', input.leagueId)
    .eq('season_id', input.seasonId)
    .gte('scheduled_at', afterPeriod)
    .lt('scheduled_at', afterNextWeek)
    .eq('status', 'scheduled')
    .order('scheduled_at', { ascending: true })
    .limit(8);
  if (upcomingError) throw new Error(`Failed to load upcoming fixtures: ${upcomingError.message}`);

  return {
    goals,
    profiles,
    playerStats,
    standings,
    upcoming: confirmedNextWeekFixtures(input.periodStart, input.periodEnd, (upcomingRows || []).map(normalizeGame)),
  };
}

export async function generateHockeyLifeTimesDraft(input: {
  leagueId: string;
  seasonId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<ActionResult<NewspaperEditionRecord>> {
  let claimed: any = null;
  try {
    const { service, league } = await requireHockeyLifeAdmin(input.leagueId);
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    const { data: season, error: seasonError } = await service
      .from('seasons')
      .select('id, league_id, name, status')
      .eq('id', input.seasonId)
      .eq('league_id', input.leagueId)
      .single();
    if (seasonError || !season) return { success: false, error: 'Selected season was not found in this league.' };
    const games = await loadPeriodGames(service, input.leagueId, input.seasonId, input.periodStart, input.periodEnd);
    const readiness = assessReadiness(games, input.leagueId, input.seasonId);
    if (!readiness.ready) return { success: false, error: readiness.errors.join(' ') };

    const begin = await (service.rpc as any)('begin_newspaper_generation', {
      p_league_id: input.leagueId,
      p_season_id: input.seasonId,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_created_by: user.id,
      p_lease_seconds: 120,
    });
    if (begin.error) throw begin.error;
    claimed = begin.data;

    const facts = await gatherEditionFacts(service, input, games);
    const verifiedAt = new Date().toISOString();
    const digest = canonicalFactDigest({ games, ...facts });
    const edition = buildDeterministicEdition({
      issueNumber: claimed.issue_number,
      leagueId: input.leagueId,
      leagueName: league.name,
      seasonId: input.seasonId,
      seasonName: season.name,
      seasonStatus: season.status || 'completed',
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      issuedAt: verifiedAt,
      games,
      goals: facts.goals,
      profiles: facts.profiles,
      standings: facts.standings,
      upcoming: facts.upcoming,
      factPackDigest: digest,
    });
    if (!isNewspaperEdition(edition)) throw new Error('Generated edition failed schema validation.');
    validateNewspaperEdition(edition);

    const playerIds = [...new Set(edition.stars.map((star) => star.playerId))];
    if (playerIds.length < 1 || playerIds.length > 4) {
      throw new Error('Newspaper illustration selection must contain one to four distinct players.');
    }
    const illustrationInvoke = await service.functions.invoke('generate-newspaper-illustrations', {
      body: {
        editionId: claimed.id,
        generationToken: claimed.generation_token,
        playerIds,
      },
    });
    if (illustrationInvoke.error) throw illustrationInvoke.error;
    const illustrationByPlayer = decodeIllustrationResponse(illustrationInvoke.data, playerIds);
    const illustratedEdition = bindIllustrationsToEdition(edition, illustrationByPlayer);
    validateNewspaperEdition(illustratedEdition);
    assertEditionMediaBinding(illustratedEdition);

    const complete = await (service.rpc as any)('complete_newspaper_generation', {
      p_edition_id: claimed.id,
      p_generation_token: claimed.generation_token,
      p_edition_json: illustratedEdition as NewspaperEdition,
      p_generation_method: 'deterministic-verified-facts-with-gpt-image-2-v1',
    });
    if (complete.error) throw complete.error;
    revalidatePath(`/dashboard/leagues/${input.leagueId}/news`);
    return {
      success: true,
      data: {
        ...complete.data,
        edition_json: await hydrateDraftMedia(illustratedEdition, mediaStorageAdapter(service)),
        generation_lease_active: false,
      } as NewspaperEditionRecord,
    };
  } catch (error) {
    if (claimed?.id && claimed?.generation_token) {
      try {
        const service = createServiceRoleClient();
        await (service.rpc as any)('fail_newspaper_generation', {
          p_edition_id: claimed.id,
          p_generation_token: claimed.generation_token,
          p_error: error instanceof Error ? error.message : 'Generation failed',
        });
      } catch {
        // The original failure is more useful. A stale token cannot alter an edition.
      }
    }
    return { success: false, error: publicError(error, 'Newspaper generation failed. The previous draft, if any, was preserved.') };
  }
}

export async function publishHockeyLifeTimesEdition(input: {
  leagueId: string;
  editionId: string;
  expectedVersion: number;
}): Promise<ActionResult<{ articleId: string }>> {
  try {
    const { service, league } = await requireHockeyLifeAdmin(input.leagueId);
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    const { data: row, error } = await (service.from('newspaper_editions' as any) as any)
      .select('*')
      .eq('id', input.editionId)
      .eq('league_id', input.leagueId)
      .single();
    if (error || !row) return { success: false, error: 'Edition not found in this league.' };
    if (!isNewspaperEdition(row.edition_json)) return { success: false, error: 'Edition data is invalid and cannot be published.' };
    if (row.status !== 'draft') return { success: false, error: row.status === 'published' ? 'This edition is already published.' : 'Edition generation is still in progress.' };
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion !== row.version) {
      return { success: false, error: 'This preview is stale. Review the latest draft before publishing.' };
    }
    const edition = row.edition_json as EditionWithMedia;
    try {
      validateNewspaperEdition(edition);
    } catch {
      return { success: false, error: 'Edition data is invalid and cannot be published.' };
    }
    if (
      edition.leagueId !== input.leagueId || edition.leagueId !== row.league_id
      || edition.seasonId !== row.season_id || edition.periodStart !== row.period_start
      || edition.periodEnd !== row.period_end || String(edition.issueNumber) !== String(row.issue_number)
      || edition.status !== 'draft' || row.article_id !== null
    ) {
      return { success: false, error: 'Edition tenant validation failed.' };
    }
    const manifest = assertEditionMediaBinding(edition);
    const title = `Hockey Life Times — ${edition.periodStart} to ${edition.periodEnd}`;
    const slug = `hockey-life-times-${edition.periodStart}-${edition.seasonId.slice(0, 8)}`;
    await promoteApprovedMedia(manifest, mediaStorageAdapter(service));
    const currentGames = await loadPeriodGames(
      service,
      row.league_id,
      row.season_id,
      row.period_start,
      row.period_end,
    );
    const currentFacts = await gatherEditionFacts(service, {
      leagueId: row.league_id,
      seasonId: row.season_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
    }, currentGames);
    const finalGames = await loadPeriodGames(
      service,
      row.league_id,
      row.season_id,
      row.period_start,
      row.period_end,
    );
    assertFreshPublicationFacts(edition.source, { games: finalGames, ...currentFacts }, row.league_id, row.season_id);
    const published = await (service.rpc as any)('publish_newspaper_edition', {
      p_edition_id: input.editionId,
      p_expected_version: input.expectedVersion,
      p_published_by: user.id,
      p_title: title,
      p_slug: slug,
      p_content: editionToArticleFallback(edition),
      p_excerpt: edition.lead.dek,
      p_image_url: edition.lead.imageUrl || null,
    });
    if (published.error) throw published.error;
    revalidatePath(`/dashboard/leagues/${input.leagueId}/news`);
    revalidatePath(`/${league.slug}/news`);
    revalidatePath(`/${league.slug}/news/${slug}`);
    return { success: true, data: { articleId: published.data.article_id } };
  } catch (error) {
    return { success: false, error: publicError(error, 'Failed to publish newspaper edition.') };
  }
}

export async function saveHockeyLifeTimesNarrativeDraft(input: {
  leagueId: string;
  editionId: string;
  expectedVersion: number;
  narrative: NewspaperNarrativePatch;
}): Promise<ActionResult<NewspaperEditionRecord>> {
  try {
    const { service } = await requireHockeyLifeAdmin(input.leagueId);
    const { data: row, error } = await (service.from('newspaper_editions' as any) as any)
      .select('*')
      .eq('id', input.editionId)
      .eq('league_id', input.leagueId)
      .single();
    if (error || !row) return { success: false, error: 'Edition not found in this league.' };
    if (row.status !== 'draft' || row.article_id) return { success: false, error: 'Only an unpublished draft can be edited.' };
    if (row.version !== input.expectedVersion) return { success: false, error: 'This preview is stale. Reload the latest draft before saving.' };
    if (!isNewspaperEdition(row.edition_json)) return { success: false, error: 'Edition data is invalid and cannot be edited.' };
    const current = row.edition_json as EditionWithMedia;
    if (current.leagueId !== input.leagueId || current.seasonId !== row.season_id) {
      return { success: false, error: 'Edition tenant validation failed.' };
    }

    // Only lead/game prose is copied from the request. Scores, contributors,
    // stars, number rows, standings, source IDs/warnings/digest, and artwork
    // remain byte-for-byte sourced from the stored draft.
    const edited = applyNarrativePatch(current, input.narrative);
    validateNewspaperEdition(edited);
    assertEditionMediaBinding(edited as EditionWithMedia);
    const saved = await (service.rpc as any)('save_newspaper_narrative_draft', {
      p_edition_id: input.editionId,
      p_expected_version: input.expectedVersion,
      p_edition_json: edited as NewspaperEdition,
    });
    if (saved.error) throw saved.error;
    revalidatePath(`/dashboard/leagues/${input.leagueId}/news`);
    return {
      success: true,
      data: {
        ...saved.data,
        edition_json: await hydrateDraftMedia(edited as EditionWithMedia, mediaStorageAdapter(service)),
      } as NewspaperEditionRecord,
    };
  } catch (error) {
    return { success: false, error: publicError(error, 'Failed to save newspaper narrative edits.') };
  }
}
