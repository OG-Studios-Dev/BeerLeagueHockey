import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { classifyOAuthFailure } from './oauth-errors';
import { buildOAuthCallbackUrl } from './oauth-redirect';

const expected = {
  en: {
    oauthConsentCanceled: "Sign-in was canceled. You can try again when you're ready.",
    oauthIdentityConflict: 'That sign-in method could not be connected to this account. Sign in with your existing method, then manage connected accounts in settings.',
    oauthFailed: "We couldn't complete sign-in. Please try again.",
  },
  fr: {
    oauthConsentCanceled: 'La connexion a ete annulee. Vous pouvez reessayer lorsque vous etes pret.',
    oauthIdentityConflict: "Cette methode de connexion n'a pas pu etre associee a ce compte. Connectez-vous avec votre methode habituelle, puis gerez les comptes connectes dans les parametres.",
    oauthFailed: "Nous n'avons pas pu terminer la connexion. Veuillez reessayer.",
  },
} as const;

describe('OAuth recovery translations', () => {
  it.each(['en', 'fr'] as const)(
    'renders every recovery message from the actual auth namespace in %s',
    (locale) => {
      const script = `
        import fs from 'node:fs';
        import React from 'react';
        import {renderToStaticMarkup} from 'react-dom/server';
        import {createTranslator} from 'next-intl';
        const messages = JSON.parse(fs.readFileSync('src/messages/${locale}.json', 'utf8'));
        const t = createTranslator({locale: '${locale}', messages, namespace: 'auth'});
        const values = {
          oauthConsentCanceled: t('oauthConsentCanceled'),
          oauthIdentityConflict: t('oauthIdentityConflict'),
          oauthFailed: t('oauthFailed')
        };
        const html = renderToStaticMarkup(React.createElement('div', null,
          React.createElement('p', null, values.oauthConsentCanceled),
          React.createElement('p', null, values.oauthIdentityConflict),
          React.createElement('p', null, values.oauthFailed)
        ));
        process.stdout.write(JSON.stringify({values, html}));
      `;
      const rendered = JSON.parse(execFileSync(
        process.execPath,
        ['--input-type=module', '--eval', script],
        { cwd: resolve(__dirname, '../../..'), encoding: 'utf8' }
      ));

      expect(rendered.values).toEqual(expected[locale]);
      expect(rendered.html).toContain('<div><p>');
      expect(rendered.html).not.toContain('auth.oauth');
    }
  );
});

describe('buildOAuthCallbackUrl', () => {
  it('carries explicit French locale and a localized default from direct auth pages', () => {
    const callback = buildOAuthCallbackUrl('https://app.example.test', 'fr');

    expect(callback.origin).toBe('https://app.example.test');
    expect(callback.pathname).toBe('/api/auth/callback');
    expect(callback.searchParams.get('locale')).toBe('fr');
    expect(callback.searchParams.get('next')).toBe('/fr/dashboard');
  });

  it('preserves a safe nested continuation and rejects an unsafe one', () => {
    const safe = buildOAuthCallbackUrl(
      'https://app.example.test',
      'fr',
      '/fr/dashboard?tab=billing&panel=invoices'
    );
    const unsafe = buildOAuthCallbackUrl(
      'https://app.example.test',
      'fr',
      '/\t/evil.example.test'
    );

    expect(safe.searchParams.get('next')).toBe(
      '/fr/dashboard?tab=billing&panel=invoices'
    );
    expect(unsafe.searchParams.get('next')).toBe('/fr/dashboard');
  });
});

describe('classifyOAuthFailure', () => {
  const classify = classifyOAuthFailure as unknown as (
    error: string | null,
    errorCode: string | null,
    description: string | null
  ) => string;

  it.each([
    ['access_denied', null, null, 'consent_canceled'],
    ['server_error', 'identity_already_exists', 'canceled', 'identity_conflict'],
    ['server_error', 'email_exists', 'denied', 'identity_conflict'],
    ['server_error', 'flow_state_expired', 'identity already linked', 'oauth_failed'],
    ['server_error', 'invalid_grant', 'identity already linked', 'oauth_failed'],
    ['server_error', 'unknown_provider_code', 'identity already linked', 'oauth_failed'],
    ['server_error', '__proto__', 'identity already linked', 'oauth_failed'],
  ])('maps error=%p code=%p consistently', (error, code, description, recoveryCode) => {
    expect(classify(error, code, description)).toBe(recoveryCode);
  });
});
