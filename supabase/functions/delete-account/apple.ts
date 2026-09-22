export type AppleServerConfiguration = {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKeyP8: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodedJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
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

export function createAppleAuthorizationRevoker(
  configuration: AppleServerConfiguration,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): (authorizationCode: string) => Promise<void> {
  return async (authorizationCode: string) => {
    if (!authorizationCode.trim()) throw new Error('Apple authorization code is required.');
    const secret = await clientSecret(configuration, now());
    const common = {
      client_id: configuration.clientId,
      client_secret: secret,
    };
    const exchangeBody = new URLSearchParams({
      ...common,
      grant_type: 'authorization_code',
      code: authorizationCode,
    });
    const exchange = await fetchImpl('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: exchangeBody,
    });
    if (!exchange.ok) throw new Error('Apple authorization-code exchange failed.');

    const tokens = await exchange.json() as { refresh_token?: unknown; access_token?: unknown };
    const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null;
    const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : null;
    const revocationToken = refreshToken ?? accessToken;
    if (!revocationToken) throw new Error('Apple token exchange returned no revocable token.');

    const revoke = await fetchImpl('https://appleid.apple.com/auth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...common,
        token: revocationToken,
        token_type_hint: refreshToken ? 'refresh_token' : 'access_token',
      }),
    });
    if (!revoke.ok) throw new Error('Apple token revocation failed.');
  };
}
