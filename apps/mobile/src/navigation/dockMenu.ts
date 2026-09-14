export const PUBLIC_MORE_ITEMS = [
  ['teams', 'Teams', '/teams'],
  ['players', 'Players', '/players'],
  ['playoffs', 'Playoffs', '/playoffs'],
  ['news', 'News', '/news'],
  ['history', 'History', '/history'],
  ['gallery', 'Gallery', '/gallery'],
  ['events', 'Events', '/events'],
  ['contact', 'Contact', '/contact'],
] as const;

export type WebsiteNavItem = {
  label?: string;
  href?: string;
  isExternal?: boolean;
  isCustomPage?: boolean;
  pageSlug?: string;
};

export type MoreMenuInput = {
  leagueId?: string;
  leagueSlug: string;
  visiblePages?: Record<string, boolean>;
  customNavItems?: WebsiteNavItem[];
  isPlayoffs: boolean;
  registrationOpen: boolean;
  userId?: string | null;
  isMember: boolean;
  isCaptain: boolean;
};

export type DockDestination =
  | { kind: 'native'; tab: string; screen?: string; params?: Record<string, unknown> }
  | { kind: 'external'; url: string };

export type MoreMenuItem = {
  key: string;
  label: string;
  category: 'League' | 'App' | 'Account' | 'Captain' | 'Custom';
  icon: string;
  destination: DockDestination;
};

const PUBLIC_ICONS: Record<(typeof PUBLIC_MORE_ITEMS)[number][0], string> = {
  teams: 'people-outline',
  players: 'people-circle-outline',
  playoffs: 'trophy-outline',
  news: 'newspaper-outline',
  history: 'ribbon-outline',
  gallery: 'images-outline',
  events: 'calendar-outline',
  contact: 'mail-outline',
};

function tenantOrigin(slug: string) {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return `https://${slug}.beerleaguehockey.ca`;
  }
  return 'https://beerleaguehockey.ca';
}

function tenantPage(slug: string, path: string) {
  return `${tenantOrigin(slug)}${path.startsWith('/') ? path : `/${path}`}`;
}

function safeExternalUrl(value?: unknown): string | null {
  if (typeof value !== 'string' || !value || value.startsWith('//')) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeInternalPath(item: WebsiteNavItem): string | null {
  if (item.isCustomPage === true) {
    const slug = typeof item.pageSlug === 'string' ? item.pageSlug.trim() : '';
    return slug && /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(slug) ? `/p/${slug}` : null;
  }
  const href = typeof item.href === 'string' ? item.href.trim() : '';
  if (!href || href.startsWith('//') || href.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const path = href.startsWith('/') ? href : `/${href}`;
  return path.split('/').some((segment) => segment === '..') ? null : path;
}

function canonicalTenantPage(item: WebsiteNavItem, leagueSlug: string): 'events' | 'contact' | 'remove' | null {
  if (item.isCustomPage === true) return null;
  const href = typeof item.href === 'string' ? item.href.trim() : '';
  if (!href) return null;
  let pathname: string;
  if (item.isExternal === true) {
    const safe = safeExternalUrl(href);
    if (!safe) return null;
    const parsed = new URL(safe);
    const tenant = new URL(tenantOrigin(leagueSlug));
    if (parsed.hostname !== tenant.hostname || parsed.port) return null;
    pathname = parsed.pathname;
  } else {
    const safe = safeInternalPath(item);
    if (!safe) return null;
    pathname = new URL(safe, tenantOrigin(leagueSlug)).pathname;
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === leagueSlug) segments.shift();
  if (segments.length !== 1) return null;
  if (segments[0] === 'events' || segments[0] === 'contact') return segments[0];
  if (segments[0] === 'venues' || segments[0] === 'about') return 'remove';
  return null;
}

export function buildMoreMenu(input: MoreMenuInput): MoreMenuItem[] {
  const hasTenant = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.leagueSlug);
  const leagueItems: MoreMenuItem[] = hasTenant ? PUBLIC_MORE_ITEMS.flatMap(([pageKey, label, path]) => {
    if (input.visiblePages?.[pageKey] === false) return [];
    if (pageKey === 'playoffs' && !input.isPlayoffs) return [];
    const nativeScreen = pageKey === 'teams' ? 'TeamsDirectory'
      : pageKey === 'players' ? 'PlayersDirectory'
      : pageKey === 'playoffs' ? 'PlayoffsDirectory'
      : pageKey === 'news' ? 'NewsFeed'
      : pageKey === 'history' ? 'LeagueHistory'
      : pageKey === 'gallery' ? 'GalleryAlbums'
      : pageKey === 'events' ? 'Events'
      : pageKey === 'contact' ? 'Contact' : null;
    return [{
      key: `league-${pageKey}`,
      label,
      category: 'League',
      icon: PUBLIC_ICONS[pageKey],
      destination: nativeScreen && input.leagueId
        ? {
            kind: 'native', tab: 'LeaguePages', screen: nativeScreen,
            params: { leagueId: input.leagueId, leagueSlug: input.leagueSlug },
          }
        : { kind: 'external', url: tenantPage(input.leagueSlug, path) },
    }];
  }) : [];

  if (hasTenant && input.registrationOpen && input.visiblePages?.register !== false) {
    leagueItems.push({
      key: 'league-register', label: 'Register', category: 'League', icon: 'person-add-outline',
      destination: { kind: 'external', url: tenantPage(input.leagueSlug, '/goalies/register') },
    });
  }

  const appItems: MoreMenuItem[] = [
    { key: 'app-home', label: 'Home', category: 'App', icon: 'home-outline', destination: { kind: 'native', tab: 'Home' } },
    { key: 'app-discover', label: 'Discover Leagues', category: 'App', icon: 'compass-outline', destination: { kind: 'native', tab: 'Discover', screen: 'DiscoverMain' } },
  ];
  const accountItems: MoreMenuItem[] = [
    { key: 'account-profile', label: 'Account', category: 'Account', icon: 'person-outline', destination: { kind: 'native', tab: 'Profile', screen: 'ProfileMain' } },
  ];
  if (input.isMember && input.userId) {
    accountItems.unshift({
      key: 'account-my-page', label: 'My Page', category: 'Account', icon: 'id-card-outline',
      destination: { kind: 'native', tab: 'Profile', screen: 'PlayerCard', params: { playerId: input.userId } },
    });
    accountItems.push(
      { key: 'account-notifications', label: 'Notifications', category: 'Account', icon: 'notifications-outline', destination: { kind: 'native', tab: 'Profile', screen: 'NotificationsFeed' } },
      { key: 'account-settings', label: 'Settings', category: 'Account', icon: 'settings-outline', destination: { kind: 'native', tab: 'Profile', screen: 'NotificationSettings' } },
    );
  }

  const captainItems: MoreMenuItem[] = input.isCaptain ? [
    { key: 'captain-dashboard', label: 'Captain Dashboard', category: 'Captain', icon: 'shield-outline', destination: { kind: 'native', tab: 'Captain', screen: 'CaptainDashboard' } },
    { key: 'captain-goalies', label: 'Goalies', category: 'Captain', icon: 'hand-left-outline', destination: { kind: 'external', url: tenantPage(input.leagueSlug, '/captain/goalies') } },
  ] : [];

  const customItems: MoreMenuItem[] = (hasTenant ? input.customNavItems ?? [] : []).flatMap((item, index): MoreMenuItem[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    if (item.label !== undefined && typeof item.label !== 'string') return [];
    if (item.href !== undefined && typeof item.href !== 'string') return [];
    if (item.pageSlug !== undefined && typeof item.pageSlug !== 'string') return [];
    if (item.isExternal !== undefined && typeof item.isExternal !== 'boolean') return [];
    if (item.isCustomPage !== undefined && typeof item.isCustomPage !== 'boolean') return [];
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) return [];
    const canonical = canonicalTenantPage(item, input.leagueSlug);
    if (canonical === 'remove') return [];
    if ((canonical === 'events' || canonical === 'contact') && input.visiblePages?.[canonical] === false) return [];
    if ((canonical === 'events' || canonical === 'contact') && input.leagueId) {
      return [{
        key: `custom-${index}-${label}`,
        label,
        category: 'Custom',
        icon: PUBLIC_ICONS[canonical],
        destination: { kind: 'native', tab: 'LeaguePages', screen: canonical === 'events' ? 'Events' : 'Contact', params: { leagueId: input.leagueId, leagueSlug: input.leagueSlug } },
      }];
    }
    const url = item.isExternal === true
      ? safeExternalUrl(item.href)
      : (() => {
          const path = safeInternalPath(item);
          return path ? tenantPage(input.leagueSlug, path) : null;
        })();
    if (!url) return [];
    return [{
      key: `custom-${index}-${label}`,
      label,
      category: 'Custom',
      icon: item.isExternal === true ? 'open-outline' : 'document-text-outline',
      destination: { kind: 'external', url },
    }];
  });

  const unique = new Map<string, MoreMenuItem>();
  for (const item of [...appItems, ...accountItems, ...captainItems, ...leagueItems, ...customItems]) {
    const destinationKey = JSON.stringify(item.destination);
    if (!unique.has(destinationKey)) unique.set(destinationKey, item);
  }
  return [...unique.values()];
}
