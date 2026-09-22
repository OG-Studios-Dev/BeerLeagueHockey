import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { describe, it } from 'node:test';

import { createAppleAuthorizationService } from '../apple.ts';

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

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

async function appleIdentity(subject: string, clientId = 'ca.beerleaguehockey.app') {
  const keys = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const header = base64Url(JSON.stringify({ alg: 'RS256', kid: 'apple-test-key' }));
  const payload = base64Url(JSON.stringify({
    iss: 'https://appleid.apple.com',
    aud: clientId,
    exp: 2_000_000_000,
    sub: subject,
  }));
  const signature = await webcrypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keys.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
  return {
    token: `${header}.${payload}.${base64Url(new Uint8Array(signature))}`,
    jwk: { ...jwk, kid: 'apple-test-key', alg: 'RS256' },
  };
}

describe('Apple authorization service', () => {
  it('verifies the provider-signed subject before returning a server-only revocation grant', async () => {
    const identity = await appleIdentity('apple-subject-1');
    const requests: Array<{ url: string; body: URLSearchParams }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: new URLSearchParams(String(init?.body ?? '')) });
      if (url.endsWith('/auth/token')) {
        return Response.json({
          refresh_token: 'server-refresh-token',
          id_token: identity.token,
        });
      }
      if (url.endsWith('/auth/keys')) return Response.json({ keys: [identity.jwk] });
      return new Response(null, { status: 200 });
    };
    const service = createAppleAuthorizationService({
      teamId: 'TEAMID',
      keyId: 'KEYID',
      clientId: 'ca.beerleaguehockey.app',
      privateKeyP8: await privateKeyPem(),
    }, fetchImpl, () => new Date('2026-09-22T12:00:00Z'));

    const grant = await service.exchangeAuthorizationCode('one-time-code', 'apple-subject-1');
    assert.deepEqual(grant, {
      subject: 'apple-subject-1',
      revocationToken: 'server-refresh-token',
      tokenTypeHint: 'refresh_token',
    });
    await service.revokeToken(grant);

    assert.equal(requests[0]?.url, 'https://appleid.apple.com/auth/token');
    assert.equal(requests[0]?.body.get('code'), 'one-time-code');
    assert.equal(requests[1]?.url, 'https://appleid.apple.com/auth/keys');
    assert.equal(requests[2]?.url, 'https://appleid.apple.com/auth/revoke');
    assert.equal(requests[2]?.body.get('token'), 'server-refresh-token');
    assert.equal(requests[2]?.body.get('token_type_hint'), 'refresh_token');
  });

  it('never accepts a valid Apple code for another Apple identity', async () => {
    const identity = await appleIdentity('attacker-apple-subject');
    const service = createAppleAuthorizationService({
      teamId: 'TEAMID', keyId: 'KEYID', clientId: 'ca.beerleaguehockey.app',
      privateKeyP8: await privateKeyPem(),
    }, async (input) => String(input).endsWith('/auth/token')
      ? Response.json({ refresh_token: 'secret', id_token: identity.token })
      : Response.json({ keys: [identity.jwk] }));

    await assert.rejects(
      service.exchangeAuthorizationCode('valid-other-code', 'authenticated-apple-subject'),
      /^Error: Apple identity does not match the authenticated account\.$/,
    );
  });

  it('sanitizes exchange, verification, and revocation failures', async () => {
    const configuration = {
      teamId: 'TEAMID', keyId: 'KEYID', clientId: 'ca.beerleaguehockey.app',
      privateKeyP8: await privateKeyPem(),
    };
    const exchangeFailure = createAppleAuthorizationService(configuration, async () =>
      new Response('provider-secret-payload', { status: 400 }));
    await assert.rejects(
      exchangeFailure.exchangeAuthorizationCode('bad-code', 'subject'),
      /^Error: Apple authorization-code exchange failed\.$/,
    );

    const identity = await appleIdentity('subject');
    const revocationFailure = createAppleAuthorizationService(configuration, async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/token')) {
        return Response.json({ access_token: 'access-token', id_token: identity.token });
      }
      if (url.endsWith('/auth/keys')) return Response.json({ keys: [identity.jwk] });
      return new Response('provider-secret-payload', { status: 500 });
    });
    const grant = await revocationFailure.exchangeAuthorizationCode('fresh-code', 'subject');
    await assert.rejects(
      revocationFailure.revokeToken(grant),
      /^Error: Apple token revocation failed\.$/,
    );
  });
});
