import type { AppleAuthorizationService, AppleRevocationGrant } from './apple.ts';

type BackendError = { message: string };

type AuthUser = {
  id: string;
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
      list: (
        prefix: string,
        options: { limit: number; offset: number; search?: string },
      ) => PromiseLike<{ data: Array<{ name: string }> | null; error: unknown }>;
      remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
    };
  };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: BackendError | null;
  }>;
};

type BackendClientFactory = () => BackendClient;
type DeleteAccountDependencies = {
  appleAuthorization?: AppleAuthorizationService;
};

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

type StorageClient = BackendClient['storage'];
const STORAGE_PAGE_SIZE = 100;
const STORAGE_MAX_PAGES = 100;

export async function listOwnedProfileImageObjects(
  userId: string,
  storage: StorageClient,
): Promise<ProfileImageObject[]> {
  const specifications: Array<{
    bucket: ProfileImageObject['bucket'];
    prefix: string;
    search?: string;
    ownedPath: (name: string) => string | null;
  }> = [
    {
      bucket: 'avatars',
      prefix: userId,
      ownedPath: (name) => /^avatar\.(?:jpe?g|png|webp)$/i.test(name)
        ? `${userId}/${name}`
        : null,
    },
    {
      bucket: 'player-photos',
      prefix: userId,
      ownedPath: (name) => /^[0-9]+\.(?:jpe?g|png|webp)$/i.test(name)
        ? `${userId}/${name}`
        : null,
    },
    {
      bucket: 'player-avatars',
      prefix: '',
      search: `${userId}-`,
      ownedPath: (name) => new RegExp(
        `^${regexEscape(userId)}-[0-9]+\\.(?:jpe?g|png|webp)$`,
        'i',
      ).test(name) ? name : null,
    },
  ];

  const objects: ProfileImageObject[] = [];
  for (const specification of specifications) {
    let exhausted = false;
    for (let page = 0; page < STORAGE_MAX_PAGES; page += 1) {
      const options = {
        limit: STORAGE_PAGE_SIZE,
        offset: page * STORAGE_PAGE_SIZE,
        ...(specification.search ? { search: specification.search } : {}),
      };
      const { data, error } = await storage.from(specification.bucket).list(
        specification.prefix,
        options,
      );
      if (error || !data) throw new Error('Unable to list account-owned storage objects.');

      for (const entry of data) {
        if (!entry || typeof entry.name !== 'string') continue;
        if (entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('%') || entry.name.includes('\0')) continue;
        const path = specification.ownedPath(entry.name);
        if (path) objects.push({ bucket: specification.bucket, path });
      }
      if (data.length < STORAGE_PAGE_SIZE) {
        exhausted = true;
        break;
      }
    }
    if (!exhausted) throw new Error('Account-owned storage listing exceeded the safety bound.');
  }
  return objects;
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

export function createDeleteAccountHandler(
  createBackendClient: BackendClientFactory,
  dependencies: DeleteAccountDependencies = {},
) {
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
      const providerCredentialFields = new Set([
        'refreshToken',
        'refresh_token',
        'clientSecret',
        'client_secret',
        'appleRefreshToken',
        'apple_refresh_token',
        'accessToken',
        'access_token',
        'providerToken',
        'provider_token',
        'revocationToken',
        'revocation_token',
        'token_type_hint',
        'identityToken',
        'identity_token',
        'provider',
        'providers',
        'providerMetadata',
        'provider_metadata',
        'appleLinked',
        'identities',
      ]);
      if (Object.keys(payload).some((key) => providerCredentialFields.has(key))) {
        return json(400, {
          error: 'Provider metadata and credentials are not accepted from the client.',
          code: 'unsupported_provider_credentials',
        });
      }

      const { data: preparation, error: preparationError } = await backend.rpc(
        'prepare_account_deletion',
        { p_user_id: authData.user.id },
      );
      if (preparationError || !preparation || typeof preparation !== 'object') {
        const message = preparationError?.message.toLowerCase() ?? '';
        if (message.includes('league') && message.includes('ownership')) {
          return json(409, {
            error: 'Transfer ownership of every league you own, then try again.',
            code: 'league_ownership',
          });
        }
        if (message.includes('organization') && message.includes('ownership')) {
          return json(409, {
            error: 'Transfer ownership of every organization you own, then try again.',
            code: 'organization_ownership',
          });
        }
        return json(500, { error: 'Unable to prepare account deletion.', code: 'deletion_preflight_failed' });
      }

      const prepared = preparation as {
        apple_required?: unknown;
        apple_revoked?: unknown;
        apple_subject?: unknown;
        apple_retry_ready?: unknown;
      };
      if (prepared.apple_required === true) {
        const appleAlreadyRevoked = prepared.apple_revoked === true;
        if (!appleAlreadyRevoked) {
          if (!dependencies.appleAuthorization) {
            return json(500, {
              error: 'Apple account revocation is not configured.',
              code: 'apple_revocation_configuration_error',
            });
          }
          if (typeof prepared.apple_subject !== 'string' || !prepared.apple_subject) {
            return json(500, {
              error: 'Unable to verify the Sign in with Apple account binding.',
              code: 'apple_identity_binding_failed',
            });
          }

          let grant: AppleRevocationGrant;
          if (prepared.apple_retry_ready === true) {
            const { data: retry, error: retryError } = await backend.rpc(
              'get_account_apple_revocation_retry',
              { p_user_id: authData.user.id },
            );
            const retryState = retry as {
              apple_subject?: unknown;
              revocation_token?: unknown;
              token_type_hint?: unknown;
            } | null;
            if (
              retryError
              || retryState?.apple_subject !== prepared.apple_subject
              || typeof retryState.revocation_token !== 'string'
              || (retryState.token_type_hint !== 'refresh_token'
                && retryState.token_type_hint !== 'access_token')
            ) {
              return json(500, {
                error: 'Unable to resume Sign in with Apple revocation.',
                code: 'apple_revocation_retry_unavailable',
              });
            }
            grant = {
              subject: retryState.apple_subject,
              revocationToken: retryState.revocation_token,
              tokenTypeHint: retryState.token_type_hint,
            };
          } else {
            const authorizationCode = (payload as { appleAuthorizationCode?: unknown }).appleAuthorizationCode;
            if (typeof authorizationCode !== 'string' || !authorizationCode.trim()) {
              return json(409, {
                error: 'Sign in with Apple again to authorize account deletion.',
                code: 'apple_reauthentication_required',
              });
            }
            try {
              grant = await dependencies.appleAuthorization.exchangeAuthorizationCode(
                authorizationCode,
                prepared.apple_subject,
              );
            } catch {
              return json(502, {
                error: 'Unable to verify Sign in with Apple access. Your account was not deleted.',
                code: 'apple_identity_verification_failed',
              });
            }
            const { error: stageError } = await backend.rpc('stage_account_apple_revocation', {
              p_user_id: authData.user.id,
              p_apple_subject: grant.subject,
              p_revocation_token: grant.revocationToken,
              p_token_type_hint: grant.tokenTypeHint,
            });
            if (stageError) {
              return json(500, {
                error: 'Unable to save Sign in with Apple revocation for retry. Your account was not deleted.',
                code: 'apple_revocation_stage_failed',
              });
            }
          }

          try {
            await dependencies.appleAuthorization.revokeToken(grant);
          } catch {
            return json(502, {
              error: 'Unable to revoke Sign in with Apple access. Your account was not deleted.',
              code: 'apple_revocation_failed',
            });
          }
          const { error: markerError } = await backend.rpc('mark_account_apple_revoked', {
            p_user_id: authData.user.id,
          });
          if (markerError) {
            return json(500, {
              error: 'Apple access was revoked, but deletion could not be recorded. Try again.',
              code: 'apple_revocation_marker_failed',
            });
          }
        }
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

      let listedImages: ProfileImageObject[];
      try {
        listedImages = await listOwnedProfileImageObjects(authData.user.id, backend.storage);
      } catch {
        return json(500, { error: PROFILE_IMAGE_ERROR, code: 'image_cleanup_failed' });
      }
      const profileImages = new Map<string, ProfileImageObject>();
      for (const object of [
        ...listedImages,
        ...extractOwnedProfileImageObjects(authData.user.id, profile),
      ]) {
        profileImages.set(`${object.bucket}\0${object.path}`, object);
      }
      for (const object of profileImages.values()) {
        const { error: storageError } = await backend.storage
          .from(object.bucket)
          .remove([object.path]);
        if (storageError && !isNotFoundStorageError(storageError)) {
          return json(500, { error: PROFILE_IMAGE_ERROR, code: 'image_cleanup_failed' });
        }
      }

      const { error: storageMarkerError } = await backend.rpc('mark_account_storage_deleted', {
        p_user_id: authData.user.id,
      });
      if (storageMarkerError) {
        return json(500, { error: 'Unable to record image cleanup.', code: 'image_cleanup_failed' });
      }

      const { error: deletionError } = await backend.rpc('execute_account_deletion', {
        p_user_id: authData.user.id,
      });
      if (deletionError) {
        const normalizedMessage = deletionError.message.toLowerCase();
        if (normalizedMessage.includes('league') && normalizedMessage.includes('transfer ownership')) {
          return json(409, {
            error: 'Transfer ownership of every league you own, then try again.',
            code: 'league_ownership',
          });
        }
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
