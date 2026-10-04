import type { HomeLeader } from './supabase/home';

export type HomeLeaderMetric = 'goals' | 'assists' | 'points';

export type RankedHomeLeader = HomeLeader & {
  metric: HomeLeaderMetric;
  metricValue: number;
  competitionRank: number;
  tied: boolean;
  rankLabel: string;
};

export const JACK_FOOTE_ART_IDENTITY = Object.freeze({
  artworkId: 'jack-foote-v1',
  leagueId: 'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  playerId: '5dfcbbd7-5fde-41a7-8557-bea05e71a692',
  avatarUrl: 'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/player-avatars/5dfcbbd7-5fde-41a7-8557-bea05e71a692-1785819917416-linked-profile.png',
});

export type LeaderArtwork =
  | { kind: 'generated'; identityKey: string; artworkId: 'jack-foote-v1'; fallbackUri: string; accessibilityLabel: string }
  | { kind: 'photo'; identityKey: string; uri: string; accessibilityLabel: string }
  | { kind: 'neutral'; identityKey: string; artworkId: 'neutral-helmet-v1'; accessibilityLabel: string };

function compareText(left: string, right: string) {
  return left.localeCompare(right, 'en', { sensitivity: 'base' }) || left.localeCompare(right, 'en');
}

/**
 * Produces a new top-three array. Competition ranks and tie labels are derived
 * from the complete eligible population before the visible limit is applied.
 */
export function rankHomeLeaders(leaders: readonly HomeLeader[], metric: HomeLeaderMetric): RankedHomeLeader[] {
  const eligible = leaders
    .filter((leader) => Number.isFinite(leader[metric]) && leader[metric] > 0)
    .map((leader) => ({ ...leader }))
    .sort((left, right) => right[metric] - left[metric]
      || compareText(left.player_name, right.player_name)
      || compareText(`${left.player_id}:${left.team_id ?? ''}`, `${right.player_id}:${right.team_id ?? ''}`));

  const populationByValue = new Map<number, number>();
  eligible.forEach((leader) => populationByValue.set(leader[metric], (populationByValue.get(leader[metric]) ?? 0) + 1));

  return eligible.slice(0, 3).map((leader) => {
    const metricValue = leader[metric];
    const firstEqualIndex = eligible.findIndex((candidate) => candidate[metric] === metricValue);
    const competitionRank = firstEqualIndex + 1;
    const tied = (populationByValue.get(metricValue) ?? 0) > 1;
    return {
      ...leader,
      metric,
      metricValue,
      competitionRank,
      tied,
      rankLabel: `${tied ? 'T' : ''}${competitionRank}`,
    };
  });
}

/**
 * Generated artwork is an identity-bound enhancement, never a player-name
 * guess. Add future generated portraits by extending this exact identity
 * registry and the component's static Metro asset map; ranking stays untouched.
 */
export function resolveLeaderArtwork(leagueId: string, leader: HomeLeader): LeaderArtwork {
  const identityBase = `${leagueId}:${leader.player_id}:${leader.avatar_url ?? 'no-photo'}`;
  if (leagueId === JACK_FOOTE_ART_IDENTITY.leagueId
    && leader.player_id === JACK_FOOTE_ART_IDENTITY.playerId
    && leader.avatar_url === JACK_FOOTE_ART_IDENTITY.avatarUrl) {
    return {
      kind: 'generated',
      identityKey: `${identityBase}:${JACK_FOOTE_ART_IDENTITY.artworkId}`,
      artworkId: JACK_FOOTE_ART_IDENTITY.artworkId,
      fallbackUri: leader.avatar_url,
      accessibilityLabel: `${leader.player_name} featured player artwork`,
    };
  }
  if (leader.avatar_url) {
    return {
      kind: 'photo',
      identityKey: `${identityBase}:photo`,
      uri: leader.avatar_url,
      accessibilityLabel: `${leader.player_name} player photo`,
    };
  }
  return {
    kind: 'neutral',
    identityKey: `${identityBase}:neutral-helmet-v1`,
    artworkId: 'neutral-helmet-v1',
    accessibilityLabel: `${leader.player_name}, no player photo available`,
  };
}
