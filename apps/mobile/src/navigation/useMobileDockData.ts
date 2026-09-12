import React from 'react';

import { getActiveSeasonTeamForUser, type TeamAssignment } from '../lib/supabase/team';
import { supabase } from '../lib/supabase/client';
import {
  createDockRequestGate,
  parseWebsiteSettings,
  selectDockRegistrationSeason,
  selectOperationalDockSeason,
  type DockSeason,
} from './dockData';
import type { WebsiteNavItem } from './dockMenu';

export type WebsiteMetadataStatus = 'idle' | 'loading' | 'ready' | 'error';

export type MobileDockData = {
  identityKey: string;
  isLoading: boolean;
  hasError: boolean;
  websiteStatus: WebsiteMetadataStatus;
  seasonId: string | null;
  isPlayoffs: boolean;
  registrationOpen: boolean;
  visiblePages?: Record<string, boolean>;
  customNavItems: WebsiteNavItem[];
  team: TeamAssignment | null;
};

function emptyDockData(identityKey: string, isLoading: boolean): MobileDockData {
  return {
    identityKey,
    isLoading,
    hasError: false,
    websiteStatus: isLoading ? 'loading' : 'idle',
    seasonId: null,
    isPlayoffs: false,
    registrationOpen: false,
    visiblePages: undefined,
    customNavItems: [],
    team: null,
  };
}

export async function loadMobileDockData(
  identityKey: string,
  leagueId: string,
  userId: string | null,
): Promise<MobileDockData> {
  const [leagueResult, seasonsResult] = await Promise.all([
    supabase.from('leagues').select('settings').eq('id', leagueId).maybeSingle(),
    supabase
      .from('seasons')
      .select('id, league_id, status, start_date, created_at, registration_opens_at, registration_closes_at')
      .eq('league_id', leagueId)
      .order('start_date', { ascending: false }),
  ]);
  const seasons = ((seasonsResult.data as DockSeason[] | null) ?? []).filter((row) => row.league_id === leagueId);
  const operationalSeason = selectOperationalDockSeason(seasons, leagueId);
  const registrationSeason = selectDockRegistrationSeason(seasons);
  const website = leagueResult.error
    ? { visiblePages: undefined, navItems: [] }
    : parseWebsiteSettings(leagueResult.data?.settings);
  let team: TeamAssignment | null = null;
  let assignmentFailed = false;

  if (userId && operationalSeason) {
    try {
      team = await getActiveSeasonTeamForUser(userId, leagueId, operationalSeason.id);
    } catch {
      assignmentFailed = true;
    }
  }

  return {
    identityKey,
    isLoading: false,
    hasError: Boolean(leagueResult.error || seasonsResult.error || assignmentFailed),
    websiteStatus: leagueResult.error ? 'error' : 'ready',
    seasonId: operationalSeason?.id ?? null,
    isPlayoffs: operationalSeason?.status === 'playoffs',
    registrationOpen: Boolean(registrationSeason),
    visiblePages: website.visiblePages,
    customNavItems: website.navItems ?? [],
    team,
  };
}

export function useMobileDockData(leagueId: string | null, userId: string | null) {
  const identityKey = `${userId ?? 'guest'}:${leagueId ?? 'none'}`;
  const gate = React.useMemo(() => createDockRequestGate(), []);
  const [retryGeneration, setRetryGeneration] = React.useState(0);
  const [state, setState] = React.useState<MobileDockData>(() => emptyDockData(identityKey, Boolean(leagueId)));

  React.useEffect(() => {
    gate.invalidate();
    setState(emptyDockData(identityKey, Boolean(leagueId)));
    if (!leagueId) return;

    const request = gate.begin(identityKey);
    void loadMobileDockData(identityKey, leagueId, userId)
      .then((next) => {
        if (gate.isCurrent(request, identityKey)) setState(next);
      })
      .catch(() => {
        if (gate.isCurrent(request, identityKey)) {
          setState({ ...emptyDockData(identityKey, false), hasError: true, websiteStatus: 'error' });
        }
      });

    return () => gate.invalidate();
  }, [gate, identityKey, leagueId, retryGeneration, userId]);

  const retry = React.useCallback(() => {
    if (leagueId) setRetryGeneration((current) => current + 1);
  }, [leagueId]);

  // Dependency changes clear the old crest synchronously, before effects run.
  const current = state.identityKey === identityKey ? state : emptyDockData(identityKey, Boolean(leagueId));
  return { ...current, retry };
}
