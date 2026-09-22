type BackendError = { message: string };

type AuthUser = {
  id: string;
  app_metadata?: { provider?: unknown; providers?: unknown };
  identities?: Array<{ provider?: unknown }> | null;
};

type ProfileImageFields = {
  avatar_url: string | null;
  photo_url: string | null;
};

export type ProfileImageObject = {
  bucket: 'avatars' | 'player-avatars' | 'player-photos';
  path: string;
};

type BackendClient = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: AuthUser | null };
      error: BackendError | null;
    }>;
  };
  from: (table: string) => unknown;
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
    };
  };
  rpc: (
    name: 'execute_account_deletion',
    args: { p_user_id: string },
  ) => PromiseLike<{ data: unknown; error: BackendError | null }>;
};

type BackendClientFactory = () => BackendClient;

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const PROFILE_IMAGE_ERROR = 'Unable to remove your profile image. Your account was not deleted.';

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function profileImageObject(userId: string, value: string | null): ProfileImageObject | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    const match = url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!match?.[1] || !match[2]) return null;

    const bucket = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    if (path.includes('\\') || path.includes('\0')) return null;

    const escapedUserId = regexEscape(userId);
    if (bucket === 'avatars' && path === `${userId}/avatar.jpg`) {
      return { bucket, path };
    }
    if (
      bucket === 'player-avatars'
      && new RegExp(`^${escapedUserId}-[0-9]+\\.(?:jpe?g|png|webp)$`, 'i').test(path)
    ) {
      return { bucket, path };
    }
    if (
      bucket === 'player-photos'
      && new RegExp(`^${escapedUserId}/[0-9]+\\.(?:jpe?g|png|webp)$`, 'i').test(path)
    ) {
      return { bucket, path };
    }
  } catch {
    return null;
  }

  return null;
}

export function extractOwnedProfileImageObjects(
  userId: string,
  profile: ProfileImageFields | null,
): ProfileImageObject[] {
  if (!profile) return [];

  const unique = new Map<string, ProfileImageObject>();
  for (const value of [profile.avatar_url, profile.photo_url]) {
    const object = profileImageObject(userId, value);
    if (object) unique.set(`${object.bucket}\0${object.path}`, object);
  }
  return [...unique.values()];
}

function isAppleLinked(user: AuthUser): boolean {
  const provider = user.app_metadata?.provider;
  const providers = user.app_metadata?.providers;
  return provider === 'apple'
    || (Array.isArray(providers) && providers.includes('apple'))
    || user.identities?.some((identity) => identity.provider === 'apple') === true;
}

function isNotFoundStorageError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return String(candidate.status ?? candidate.statusCode ?? '') === '404';
}

type ProfileTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => PromiseLike<{ data: ProfileImageFields | null; error: BackendError | null }>;
    };
  };
};

type OrganizationsTable = {
  select: (
    columns: string,
    options: { count: 'exact'; head: true },
  ) => {
    eq: (
      column: string,
      value: string,
    ) => PromiseLike<{ data: unknown; error: BackendError | null; count: number | null }>;
  };
};

export function createDeleteAccountHandler(createBackendClient: BackendClientFactory) {
  return async function handleDeleteAccount(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json(405, { error: 'Method not allowed.', code: 'method_not_allowed' }, { Allow: 'POST' });
    }

    const token = bearerToken(request);
    if (!token) {
      return json(401, { error: 'Authentication required.', code: 'unauthorized' });
    }

    try {
      const backend = createBackendClient();
      const { data: authData, error: authError } = await backend.auth.getUser(token);
      if (authError || !authData.user) {
        return json(401, { error: 'Authentication required.', code: 'unauthorized' });
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        payload = null;
      }
      if (
        !payload
        || typeof payload !== 'object'
        || (payload as { confirmation?: unknown }).confirmation !== 'DELETE'
      ) {
        return json(400, {
          error: 'Explicit deletion confirmation is required.',
          code: 'confirmation_required',
        });
      }

      if (isAppleLinked(authData.user)) {
        return json(409, {
          error: 'Apple sign-in access must be revoked before this account can be deleted. Contact support to complete deletion.',
          code: 'apple_revocation_unavailable',
        });
      }

      const organizationsTable = backend.from('organizations') as OrganizationsTable;
      const { count: organizationCount, error: organizationError } = await organizationsTable
        .select('id', { count: 'exact', head: true })
        .eq('owner_user_id', authData.user.id);
      if (organizationError) {
        return json(500, { error: 'Unable to delete account.', code: 'deletion_failed' });
      }
      if ((organizationCount ?? 0) > 0) {
        return json(409, {
          error: 'Transfer ownership of every organization you own, then try again.',
          code: 'organization_ownership',
        });
      }

      const profilesTable = backend.from('profiles') as ProfileTable;
      const { data: profile, error: profileError } = await profilesTable
        .select('avatar_url, photo_url')
        .eq('id', authData.user.id)
        .maybeSingle();
      if (profileError) {
        return json(500, { error: PROFILE_IMAGE_ERROR, code: 'image_cleanup_failed' });
      }

      const profileImages = extractOwnedProfileImageObjects(authData.user.id, profile);
      for (const object of profileImages) {
        const { error: storageError } = await backend.storage
          .from(object.bucket)
          .remove([object.path]);
        if (storageError && !isNotFoundStorageError(storageError)) {
          return json(500, { error: PROFILE_IMAGE_ERROR, code: 'image_cleanup_failed' });
        }
      }

      const { error: deletionError } = await backend.rpc('execute_account_deletion', {
        p_user_id: authData.user.id,
      });
      if (deletionError) {
        const normalizedMessage = deletionError.message.toLowerCase();
        if (normalizedMessage.includes('organization') && normalizedMessage.includes('transfer ownership')) {
          return json(409, {
            error: 'Transfer ownership of every organization you own, then try again.',
            code: 'organization_ownership',
          });
        }

        return json(500, { error: 'Unable to delete account.', code: 'deletion_failed' });
      }

      return json(200, { success: true });
    } catch {
      return json(500, { error: 'Unable to delete account.', code: 'deletion_failed' });
    }
  };
}
