const PROFILE_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function profileImageExtension(mimeType: string): string | null {
  return PROFILE_IMAGE_EXTENSIONS[mimeType] ?? null;
}
