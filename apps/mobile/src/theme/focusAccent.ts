import { HOCKEY_LIFE_PRIMARY } from '../config/hockeyLife';

function opaqueHex(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : null;
}

export function resolveFocusAccent(teamPrimaryColor: unknown, leaguePrimaryColor: unknown) {
  return opaqueHex(teamPrimaryColor) ?? opaqueHex(leaguePrimaryColor) ?? HOCKEY_LIFE_PRIMARY;
}
