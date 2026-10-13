export const PLAYER_PROFILE_ART_WIDTH = 643;
export const PLAYER_PROFILE_ART_HEIGHT = 1050;

export type PlayerProfileHeroLayout = {
  canvasWidth: number;
  stacked: boolean;
  artWidth: number;
  artHeight: number;
  artTop: number;
  identityWidth: number;
  stageHeight: number;
  platformClearance: number;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

export function splitPlayerDisplayName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { givenNames: '', surname: parts[0] ?? '' };
  return { givenNames: parts.slice(0, -1).join(' '), surname: parts.at(-1)! };
}

export function getPlayerProfileHeroLayout(viewportWidth: number, fontScale: number): PlayerProfileHeroLayout {
  const canvasWidth = clamp(viewportWidth, 280, 430);
  const stacked = fontScale >= 1.3 || canvasWidth < 350;
  const platformClearance = 28;
  const artWidth = stacked
    ? clamp(canvasWidth * 0.72, 202, 252)
    : clamp(canvasWidth * 0.58, 194, 236);
  const artHeight = artWidth * (PLAYER_PROFILE_ART_HEIGHT / PLAYER_PROFILE_ART_WIDTH);
  const artTop = stacked ? 0 : 54;
  const identityLeft = artWidth * 0.64;
  const identityWidth = stacked ? canvasWidth : Math.max(112, canvasWidth - identityLeft - 12);
  const stageHeight = stacked
    ? artHeight + platformClearance + 250
    : Math.max(414, artTop + artHeight + platformClearance);

  return {
    canvasWidth,
    stacked,
    artWidth,
    artHeight,
    artTop,
    identityWidth,
    stageHeight,
    platformClearance,
  };
}
