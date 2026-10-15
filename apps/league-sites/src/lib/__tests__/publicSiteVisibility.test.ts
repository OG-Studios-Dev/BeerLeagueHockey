import {
  filterPublicStandings,
  filterPublicTeams,
  isPublicFacingTeamName,
  shouldShowDefaultPublicNavPage,
  shouldShowPublicSponsors,
} from '@/lib/publicSiteVisibility';

describe('public site visibility helpers', () => {
  it('filters Free Agents teams from public team lists and standings', () => {
    expect(
      filterPublicTeams([
        { name: 'Bruins' },
        { name: 'Free Agents' },
        { name: 'Unassigned Free Agents' },
      ]).map((team) => team.name),
    ).toEqual(['Bruins']);

    expect(
      filterPublicStandings([
        { team_name: 'Canadiens' },
        { team_name: 'Free Agent' },
      ]).map((team) => team.team_name),
    ).toEqual(['Canadiens']);
  });

  it('treats non-free-agent teams as public', () => {
    expect(isPublicFacingTeamName('Beer Barons')).toBe(true);
    expect(isPublicFacingTeamName('Free Agents')).toBe(false);
  });

  it('hides duplicate default nav pages and respects visiblePages overrides', () => {
    expect(shouldShowDefaultPublicNavPage('about')).toBe(false);
    expect(shouldShowDefaultPublicNavPage('standings', { standings: false })).toBe(false);
    expect(shouldShowDefaultPublicNavPage('teams', { teams: true })).toBe(true);
  });

  it('hides public sponsors only for Hockey Life', () => {
    expect(shouldShowPublicSponsors('hockey-life')).toBe(false);
    expect(shouldShowPublicSponsors('control-league')).toBe(true);
  });
});
