import type { TeamPageIdentity, TeamPageSnapshot } from '../../lib/supabase/teamPage';

export type TeamRosterBeerGuyScope = {
  key: string;
  leagueId: string;
  seasonId: string;
  teamId: string;
  gameId: string;
};

export type TeamRosterJerseyVariant =
  | 'bad-bunny'
  | 'first-general-london'
  | 'liuna'
  | 'fitzrays'
  | 'fallback';

const VARIANT_BY_ID: Record<string, Exclude<TeamRosterJerseyVariant, 'fallback'>> = {
  '093f611c-0cdc-4509-afde-9c661b5833c9': 'bad-bunny',
  '453d62d9-80b4-4f26-a2ee-861f0c063402': 'first-general-london',
  '346833e0-2780-492d-86db-94df0b0cb3e1': 'liuna',
  'e4be829d-952c-4531-8376-215907fab3b7': 'fitzrays',
};

const VARIANT_BY_IDENTITY: Record<string, Exclude<TeamRosterJerseyVariant, 'fallback'>> = {
  'bad-bunny': 'bad-bunny',
  'london-eco-metal': 'bad-bunny',
  'first-general-london': 'first-general-london',
  liuna: 'liuna',
  'fitzrays-premier': 'liuna',
  fitzrays: 'fitzrays',
  'fitzrays-flyers': 'fitzrays',
};

function normalizeTeamIdentity(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveTeamRosterBeerGuyScope(
  snapshot: Pick<TeamPageSnapshot, 'games' | 'league' | 'season' | 'team'>,
  now: Date = new Date(),
): TeamRosterBeerGuyScope | null {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || !Array.isArray(snapshot.games)) return null;
  const nextGame = snapshot.games
    .filter((game) => {
      const scheduledAt = new Date(game.scheduledAt).getTime();
      return game.status === 'scheduled'
        && Number.isFinite(scheduledAt)
        && scheduledAt > nowMs
        && (game.homeTeam.id === snapshot.team.id || game.awayTeam.id === snapshot.team.id);
    })
    .sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
      || left.id.localeCompare(right.id))[0];
  if (!nextGame) return null;
  return {
    key: `${snapshot.league.id}:${snapshot.season.id}:${snapshot.team.id}:${nextGame.id}`,
    leagueId: snapshot.league.id,
    seasonId: snapshot.season.id,
    teamId: snapshot.team.id,
    gameId: nextGame.id,
  };
}

export function resolveTeamRosterJerseyVariant(
  team: Pick<TeamPageIdentity, 'id' | 'name' | 'slug'>,
): TeamRosterJerseyVariant {
  const idMatch = VARIANT_BY_ID[team.id.trim().toLowerCase()];
  if (idMatch) return idMatch;
  return VARIANT_BY_IDENTITY[normalizeTeamIdentity(team.slug)]
    ?? VARIANT_BY_IDENTITY[normalizeTeamIdentity(team.name)]
    ?? 'fallback';
}
