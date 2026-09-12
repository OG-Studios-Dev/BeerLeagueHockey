export type DockSeason = {
  id: string;
  league_id: string;
  status: string | null;
  start_date: string | null;
  created_at?: string | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
};

export type ParsedWebsiteNavItem = {
  label?: string;
  href?: string;
  isExternal?: boolean;
  isCustomPage?: boolean;
  pageSlug?: string;
};

export type ParsedWebsiteSettings = {
  visiblePages?: Record<string, boolean>;
  navItems: ParsedWebsiteNavItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function parseWebsiteSettings(settings: unknown): ParsedWebsiteSettings {
  if (!isRecord(settings) || !isRecord(settings.website)) {
    return { visiblePages: undefined, navItems: [] };
  }

  const visiblePages = isRecord(settings.website.visiblePages)
    ? Object.fromEntries(Object.entries(settings.website.visiblePages).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
    : undefined;
  const navItems = Array.isArray(settings.website.navItems)
    ? settings.website.navItems.flatMap((value): ParsedWebsiteNavItem[] => {
        if (!isRecord(value)) return [];
        if (value.label !== undefined && typeof value.label !== 'string') return [];
        if (value.href !== undefined && typeof value.href !== 'string') return [];
        if (value.pageSlug !== undefined && typeof value.pageSlug !== 'string') return [];
        if (value.isExternal !== undefined && typeof value.isExternal !== 'boolean') return [];
        if (value.isCustomPage !== undefined && typeof value.isCustomPage !== 'boolean') return [];
        const item: ParsedWebsiteNavItem = {};
        if (typeof value.label === 'string') item.label = value.label;
        if (typeof value.href === 'string') item.href = value.href;
        if (typeof value.pageSlug === 'string') item.pageSlug = value.pageSlug;
        if (typeof value.isExternal === 'boolean') item.isExternal = value.isExternal;
        if (typeof value.isCustomPage === 'boolean') item.isCustomPage = value.isCustomPage;
        return [item];
      })
    : [];

  return { visiblePages, navItems };
}

export function selectOperationalDockSeason(rows: DockSeason[], _leagueId: string): DockSeason | null {
  const statusRank: Record<string, number> = { active: 0, playoffs: 1 };
  return rows
    .filter((row) => row.league_id === _leagueId && row.status != null && row.status in statusRank)
    .slice()
    .sort((left, right) => {
      const rank = statusRank[left.status!] - statusRank[right.status!];
      if (rank !== 0) return rank;
      const start = (right.start_date ?? '').localeCompare(left.start_date ?? '');
      if (start !== 0) return start;
      const created = (right.created_at ?? '').localeCompare(left.created_at ?? '');
      return created !== 0 ? created : left.id.localeCompare(right.id);
    })[0] ?? null;
}

export function isDockRegistrationOpen(season: DockSeason, now = new Date()): boolean {
  const opensAt = season.registration_opens_at ? new Date(season.registration_opens_at) : null;
  const closesAt = season.registration_closes_at ? new Date(season.registration_closes_at) : null;
  const afterOpen = !opensAt || now >= opensAt;
  if (season.status === 'active') return afterOpen;
  if (opensAt || closesAt) return afterOpen && (!closesAt || now <= closesAt);
  return season.status === 'upcoming';
}

export function selectDockRegistrationSeason(rows: DockSeason[], now = new Date()): DockSeason | null {
  const statusRank: Record<string, number> = { upcoming: 0, active: 1, playoffs: 2 };
  return rows
    .filter((row) => isDockRegistrationOpen(row, now))
    .slice()
    .sort((left, right) => {
      const rank = (statusRank[left.status ?? ''] ?? 3) - (statusRank[right.status ?? ''] ?? 3);
      if (rank !== 0) return rank;
      return new Date(right.start_date ?? 0).getTime() - new Date(left.start_date ?? 0).getTime();
    })[0] ?? null;
}

export function createDockRequestGate() {
  let generation = 0;
  return {
    begin: (identityKey: string) => ({ identityKey, generation: ++generation }),
    isCurrent: (request: { identityKey: string; generation: number }, identityKey: string) =>
      request.generation === generation && request.identityKey === identityKey,
    invalidate: () => { generation += 1; },
  };
}
