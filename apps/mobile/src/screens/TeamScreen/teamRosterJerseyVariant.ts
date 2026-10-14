import type { TeamPageIdentity } from '../../lib/supabase/teamPage';

export type TeamRosterJerseyVariant =
  | 'bad-bunny'
  | 'first-general-london'
  | 'liuna'
  | 'fitzrays'
  | 'fallback';

const VARIANT_BY_ID: Record<string, Exclude<TeamRosterJerseyVariant, 'fallback'>> = {
  '093f611c-0cdc-4509-afde-9c661b5833c9': 'bad-bunny',
  '453d62d9-80b4-4f26-a2ee-861f0c063402': 'first-general-london',
  '346833e0-2780-492d-86db-94df0b0cb3e1': 'liuna',
  'e4be829d-952c-4531-8376-215907fab3b7': 'fitzrays',
};

const VARIANT_BY_IDENTITY: Record<string, Exclude<TeamRosterJerseyVariant, 'fallback'>> = {
  'bad-bunny': 'bad-bunny',
  'london-eco-metal': 'bad-bunny',
  'first-general-london': 'first-general-london',
  liuna: 'liuna',
  'fitzrays-premier': 'liuna',
  fitzrays: 'fitzrays',
  'fitzrays-flyers': 'fitzrays',
};

function normalizeTeamIdentity(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveTeamRosterJerseyVariant(
  team: Pick<TeamPageIdentity, 'id' | 'name' | 'slug'>,
): TeamRosterJerseyVariant {
  const idMatch = VARIANT_BY_ID[team.id.trim().toLowerCase()];
  if (idMatch) return idMatch;
  return VARIANT_BY_IDENTITY[normalizeTeamIdentity(team.slug)]
    ?? VARIANT_BY_IDENTITY[normalizeTeamIdentity(team.name)]
    ?? 'fallback';
}
