import React from 'react';

import { HOCKEY_LIFE_PRIMARY } from '../config/hockeyLife';
import { resolveCutIceAccent } from '../components/cutIceTitleModel';
import { useMobileDockData, type MobileDockData } from './useMobileDockData';

type MobileShellData = MobileDockData & {
  retry: () => void;
  titleAccent: string;
};

const EMPTY: MobileShellData = {
  identityKey: 'guest:none',
  isLoading: false,
  hasError: false,
  websiteStatus: 'idle',
  seasonId: null,
  isPlayoffs: false,
  registrationOpen: false,
  visiblePages: undefined,
  customNavItems: [],
  team: null,
  retry: () => undefined,
  titleAccent: HOCKEY_LIFE_PRIMARY,
};

const MobileShellDataContext = React.createContext<MobileShellData>(EMPTY);

export function MobileShellDataProvider({
  leagueId,
  leaguePrimary,
  userId,
  children,
}: {
  leagueId: string | null;
  leaguePrimary: string | null | undefined;
  userId: string | null;
  children: React.ReactNode;
}) {
  const data = useMobileDockData(leagueId, userId);
  const value = React.useMemo(() => ({
    ...data,
    titleAccent: resolveCutIceAccent(data.team?.primary_color ?? leaguePrimary),
  }), [data, leaguePrimary]);
  return <MobileShellDataContext.Provider value={value}>{children}</MobileShellDataContext.Provider>;
}

export function useMobileShellData() {
  return React.useContext(MobileShellDataContext);
}
