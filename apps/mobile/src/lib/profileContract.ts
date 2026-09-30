import type { Tables, TablesUpdate } from '../../../../packages/database/src/types';

export type ProfileRow = Tables<'profiles'>;
export type ProfileSkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type ProfilePreferencesUpdate = Pick<TablesUpdate<'profiles'>, 'position' | 'skill_level'>;

export const PROFILE_IDENTITY_SELECT = 'id, full_name, avatar_url, position, skill_level';
export const PROFILE_PREFERENCES_SELECT = 'full_name, position, avatar_url, skill_level';

const profilePreferencesChangeListeners = new Set<() => void>();

export function subscribeToProfilePreferencesChanges(listener: () => void): () => void {
  profilePreferencesChangeListeners.add(listener);
  return () => profilePreferencesChangeListeners.delete(listener);
}

export function notifyProfilePreferencesChanged(): void {
  for (const listener of profilePreferencesChangeListeners) listener();
}

export const PROFILE_SKILL_LEVELS: ReadonlyArray<{ value: ProfileSkillLevel; label: string; ratingTier: number }> = [
  { value: 'beginner', label: 'Beginner', ratingTier: 3 },
  { value: 'intermediate', label: 'Intermediate', ratingTier: 6 },
  { value: 'advanced', label: 'Advanced', ratingTier: 9 },
  { value: 'expert', label: 'Expert', ratingTier: 11 },
];

export function profileSkillRatingTier(value: string | null | undefined): number | null {
  return PROFILE_SKILL_LEVELS.find((level) => level.value === value)?.ratingTier ?? null;
}
