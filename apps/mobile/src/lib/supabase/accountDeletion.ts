import { supabase } from './client';
import { getAppleDeletionAuthorizationCode } from './auth';

type FunctionError = {
  message?: string;
  context?: unknown;
};

type AccountDeletionResponse = {
  success?: boolean;
  error?: string;
  code?: string;
};

type AccountDeletionClient = {
  functions: {
    invoke: (
      name: string,
      options: {
        body: {
          confirmation: 'DELETE';
          appleAuthorizationCode?: string;
        };
      },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
};

const DEFAULT_ERROR = 'Unable to delete your account. Please try again.';

async function responseErrorPayload(context: unknown): Promise<AccountDeletionResponse | null> {
  if (!context || typeof context !== 'object') return null;

  const response = context as { clone?: () => unknown; json?: () => Promise<unknown> };
  const candidate = typeof response.clone === 'function' ? response.clone() : response;
  if (!candidate || typeof (candidate as { json?: unknown }).json !== 'function') return null;

  try {
    const payload = await (candidate as { json: () => Promise<unknown> }).json();
    if (payload && typeof payload === 'object') {
      return payload as AccountDeletionResponse;
    }
  } catch {
    return null;
  }

  return null;
}

export async function deleteCurrentAccount(
  client: AccountDeletionClient = supabase,
): Promise<{ error: Error | null }> {
  try {
    const invoke = (appleAuthorizationCode?: string) => client.functions.invoke('delete-account', {
      body: {
        confirmation: 'DELETE',
        ...(appleAuthorizationCode ? { appleAuthorizationCode } : {}),
      },
    });

    let result = await invoke();
    let functionPayload = result.error
      ? await responseErrorPayload((result.error as FunctionError).context)
      : null;

    if (functionPayload?.code === 'apple_reauthentication_required') {
      const reauthentication = await getAppleDeletionAuthorizationCode();
      if (reauthentication.error || !reauthentication.authorizationCode) {
        return {
          error: reauthentication.error ?? new Error('Apple reauthentication is required.'),
        };
      }
      result = await invoke(reauthentication.authorizationCode);
      functionPayload = result.error
        ? await responseErrorPayload((result.error as FunctionError).context)
        : null;
    }

    if (result.error) {
      const functionError = result.error as FunctionError;
      return { error: new Error(functionPayload?.error ?? functionError.message ?? DEFAULT_ERROR) };
    }

    const payload = result.data as AccountDeletionResponse | null;
    if (!payload?.success) {
      return { error: new Error(payload?.error ?? DEFAULT_ERROR) };
    }

    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(DEFAULT_ERROR),
    };
  }
}
