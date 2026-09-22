import { supabase } from './client';
import { getAppleDeletionAuthorizationCode } from './auth';

type FunctionError = {
  message?: string;
  context?: unknown;
};

type AccountDeletionResponse = {
  success?: boolean;
  error?: string;
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

async function responseErrorMessage(context: unknown): Promise<string | null> {
  if (!context || typeof context !== 'object') return null;

  const response = context as { clone?: () => unknown; json?: () => Promise<unknown> };
  const candidate = typeof response.clone === 'function' ? response.clone() : response;
  if (!candidate || typeof (candidate as { json?: unknown }).json !== 'function') return null;

  try {
    const payload = await (candidate as { json: () => Promise<unknown> }).json();
    if (payload && typeof payload === 'object') {
      const message = (payload as AccountDeletionResponse).error;
      return typeof message === 'string' && message.trim() ? message : null;
    }
  } catch {
    return null;
  }

  return null;
}

export async function deleteCurrentAccount(
  options: { appleLinked?: boolean } = {},
  client: AccountDeletionClient = supabase,
): Promise<{ error: Error | null }> {
  try {
    let appleAuthorizationCode: string | undefined;
    if (options.appleLinked) {
      const reauthentication = await getAppleDeletionAuthorizationCode();
      if (reauthentication.error || !reauthentication.authorizationCode) {
        return {
          error: reauthentication.error ?? new Error('Apple reauthentication is required.'),
        };
      }
      appleAuthorizationCode = reauthentication.authorizationCode;
    }

    const { data, error } = await client.functions.invoke('delete-account', {
      body: {
        confirmation: 'DELETE',
        ...(appleAuthorizationCode ? { appleAuthorizationCode } : {}),
      },
    });

    if (error) {
      const functionError = error as FunctionError;
      const backendMessage = await responseErrorMessage(functionError.context);
      return { error: new Error(backendMessage ?? functionError.message ?? DEFAULT_ERROR) };
    }

    const payload = data as AccountDeletionResponse | null;
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
