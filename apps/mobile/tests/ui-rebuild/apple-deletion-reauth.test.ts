import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

describe('Apple deletion reauthentication', () => {
  it('requests a fresh native authorization code without returning provider tokens', async () => {
    const requests: unknown[] = [];
    const auth = compileCommonJs<{
      getAppleDeletionAuthorizationCode: () => Promise<{ authorizationCode: string | null; error: Error | null }>;
    }>(new URL('../../src/lib/supabase/auth.ts', import.meta.url), {
      'expo-apple-authentication': {
        AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
        isAvailableAsync: async () => true,
        signInAsync: async (options: unknown) => {
          requests.push(options);
          return {
            authorizationCode: 'fresh-delete-code',
            identityToken: 'must-not-be-returned',
          };
        },
      },
      'expo-web-browser': { maybeCompleteAuthSession: () => undefined },
      'expo-linking': { createURL: () => 'blh://auth/callback' },
      'expo-constants': { default: { appOwnership: null } },
      'expo-crypto': {},
      'react-native': { Platform: { OS: 'ios' } },
      './client': { supabase: {} },
    });

    assert.deepEqual(await auth.getAppleDeletionAuthorizationCode(), {
      authorizationCode: 'fresh-delete-code',
      error: null,
    });
    assert.deepEqual(requests, [{ requestedScopes: [] }]);
  });
});
