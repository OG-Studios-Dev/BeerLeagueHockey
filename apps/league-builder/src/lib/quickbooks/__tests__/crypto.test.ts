import {
  createQuickBooksStateToken,
  decryptQuickBooksSecret,
  encryptQuickBooksSecret,
  verifyQuickBooksStateToken,
} from '../crypto';

describe('quickbooks crypto helpers', () => {
  const originalSecret = process.env.QUICKBOOKS_INTEGRATION_SECRET;
  const originalEncryptionKey = process.env.QUICKBOOKS_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.QUICKBOOKS_INTEGRATION_SECRET = 'test-quickbooks-secret';
    delete process.env.QUICKBOOKS_ENCRYPTION_KEY;
  });

  afterAll(() => {
    if (typeof originalSecret === 'string') {
      process.env.QUICKBOOKS_INTEGRATION_SECRET = originalSecret;
    } else {
      delete process.env.QUICKBOOKS_INTEGRATION_SECRET;
    }

    if (typeof originalEncryptionKey === 'string') {
      process.env.QUICKBOOKS_ENCRYPTION_KEY = originalEncryptionKey;
    } else {
      delete process.env.QUICKBOOKS_ENCRYPTION_KEY;
    }
  });

  it('round-trips encrypted QuickBooks secrets', () => {
    const encrypted = encryptQuickBooksSecret('refresh-token-value');

    expect(encrypted).not.toBe('refresh-token-value');
    expect(decryptQuickBooksSecret(encrypted)).toBe('refresh-token-value');
  });

  it('creates and verifies signed QuickBooks OAuth state', () => {
    const token = createQuickBooksStateToken({
      leagueId: 'league-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      returnTo: '/en/dashboard/leagues/league-1/finance',
    });

    expect(verifyQuickBooksStateToken(token)).toEqual(
      expect.objectContaining({
        leagueId: 'league-1',
        userId: 'user-1',
        nonce: 'nonce-1',
        returnTo: '/en/dashboard/leagues/league-1/finance',
      })
    );
  });

  it('rejects tampered QuickBooks OAuth state', () => {
    const token = createQuickBooksStateToken({
      leagueId: 'league-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      returnTo: '/en/dashboard/leagues/league-1/finance',
    });

    const [payload, signature] = token.split('.');
    const tamperedSignature = Buffer.from(signature, 'base64url');
    tamperedSignature[0] ^= 1;
    expect(tamperedSignature).not.toEqual(Buffer.from(signature, 'base64url'));
    const tamperedToken = `${payload}.${tamperedSignature.toString('base64url')}`;
    expect(verifyQuickBooksStateToken(tamperedToken)).toBeNull();
  });
});
