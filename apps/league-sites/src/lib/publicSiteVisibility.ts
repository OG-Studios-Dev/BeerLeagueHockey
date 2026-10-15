import type { TeamType } from './types';

const HIDDEN_DEFAULT_NAV_PAGE_KEYS = new Set(['venues', 'about', 'contact']);
const LEAGUES_WITHOUT_PUBLIC_SPONSORS = new Set(['hockey-life']);
const HIDDEN_PUBLIC_TEAM_NAMES = new Set([
  'free agent',
  'free agents',
  'unassigned free agent',
  'unassigned free agents',
]);

function normalizeLabel(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') || '';
}

export function shouldShowPublicSponsors(leagueSlug: string) {
  return !LEAGUES_WITHOUT_PUBLIC_SPONSORS.has(leagueSlug);
}

export function shouldShowDefaultPublicNavPage(
  pageKey: string,
  visiblePages?: Record<string, boolean>,
) {
  if (HIDDEN_DEFAULT_NAV_PAGE_KEYS.has(pageKey)) {
    return false;
  }

  return visiblePages ? visiblePages[pageKey] !== false : true;
}

export function isPublicFacingTeamName(teamName: string | null | undefined) {
  const normalized = normalizeLabel(teamName);
  if (!normalized) {
    return true;
  }

  return !HIDDEN_PUBLIC_TEAM_NAMES.has(normalized);
}


export function isPublicFacingTeam(team: { name?: string | null; team_type?: TeamType | null }) {
  if (team.team_type === 'free_agents' || team.team_type === 'placeholder') {
    return false;
  }

  return isPublicFacingTeamName(team.name);
}

export function filterPublicTeams<T extends { name: string | null | undefined; team_type?: TeamType | null }>(teams: T[]) {
  return teams.filter((team) => isPublicFacingTeam(team));
}

export function filterPublicStandings<T extends { team_name: string | null | undefined; team_type?: TeamType | null }>(standings: T[]) {
  return standings.filter((team) => {
    if (team.team_type === 'free_agents' || team.team_type === 'placeholder' || team.team_type === 'exhibition') {
      return false;
    }

    return isPublicFacingTeamName(team.team_name);
  });
}
