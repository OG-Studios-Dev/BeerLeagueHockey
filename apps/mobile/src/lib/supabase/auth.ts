import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { supabase } from './client';

WebBrowser.maybeCompleteAuthSession();

type OAuthProvider = 'apple' | 'google';

export async function getAppleDeletionAuthorizationCode(): Promise<{
  authorizationCode: string | null;
  error: Error | null;
}> {
  try {
    if (Platform.OS !== 'ios' || !(await AppleAuthentication.isAvailableAsync())) {
      return {
        authorizationCode: null,
        error: new Error('Sign in with Apple reauthentication is not available on this device.'),
      };
    }

    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    if (!credential.authorizationCode) {
      return {
        authorizationCode: null,
        error: new Error('Apple did not return an authorization code. Please try again.'),
      };
    }

    return { authorizationCode: credential.authorizationCode, error: null };
  } catch (error) {
    return {
      authorizationCode: null,
      error: error instanceof Error ? error : new Error('Apple reauthentication failed.'),
    };
  }
}

async function signInWithNativeApple(): Promise<{ error: Error | null }> {
  const isAppleAuthAvailable = await AppleAuthentication.isAvailableAsync();

  if (!isAppleAuthAvailable) {
    return { error: new Error('Apple sign-in is not available on this device') };
  }

  try {
    // Generate raw nonce and hash it for Apple
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce
    );

    // Apple gets the HASHED nonce
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      return { error: new Error('Apple sign-in did not return an identity token') };
    }

    // Supabase gets the RAW nonce (it hashes internally to verify)
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
      access_token: credential.authorizationCode ?? undefined,
    });

    if (error) {
      return { error: new Error(error.message) };
    }

    return { error: null };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'ERR_REQUEST_CANCELED'
    ) {
      return { error: new Error('Apple sign-in was canceled') };
    }

    return {
      error: error instanceof Error ? error : new Error('Apple sign-in failed'),
    };
  }
}

/**
 * Returns the correct OAuth redirect URI based on runtime environment.
 *
 * - In Expo Go: uses the exp:// scheme (e.g. exp://192.168.x.x:8082/--/auth/callback)
 *   Because Expo Go doesn't support custom URI schemes like blh://.
 *   Nick: add `exp://**` as a wildcard in Supabase → Auth → URL Configuration → Redirect URLs.
 *
 * - In standalone / dev builds: uses blh://auth/callback (custom scheme from app.json).
 */
function getRedirectUri(): string {
  const isExpoGo = Constants.appOwnership === 'expo';
  if (isExpoGo) {
    return Linking.createURL('/auth/callback');
  }
  return 'blh://auth/callback';
}

function getParam(url: string, key: string): string | null {
  const [base, fragment = ''] = url.split('#');
  const queryParams = new URL(base).searchParams;
  const fragmentParams = new URLSearchParams(fragment);
  return queryParams.get(key) ?? fragmentParams.get(key);
}

export async function signInWithOAuth(provider: OAuthProvider): Promise<{ error: Error | null }> {
  if (provider === 'apple' && Platform.OS === 'ios') {
    return signInWithNativeApple();
  }

  const redirectTo = getRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    return { error: new Error(error.message) };
  }

  if (!data?.url) {
    return { error: new Error('Missing OAuth URL from Supabase') };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== 'success' || !result.url) {
    return { error: new Error('OAuth sign-in was canceled or failed') };
  }

  const code = getParam(result.url, 'code');
  const accessToken = getParam(result.url, 'access_token');
  const refreshToken = getParam(result.url, 'refresh_token');

  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    return { error: exchangeError ? new Error(exchangeError.message) : null };
  }

  if (accessToken && refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return { error: sessionError ? new Error(sessionError.message) : null };
  }

  return { error: new Error('Unable to read OAuth session from callback URL') };
}
