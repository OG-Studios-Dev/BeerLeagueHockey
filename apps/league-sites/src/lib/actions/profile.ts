'use server';

import { createAuthClient as createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { resolvePlayerPhotoUrl } from '@/lib/player-photo';
import { profileImageExtension } from '@/lib/profile-image-mime';

export type ProfileActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Upload a profile photo for the authenticated user.
 * Stores in `player-avatars` bucket and updates `profiles.avatar_url`.
 */
export async function uploadProfilePhoto(
  formData: FormData
): Promise<ProfileActionResult<{ url: string }>> {
  const supabase = await createClient();

  // Verify authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'You must be logged in to upload a photo' };
  }

  try {
    const file = formData.get('file') as File | null;

    if (!file || !(file instanceof File)) {
      return { success: false, error: 'No file provided' };
    }

    // Validate file type
    const canonicalExtension = profileImageExtension(file.type);
    if (!canonicalExtension || !ALLOWED_MIME_TYPES.includes(file.type)) {
      return {
        success: false,
        error: 'Invalid file type. Please upload a JPG, PNG, or WebP image.',
      };
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: 'File too large. Maximum size is 2MB.',
      };
    }

    // Get current profile to check for existing avatar
    const { data: profile } = await supabase
      .from('profiles')
      .select('avatar_url, photo_url')
      .eq('id', user.id)
      .single();

    const currentPhotoUrl = resolvePlayerPhotoUrl(profile);

    // Delete old avatar if it exists and is stored in Supabase
    if (currentPhotoUrl && currentPhotoUrl.includes('player-avatars')) {
      try {
        const urlObj = new URL(currentPhotoUrl);
        const pathMatch = urlObj.pathname.match(
          /\/storage\/v1\/object\/public\/player-avatars\/(.+)$/
        );
        if (pathMatch && pathMatch[1]) {
          await supabase.storage
            .from('player-avatars')
            .remove([decodeURIComponent(pathMatch[1])]);
        }
      } catch {
        // Ignore errors when deleting old avatar
      }
    }

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${user.id}-${timestamp}.${canonicalExtension}`;

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('player-avatars')
      .upload(filename, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('[uploadProfilePhoto] Upload error:', uploadError);
      return {
        success: false,
        error: `Failed to upload photo: ${uploadError.message}`,
      };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('player-avatars')
      .getPublicUrl(filename);

    const avatarUrl = urlData.publicUrl;

    // Update profile with new avatar URL
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        avatar_url: avatarUrl,
        photo_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      // Try to clean up the uploaded file
      await supabase.storage.from('player-avatars').remove([filename]);
      console.error('[uploadProfilePhoto] Update error:', updateError);
      return { success: false, error: 'Failed to update profile with new photo' };
    }

    // Revalidate relevant paths
    revalidatePath('/[leagueSlug]/me/profile');
    revalidatePath('/[leagueSlug]/me');

    return {
      success: true,
      data: { url: avatarUrl },
    };
  } catch (error) {
    console.error('[uploadProfilePhoto] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    };
  }
}

/**
 * Delete the current user's profile photo
 */
export async function deleteProfilePhoto(): Promise<ProfileActionResult> {
  const supabase = await createClient();

  // Verify authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'You must be logged in to delete your photo' };
  }

  try {
    // Get current avatar URL
    const { data: profile } = await supabase
      .from('profiles')
      .select('avatar_url, photo_url')
      .eq('id', user.id)
      .single();

    const currentPhotoUrl = resolvePlayerPhotoUrl(profile);

    // Delete from storage if it exists and is stored in Supabase
    if (currentPhotoUrl && currentPhotoUrl.includes('player-avatars')) {
      try {
        const urlObj = new URL(currentPhotoUrl);
        const pathMatch = urlObj.pathname.match(
          /\/storage\/v1\/object\/public\/player-avatars\/(.+)$/
        );
        if (pathMatch && pathMatch[1]) {
          await supabase.storage
            .from('player-avatars')
            .remove([decodeURIComponent(pathMatch[1])]);
        }
      } catch {
        // Ignore errors when deleting from storage
      }
    }

    // Update profile to remove avatar URL
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        avatar_url: null,
        photo_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('[deleteProfilePhoto] Update error:', updateError);
      return { success: false, error: 'Failed to remove photo from profile' };
    }

    // Revalidate relevant paths
    revalidatePath('/[leagueSlug]/me/profile');
    revalidatePath('/[leagueSlug]/me');

    return { success: true, data: undefined };
  } catch (error) {
    console.error('[deleteProfilePhoto] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Delete failed',
    };
  }
}
