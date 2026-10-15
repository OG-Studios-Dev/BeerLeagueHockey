export const PRIVACY_URL = 'https://beerleaguehockey.ca/privacy';
export const TERMS_URL = 'https://beerleaguehockey.ca/terms';
export const HOCKEY_LIFE_SUPPORT_URL = 'https://hockey-life.beerleaguehockey.ca/contact';

const HOCKEY_LIFE_PUBLIC_ORIGIN = 'https://hockey-life.beerleaguehockey.ca';
const HOCKEY_LIFE_CAPTAIN_PATH = '/hockey-life/captain';
const SAFE_CAPTAIN_GAME_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const HOCKEY_LIFE_CAPTAIN_URL = `${HOCKEY_LIFE_PUBLIC_ORIGIN}${HOCKEY_LIFE_CAPTAIN_PATH}`;
export const HOCKEY_LIFE_CAPTAIN_FEES_URL = `${HOCKEY_LIFE_CAPTAIN_URL}/fees`;

export function isSafeCaptainGameId(gameId: string): boolean {
  return SAFE_CAPTAIN_GAME_ID.test(gameId);
}

export function buildHockeyLifeCaptainLineupUrl(gameId: string): string | null {
  if (!isSafeCaptainGameId(gameId)) return null;
  return `${HOCKEY_LIFE_CAPTAIN_URL}/lineups/${encodeURIComponent(gameId)}?mode=lineup`;
}

const APPROVED_EXACT_PUBLIC_URLS = new Set([
  PRIVACY_URL,
  TERMS_URL,
  HOCKEY_LIFE_SUPPORT_URL,
  HOCKEY_LIFE_CAPTAIN_URL,
  HOCKEY_LIFE_CAPTAIN_FEES_URL,
]);

export function isApprovedPublicLink(url: string): boolean {
  if (APPROVED_EXACT_PUBLIC_URLS.has(url)) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (
    parsed.origin !== HOCKEY_LIFE_PUBLIC_ORIGIN
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.hash
  ) {
    return false;
  }

  const prefix = `${HOCKEY_LIFE_CAPTAIN_PATH}/lineups/`;
  if (!parsed.pathname.startsWith(prefix)) return false;
  const encodedGameId = parsed.pathname.slice(prefix.length);
  if (!encodedGameId || encodedGameId.includes('/')) return false;

  let gameId: string;
  try {
    gameId = decodeURIComponent(encodedGameId);
  } catch {
    return false;
  }

  return isSafeCaptainGameId(gameId)
    && encodeURIComponent(gameId) === encodedGameId
    && parsed.search === '?mode=lineup';
}
