import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { describe, it } from 'node:test';

import { createAppleAuthorizationRevoker } from '../apple.ts';

async function privateKeyPem(): Promise<string> {
  const keys = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  const base64 = Buffer.from(pkcs8).toString('base64').match(/.{1,64}/g)?.join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
}

describe('Apple authorization revocation client', () => {
  it('exchanges the one-time code and revokes the returned refresh token', async () => {
    const requests: Array<{ url: string; body: URLSearchParams }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = new URLSearchParams(String(init?.body));
      requests.push({ url, body });
      if (url.endsWith('/auth/token')) {
        return new Response(JSON.stringify({ refresh_token: 'server-refresh-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 200 });
    };
    const revoke = createAppleAuthorizationRevoker({
      teamId: 'TEAMID',
      keyId: 'KEYID',
      clientId: 'ca.beerleaguehockey.app',
      privateKeyP8: await privateKeyPem(),
    }, fetchImpl);

    await revoke('one-time-code');

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, 'https://appleid.apple.com/auth/token');
    assert.equal(requests[0]?.body.get('grant_type'), 'authorization_code');
    assert.equal(requests[0]?.body.get('code'), 'one-time-code');
    assert.equal(requests[0]?.body.get('client_id'), 'ca.beerleaguehockey.app');
    assert.match(requests[0]?.body.get('client_secret') ?? '', /^[^.]+\.[^.]+\.[^.]+$/);
    assert.equal(requests[1]?.url, 'https://appleid.apple.com/auth/revoke');
    assert.equal(requests[1]?.body.get('token'), 'server-refresh-token');
    assert.equal(requests[1]?.body.get('token_type_hint'), 'refresh_token');
  });

  it('fails closed for exchange and revocation errors without exposing provider payloads', async () => {
    const configuration = {
      teamId: 'TEAMID',
      keyId: 'KEYID',
      clientId: 'ca.beerleaguehockey.app',
      privateKeyP8: await privateKeyPem(),
    };
    const exchangeFailure = createAppleAuthorizationRevoker(configuration, async () =>
      new Response('provider-secret-payload', { status: 400 }));
    await assert.rejects(exchangeFailure('bad-code'), /^Error: Apple authorization-code exchange failed\.$/);

    let call = 0;
    const revokeFailure = createAppleAuthorizationRevoker(configuration, async () => {
      call += 1;
      return call === 1
        ? new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 })
        : new Response('provider-secret-payload', { status: 500 });
    });
    await assert.rejects(revokeFailure('fresh-code'), /^Error: Apple token revocation failed\.$/);
  });
});
