import { isApprovedPublicLink } from '../config/publicLinks';

export {
  HOCKEY_LIFE_CAPTAIN_FEES_URL,
  HOCKEY_LIFE_CAPTAIN_URL,
  HOCKEY_LIFE_SUPPORT_URL,
  PRIVACY_URL,
  TERMS_URL,
  buildHockeyLifeCaptainLineupUrl,
  isApprovedPublicLink,
  isSafeCaptainGameId,
} from '../config/publicLinks';

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
