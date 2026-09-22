import { supabase } from './supabase/client';

export type LeagueMatch = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  short_name: string | null;
  is_public: boolean;
  // computed
  distanceKm: number | null;
  fitScore: FitScore | null;
  fitLabel: string;
  fitColor: string;
  leagueRatingRange: string | null;
  leagueMedianRating: string | null;
};

export type MarketplaceResult = {
  leagues: LeagueMatch[];
  userRating: string | null;
  userTier: number | null;
};

export type FitScore = 'perfect' | 'competitive' | 'elite' | 'challenge' | 'beginner';

const RATING_TIERS: Record<string, number> = {
  'A+': 12, 'A': 11, 'A-': 10,
  'B+': 9,  'B': 8,  'B-': 7,
  'C+': 6,  'C': 5,  'C-': 4,
  'D+': 3,  'D': 2,  'D-': 1,
};

function tierToRating(tier: number): string {
  return Object.entries(RATING_TIERS).find(([, v]) => v === tier)?.[0] ?? 'C';
}

function scoreFitByRating(
  userTier: number,
  leagueMedianTier: number,
): { score: FitScore; label: string; color: string } {
  const diff = userTier - leagueMedianTier;
  if (diff >= 5) return { score: 'elite', label: 'Elite Level', color: '#F59E0B' };
  if (diff >= 2) return { score: 'competitive', label: 'Competitive Fit', color: '#22D3EE' };
  if (diff >= -1) return { score: 'perfect', label: 'Perfect Fit', color: '#22C55E' };
  if (diff >= -3) return { score: 'challenge', label: 'Challenge Level', color: '#F97316' };
  return { score: 'beginner', label: 'Tough League', color: '#EF4444' };
}

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  toronto: { lat: 43.6532, lng: -79.3832 },
  london: { lat: 42.9849, lng: -81.2453 },
  barrie: { lat: 44.3894, lng: -79.6903 },
  halifax: { lat: 44.6488, lng: -63.5752 },
  ottawa: { lat: 45.4215, lng: -75.6972 },
  hamilton: { lat: 43.2557, lng: -79.8711 },
  kitchener: { lat: 43.4516, lng: -80.4925 },
  windsor: { lat: 42.3149, lng: -83.0364 },
  woodbridge: { lat: 43.7866, lng: -79.5945 },
  mississauga: { lat: 43.589, lng: -79.6441 },
  brampton: { lat: 43.7315, lng: -79.7624 },
  vaughan: { lat: 43.8361, lng: -79.498 },
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCityCoords(city: string | null): { lat: number; lng: number } | null {
  if (!city) return null;
  const key = city.toLowerCase().trim();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  const partialKey = Object.keys(CITY_COORDS).find((k) => key.includes(k) || k.includes(key));
  return partialKey ? CITY_COORDS[partialKey] : null;
}

const SKILL_TIER_MAP: Record<string, number> = {
  beginner: 3,
  intermediate: 6,
  advanced: 9,
  expert: 11,
};

export async function getLeagueMarketplace(userId: string | null): Promise<MarketplaceResult> {
  // Location ranking is disabled in the single-league mobile candidate.
  const userLat: number | null = null;
  const userLng: number | null = null;

  // 2. Get all public leagues
  const { data: leagues } = await supabase
    .from('leagues')
    .select('id, name, slug, city, logo_url, primary_color, secondary_color, short_name, is_public')
    .eq('is_public', true)
    .limit(50);

  if (!leagues) return { leagues: [], userRating: null, userTier: null };

  // 3. Get user's rating tier
  let userTier: number | null = null;
  let userRating: string | null = null;

  if (userId) {
    const { data: ratingRow } = await supabase
      .from('player_ratings')
      .select('rating')
      .eq('player_id', userId)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ratingRow?.rating && RATING_TIERS[ratingRow.rating as string] != null) {
      userRating = ratingRow.rating as string;
      userTier = RATING_TIERS[ratingRow.rating as string];
    } else {
      // Fallback: use self_assessed_skill from profiles
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('self_assessed_skill')
        .eq('id', userId)
        .maybeSingle();

      if (profileRow?.self_assessed_skill) {
        const t = SKILL_TIER_MAP[profileRow.self_assessed_skill as string];
        if (t != null) {
          userTier = t;
          userRating = tierToRating(t);
        }
      }
    }
  }

  // 4. Get league rating distributions in one query
  const leagueIds = leagues.map((l) => l.id);
  const { data: leagueRatings } = await supabase
    .from('player_ratings')
    .select('league_id, rating')
    .in('league_id', leagueIds);

  // Group tiers by league_id, compute median + range
  const leagueMedianMap = new Map<string, number>();
  const leagueRangeMap = new Map<string, string>();

  if (leagueRatings) {
    const byLeague = new Map<string, number[]>();
    for (const row of leagueRatings) {
      if (!row.league_id || !row.rating) continue;
      const tier = RATING_TIERS[row.rating as string];
      if (tier == null) continue;
      if (!byLeague.has(row.league_id)) byLeague.set(row.league_id, []);
      byLeague.get(row.league_id)!.push(tier);
    }

    for (const [lid, tiers] of byLeague.entries()) {
      tiers.sort((a, b) => a - b);
      const mid = Math.floor(tiers.length / 2);
      const median =
        tiers.length % 2 === 0 ? Math.round((tiers[mid - 1] + tiers[mid]) / 2) : tiers[mid];
      leagueMedianMap.set(lid, median);

      const minRating = tierToRating(tiers[0]);
      const maxRating = tierToRating(tiers[tiers.length - 1]);
      leagueRangeMap.set(lid, minRating === maxRating ? minRating : `${minRating} to ${maxRating}`);
    }
  }

  // 5. Build matches
  const matches: LeagueMatch[] = leagues.map((league) => {
    const cityCoords = getCityCoords(league.city);
    const distanceKm =
      userLat && userLng && cityCoords
        ? Math.round(haversineKm(userLat, userLng, cityCoords.lat, cityCoords.lng))
        : null;

    const leagueMedianTier = leagueMedianMap.get(league.id) ?? null;
    const leagueRatingRange = leagueRangeMap.get(league.id) ?? null;
    const leagueMedianRating = leagueMedianTier != null ? tierToRating(leagueMedianTier) : null;

    let fitScore: FitScore | null = null;
    let fitLabel = 'New League';
    let fitColor = '#9CA3AF';

    if (userTier !== null && leagueMedianTier !== null) {
      const result = scoreFitByRating(userTier, leagueMedianTier);
      fitScore = result.score;
      fitLabel = result.label;
      fitColor = result.color;
    }

    return {
      ...league,
      distanceKm,
      fitScore,
      fitLabel,
      fitColor,
      leagueRatingRange,
      leagueMedianRating,
    };
  });

  // 6. Sort: distance (nulls last), then fit order
  const fitOrder: Record<string, number> = {
    perfect: 0,
    competitive: 1,
    elite: 2,
    challenge: 3,
    beginner: 4,
  };
  matches.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    if (a.distanceKm !== null) return -1;
    if (b.distanceKm !== null) return 1;
    return (fitOrder[a.fitScore ?? ''] ?? 5) - (fitOrder[b.fitScore ?? ''] ?? 5);
  });

  return { leagues: matches, userRating, userTier };
}
