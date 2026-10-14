export const HOME_PHOTO_SLIDE_LIMIT = 10;
export const HOME_PHOTO_CAPTION_LIMIT = 160;

export function cleanHomePhotoCaption(value: string | null | undefined): string | null {
  if (!value || /<[^>]*>|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 && normalized.length <= HOME_PHOTO_CAPTION_LIMIT ? normalized : null;
}

export function selectHomePhotoSlides<T extends { id: string }>(
  photos: readonly T[],
  random: () => number = Math.random,
  limit = HOME_PHOTO_SLIDE_LIMIT,
): T[] {
  const seen = new Set<string>();
  const shuffled = photos.filter((photo) => {
    if (seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  });
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = Math.max(0, Math.min(0.9999999999999999, random()));
    const target = Math.floor(sample * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled.slice(0, Math.max(0, Math.floor(limit)));
}
