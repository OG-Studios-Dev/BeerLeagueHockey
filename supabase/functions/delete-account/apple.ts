export type AppleServerConfiguration = {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKeyP8: string;
};

export type AppleRevocationGrant = {
  subject: string;
  revocationToken: string;
  tokenTypeHint: 'refresh_token' | 'access_token';
};

export type AppleAuthorizationService = {
  exchangeAuthorizationCode: (
    authorizationCode: string,
    expectedSubject: string,
  ) => Promise<AppleRevocationGrant>;
  revokeToken: (grant: Pick<AppleRevocationGrant, 'revocationToken' | 'tokenTypeHint'>) => Promise<void>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodedJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodedJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as Record<string, unknown>;
  } catch {
    throw new Error('Apple identity token is invalid.');
  }
}

function pkcs8Bytes(pem: string): Uint8Array {
  const normalized = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!normalized) throw new Error('Apple private key is not configured.');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function clientSecret(
  configuration: AppleServerConfiguration,
  now: Date,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = encodedJson({ alg: 'ES256', kid: configuration.keyId, typ: 'JWT' });
  const payload = encodedJson({
    iss: configuration.teamId,
    iat: issuedAt,
    exp: issuedAt + (5 * 60),
    aud: 'https://appleid.apple.com',
    sub: configuration.clientId,
  });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Bytes(configuration.privateKeyP8),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

async function verifiedAppleSubject(
  identityToken: string,
  clientId: string,
  fetchImpl: FetchLike,
  now: Date,
): Promise<string> {
  const parts = identityToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Apple identity token is invalid.');
  }
  const header = decodedJson(parts[0]);
  const claims = decodedJson(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Apple identity token is invalid.');
  }

  const keysResponse = await fetchImpl('https://appleid.apple.com/auth/keys');
  if (!keysResponse.ok) throw new Error('Apple identity verification failed.');
  const keySet = await keysResponse.json() as { keys?: JsonWebKey[] };
  const jwk = keySet.keys?.find((candidate) => candidate.kid === header.kid && candidate.alg === 'RS256');
  if (!jwk) throw new Error('Apple identity verification failed.');

  const verificationKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    verificationKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !verified
    || claims.iss !== 'https://appleid.apple.com'
    || !audiences.includes(clientId)
    || typeof claims.exp !== 'number'
    || claims.exp <= nowSeconds
    || typeof claims.sub !== 'string'
    || !claims.sub
  ) {
    throw new Error('Apple identity token is invalid.');
  }
  return claims.sub;
}

export function createAppleAuthorizationService(
  configuration: AppleServerConfiguration,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): AppleAuthorizationService {
  const commonParameters = async () => ({
    client_id: configuration.clientId,
    client_secret: await clientSecret(configuration, now()),
  });

  return {
    exchangeAuthorizationCode: async (authorizationCode, expectedSubject) => {
      if (!authorizationCode.trim()) throw new Error('Apple authorization code is required.');
      if (!expectedSubject.trim()) throw new Error('Apple account binding is unavailable.');
      const exchange = await fetchImpl('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...(await commonParameters()),
          grant_type: 'authorization_code',
          code: authorizationCode,
        }),
      });
      if (!exchange.ok) throw new Error('Apple authorization-code exchange failed.');

      let tokens: { refresh_token?: unknown; access_token?: unknown; id_token?: unknown };
      try {
        tokens = await exchange.json() as typeof tokens;
      } catch {
        throw new Error('Apple token exchange response is invalid.');
      }
      if (typeof tokens.id_token !== 'string') {
        throw new Error('Apple token exchange returned no identity token.');
      }
      const subject = await verifiedAppleSubject(tokens.id_token, configuration.clientId, fetchImpl, now());
      if (subject !== expectedSubject) throw new Error('Apple identity does not match the authenticated account.');

      const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null;
      const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : null;
      const revocationToken = refreshToken ?? accessToken;
      if (!revocationToken) throw new Error('Apple token exchange returned no revocable token.');
      return {
        subject,
        revocationToken,
        tokenTypeHint: refreshToken ? 'refresh_token' : 'access_token',
      };
    },

    revokeToken: async ({ revocationToken, tokenTypeHint }) => {
      if (!revocationToken.trim()) throw new Error('Apple revocation token is required.');
      const revoke = await fetchImpl('https://appleid.apple.com/auth/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...(await commonParameters()),
          token: revocationToken,
          token_type_hint: tokenTypeHint,
        }),
      });
      if (!revoke.ok) throw new Error('Apple token revocation failed.');
    },
  };
}
