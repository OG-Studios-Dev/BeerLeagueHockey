export const PRIVACY_URL = 'https://beerleaguehockey.ca/privacy';
export const TERMS_URL = 'https://beerleaguehockey.ca/terms';
export const HOCKEY_LIFE_SUPPORT_URL = 'https://hockey-life.beerleaguehockey.ca/contact';

const APPROVED_PUBLIC_URLS = new Set([
  PRIVACY_URL,
  TERMS_URL,
  HOCKEY_LIFE_SUPPORT_URL,
]);

export function isApprovedPublicLink(url: string) {
  return APPROVED_PUBLIC_URLS.has(url);
}

export type PublicLinkResult =
  | { success: true }
  | { success: false; error: string };

export async function openPublicLink(
  url: string,
  opener: (approvedUrl: string) => Promise<unknown>,
): Promise<PublicLinkResult> {
  if (!isApprovedPublicLink(url)) {
    return { success: false, error: 'This link is not available in Hockey Life.' };
  }

  try {
    await opener(url);
    return { success: true };
  } catch {
    return { success: false, error: 'This link could not be opened. Please try again.' };
  }
}
