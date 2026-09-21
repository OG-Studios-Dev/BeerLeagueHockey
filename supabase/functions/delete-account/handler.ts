type BackendError = { message: string };

type BackendClient = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string } | null };
      error: BackendError | null;
    }>;
  };
  rpc: (
    name: 'execute_account_deletion',
    args: { p_user_id: string },
  ) => PromiseLike<{ data: unknown; error: BackendError | null }>;
};

type BackendClientFactory = () => BackendClient;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

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
