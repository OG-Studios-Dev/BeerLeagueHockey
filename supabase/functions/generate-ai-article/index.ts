import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getGameRecapSystemPrompt, getGameRecapUserPrompt, getWeeklyWrapSystemPrompt, getWeeklyWrapUserPrompt } from './prompts.ts';
import { gatherGameRecapData, gatherWeeklyWrapData, checkAddonActive } from './data-gathering.ts';
import { handleGameRecap } from './game-recap.ts';
import { isGatewayVerifiedServiceRole } from './service-role-auth.ts';
import { generateGroundedOrAiGameRecap } from './grounded-recap.ts';

const ALLOWED_ORIGINS = ['https://beerleaguehockey.ca', 'https://www.beerleaguehockey.ca', 'http://localhost:3000'];
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://beerleaguehockey.ca',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MANUAL_NEWSPAPER_LEAGUE_SLUGS = new Set([
  'hockey-life',
  'hockeylifehl',
  'hockeylifehl-original',
]);

export function usesManualNewspaperWorkflow(slug: string | null | undefined): boolean {
  return MANUAL_NEWSPAPER_LEAGUE_SLUGS.has(String(slug || '').toLowerCase());
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<any> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI response');

  return {
    parsed: JSON.parse(content),
    usage: result.usage,
    model: result.model,
  };
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])];
}

async function insertArticleEntityTags(
  supabase: any,
  args: {
    articleId: string;
    linkedPlayerIds?: string[];
    starPlayerIds?: string[];
    linkedTeamIds?: string[];
    linkedGameIds?: string[];
    primaryGameId?: string | null;
  },
) {
  const linkedPlayerIds = uniqueIds([
    ...(args.linkedPlayerIds || []),
    ...(args.starPlayerIds || []),
  ]);
  const linkedTeamIds = uniqueIds(args.linkedTeamIds || []);
  const linkedGameIds = uniqueIds(args.linkedGameIds || []);
  const primaryGameId = args.primaryGameId && linkedGameIds.includes(args.primaryGameId)
    ? args.primaryGameId
    : null;

  if (linkedPlayerIds.length > 0) {
    const tags = linkedPlayerIds.map((playerId: string) => ({
      article_id: args.articleId,
      player_id: playerId,
      mention_type: (args.starPlayerIds || []).includes(playerId) ? 'star' : 'mentioned',
    }));
    await supabase.from('article_player_tags').insert(tags);
  }

  if (linkedTeamIds.length > 0) {
    const tags = linkedTeamIds.map((teamId: string) => ({
      article_id: args.articleId,
      team_id: teamId,
    }));
    await supabase.from('article_team_tags').insert(tags);
  }

  if (linkedGameIds.length > 0) {
    const tags = linkedGameIds.map((gameId: string) => ({
      article_id: args.articleId,
      game_id: gameId,
      is_primary: primaryGameId ? gameId === primaryGameId : false,
    }));
    await supabase.from('article_game_tags').insert(tags);
  }

  await supabase
    .from('articles')
    .update({
      game_id: primaryGameId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.articleId);
}

async function handleWeeklyWrapAll(supabase: any) {
  // Find all leagues with active ai_news addon
  const { data: addons } = await supabase
    .from('organization_addons')
    .select('organization_id')
    .eq('addon_type', 'ai_news')
    .in('status', ['active', 'trialing']);

  if (!addons || addons.length === 0) {
    return { success: true, message: 'No leagues with AI News addon', processed: 0 };
  }

  const orgIds = addons.map((a: any) => a.organization_id);

  // Get leagues for these orgs
  const { data: leagues } = await supabase
    .from('leagues')
    .select('id, organization_id, slug')
    .in('organization_id', orgIds)
    .eq('status', 'active');

  if (!leagues || leagues.length === 0) {
    return { success: true, message: 'No active leagues found', processed: 0 };
  }

  const weekEnd = new Date();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartDate = weekStart.toISOString().split('T')[0];

  const results = [];

  for (const league of leagues) {
    if (usesManualNewspaperWorkflow(league.slug)) {
      results.push({
        league_id: league.id,
        skipped: true,
        reason: 'manual Hockey Life Times workflow',
      });
      continue;
    }
    // Get divisions for this league
    const { data: divisions } = await supabase
      .from('divisions')
      .select('id, name')
      .eq('league_id', league.id);

    // If no divisions, treat the whole league as one "division" (null division_id)
    const divisionList = divisions && divisions.length > 0
      ? divisions
      : [{ id: null, name: null }];

    for (const division of divisionList) {
      try {
        // Check dedup
        const { data: existing } = await supabase
          .from('ai_generation_log')
          .select('id, status')
          .eq('league_id', league.id)
          .eq('article_type', 'weekly_wrap')
          .eq('week_start_date', weekStartDate);

        // Add division filter
        let dedupQuery = existing;
        if (division.id) {
          dedupQuery = existing?.filter((e: any) => e.division_id === division.id);
        }

        if (
          dedupQuery &&
          dedupQuery.length > 0 &&
          ['pending', 'generating', 'completed'].includes(dedupQuery[0].status)
        ) {
          results.push({ league_id: league.id, division_id: division.id, skipped: true });
          continue;
        }

        // Gather weekly data
        const weeklyData = await gatherWeeklyWrapData(
          supabase, league.id, division.id, weekStart, weekEnd
        );

        if (!weeklyData || weeklyData.games.length === 0) {
          results.push({ league_id: league.id, division_id: division.id, skipped: true, reason: 'no games' });
          continue;
        }

        // Create log entry
        const { error: logInsertError } = await supabase.from('ai_generation_log').insert({
          league_id: league.id,
          season_id: weeklyData.season_id,
          division_id: division.id,
          article_type: 'weekly_wrap',
          week_start_date: weekStartDate,
          status: 'generating',
        });

        // Concurrent run safety: unique index can reject duplicate log rows for same weekly scope.
        // In that case, skip generation to avoid duplicate weekly_wrap articles.
        if (logInsertError) {
          const isUniqueViolation = (logInsertError as any)?.code === '23505';
          if (isUniqueViolation) {
            results.push({ league_id: league.id, division_id: division.id, skipped: true, reason: 'already generating' });
            continue;
          }
          throw logInsertError;
        }

        const startTime = Date.now();

        // Generate article
        const systemPrompt = getWeeklyWrapSystemPrompt();
        const userPrompt = getWeeklyWrapUserPrompt(weeklyData);
        const { parsed, usage, model } = await callOpenAI(systemPrompt, userPrompt);

        const { title, excerpt, content, tagged_player_ids = [], star_player_ids = [] } = parsed;

        const linkedGameIds = uniqueIds(weeklyData.games.map((game: any) => game.id));
        const linkedTeamIds = uniqueIds(
          weeklyData.games.flatMap((game: any) => [game.homeTeamId, game.awayTeamId]),
        );

        // Insert article
        const { data: article } = await supabase
          .from('articles')
          .insert({
            league_id: league.id,
            season_id: weeklyData.season_id,
            division_id: division.id,
            game_id: null,
            title,
            excerpt,
            content,
            slug: generateSlug(title),
            type: 'weekly_wrap',
            published: true,
            published_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (article) {
          await insertArticleEntityTags(supabase, {
            articleId: article.id,
            linkedPlayerIds: tagged_player_ids,
            starPlayerIds: star_player_ids,
            linkedTeamIds,
            linkedGameIds,
            primaryGameId: null,
          });
        }

        // Update log
        await supabase
          .from('ai_generation_log')
          .update({
            status: 'completed',
            article_id: article?.id,
            tokens_used: usage?.total_tokens || null,
            model_used: model || 'gpt-4o-mini',
            generation_time_ms: Date.now() - startTime,
            completed_at: new Date().toISOString(),
          })
          .eq('league_id', league.id)
          .eq('division_id', division.id)
          .eq('week_start_date', weekStartDate)
          .eq('article_type', 'weekly_wrap');

        results.push({ league_id: league.id, division_id: division.id, article_id: article?.id, success: true });
      } catch (error) {
        console.error(`Weekly wrap failed for league ${league.id}, division ${division.id}:`, error);
        results.push({
          league_id: league.id,
          division_id: division.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  return { success: true, processed: results.length, results };
}

Deno.serve(async (req) => {
  // Handle CORS preflight with dynamic origin
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Origin': allowOrigin } });
  }

  // The Edge gateway verifies the JWT before execution. Require the signed
  // service-role claims for this project rather than comparing against the
  // runtime key, which can differ after Supabase API-key migration.
  const authHeader = req.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const expectedProjectRef = (() => {
    try {
      return new URL(supabaseUrl).hostname.split('.')[0];
    } catch {
      return '';
    }
  })();
  if (!expectedProjectRef || !isGatewayVerifiedServiceRole(authHeader, expectedProjectRef)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { action, game_id, force = false } = await req.json();

    let result;

    switch (action) {
      case 'game_recap':
        if (!game_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'game_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data: recapGame, error: recapGameError } = await supabase
          .from('games')
          .select('league_id, leagues!inner(slug)')
          .eq('id', game_id)
          .single();
        if (recapGameError || !recapGame) {
          return new Response(
            JSON.stringify({ success: false, error: 'Game not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        const recapLeague = Array.isArray(recapGame.leagues) ? recapGame.leagues[0] : recapGame.leagues;
        if (usesManualNewspaperWorkflow(recapLeague?.slug)) {
          result = {
            success: false,
            error: 'Hockey Life recaps are consolidated into the manual Hockey Life Times edition.',
          };
          break;
        }
        result = await handleGameRecap(supabase, game_id, force === true, {
          gatherGameRecapData,
          checkAddonActive,
          generateArticle: async (gameData) => generateGroundedOrAiGameRecap(
            gameData,
            () => callOpenAI(
              getGameRecapSystemPrompt(gameData.recapTone),
              getGameRecapUserPrompt(gameData),
            ),
          ),
        });
        break;

      case 'weekly_wrap_all':
        result = await handleWeeklyWrapAll(supabase);
        break;

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
    }

    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
