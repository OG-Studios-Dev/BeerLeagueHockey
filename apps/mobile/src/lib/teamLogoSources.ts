/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires static image requires. */
import type { ImageSourcePropType } from 'react-native';

const TEAM_LOGO_BY_ID: Record<string, ImageSourcePropType> = {
  '453d62d9-80b4-4f26-a2ee-861f0c063402': require('../../assets/team-logos/first-general-london.png'),
  'e4be829d-952c-4531-8376-215907fab3b7': require('../../assets/team-logos/fitzrays-flyers.png'),
  '346833e0-2780-492d-86db-94df0b0cb3e1': require('../../assets/team-logos/fitzrays-premier.png'),
  '093f611c-0cdc-4509-afde-9c661b5833c9': require('../../assets/team-logos/london-eco-metal.png'),
};

const TEAM_ID_BY_VERIFIED_LEGACY_URL: Record<string, string> = {
  'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/team-logos/team-logos/453d62d9-80b4-4f26-a2ee-861f0c063402-manual-flat.png': '453d62d9-80b4-4f26-a2ee-861f0c063402',
  'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/team-logos/team-logos/e4be829d-952c-4531-8376-215907fab3b7-manual-flat.png': 'e4be829d-952c-4531-8376-215907fab3b7',
  'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/team-logos/team-logos/346833e0-2780-492d-86db-94df0b0cb3e1-manual-fitzrays-red.png': '346833e0-2780-492d-86db-94df0b0cb3e1',
  'https://auth.beerleaguehockey.ca/storage/v1/object/public/team-logos/team-logos/093f611c-0cdc-4509-afde-9c661b5833c9-manual-flat-v2.png': '093f611c-0cdc-4509-afde-9c661b5833c9',
};

export function getBundledTeamLogoSource(
  teamId?: string | null,
  logoUrl?: string | null,
): ImageSourcePropType | null {
  if (teamId && TEAM_LOGO_BY_ID[teamId]) return TEAM_LOGO_BY_ID[teamId];
  const verifiedId = logoUrl ? TEAM_ID_BY_VERIFIED_LEGACY_URL[logoUrl] : undefined;
  return verifiedId ? TEAM_LOGO_BY_ID[verifiedId] ?? null : null;
}
