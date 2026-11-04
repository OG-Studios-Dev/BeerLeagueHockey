import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const loadDependency = createRequire(import.meta.url);
const ts = loadDependency('typescript');
const React = loadDependency('react');
const { renderToStaticMarkup } = loadDependency('react-dom/server');
const { NextRequest, NextResponse } = loadDependency('next/server');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(relative, overrides = {}) {
  const filename = path.join(root, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
    reportDiagnostics: true,
  });
  assert.deepEqual(output.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const result = { exports: {} };
  vm.runInNewContext(output.outputText, {
    module: result, exports: result.exports, process, URL,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : loadDependency(name),
  }, { filename });
  return result.exports;
}
const navigation = { Link: ({ children, ...props }) => React.createElement('a', props, children) };
function render(relative) {
  const page = load(relative, {
    'next-intl': { useTranslations: () => key => key },
    '@/i18n/navigation': navigation,
    'lucide-react': { ArrowLeft: () => null },
  }).default;
  return renderToStaticMarkup(React.createElement(page));
}
test('mobile policy and support routes are public without contacting account services', async () => {
  let lookups = 0;
  const { middleware } = load('src/middleware.ts', {
    '@supabase/ssr': { createServerClient: () => { lookups++; throw Error('Public route attempted authentication'); } },
    'next-intl/middleware': { __esModule: true, default: () => () => NextResponse.next() },
    './i18n/config': { locales: ['en', 'fr'], defaultLocale: 'en' },
  });
  for (const locale of ['', '/en', '/fr']) {
    for (const route of ['/privacy', '/terms', '/mobile-support']) {
      const response = await middleware(new NextRequest(`https://example.test${locale}${route}`));
      assert.equal(response.headers.get('location'), null);
    }
  }
  assert.equal(lookups, 0);
});
test('protected dashboard remains behind authentication', async () => {
  const { middleware } = load('src/middleware.ts', {
    '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
    'next-intl/middleware': { __esModule: true, default: () => () => NextResponse.next() },
    './i18n/config': { locales: ['en', 'fr'], defaultLocale: 'en' },
  });
  assert.match((await middleware(new NextRequest('https://example.test/en/dashboard'))).headers.get('location'), /\/en\/login/);
});
test('legacy privacy URL stays public and localized', async () => {
  const { middleware } = load('src/middleware.ts', {
    '@supabase/ssr': { createServerClient: () => { throw Error('unexpected authentication'); } },
    'next-intl/middleware': { __esModule: true, default: () => () => NextResponse.next() },
    './i18n/config': { locales: ['en', 'fr'], defaultLocale: 'en' },
  });
  for (const locale of ['en', 'fr']) assert.equal((await middleware(new NextRequest(`https://example.test/${locale}/privacy-policy`))).headers.get('location'), `https://example.test/${locale}/privacy`);
});
  test('privacy renders mobile data disclosures while preserving platform sections', () => {
    const html = render('src/app/[locale]/privacy/page.tsx');
    for (const text of ['Hockey Life mobile addendum', 'Expo push token', 'linked to your account', 'not anonymous', 'idempotency', 'support@beerleaguehockey.ca', 'Information We Collect', 'Data Sharing and Third Parties', 'Data Protection Officer', 'retained for 14 days']) assert.ok(html.includes(text), text);
  });
  test('terms distinguish real-world spare fees from native card charges and preserve platform terms', () => {
    const html = render('src/app/[locale]/terms/page.tsx');
    for (const text of ['Hockey Life mobile addendum', 'manual spare-fee ledger', 'real-world hockey', 'does not charge a payment card', 'Pricing and Payment', '3.5%', 'Stripe Connect', 'Limitation of Liability']) assert.ok(html.includes(text), text);
  });
  test('support renders actionable public technical help without requesting secrets', () => {
    const html = render('src/app/[locale]/mobile-support/page.tsx');
    for (const text of ['Hockey Life mobile support', 'mailto:support@beerleaguehockey.ca', 'app version', 'device', 'steps', 'Do not send', 'passwords', 'card', '/privacy', '/terms']) assert.ok(html.includes(text), text);
  });

test('privacy explains operational content audiences, safety processing and available account choices', () => {
  const html = render('src/app/[locale]/privacy/page.tsx');
  for (const text of ['Operational user content', 'currently authorized captains and alternate captains', 'not a public feed', 'Optional spare-request messages are stored', 'does not currently display a recipient inbox or deliver these messages by email or push', 'Manually entered spare-player names', 'public accepted-substitution listings', 'report content', 'account and content identifiers', 'Where reporting or blocking features are available', 'blocked-user preferences', 'public name and photo editing are currently disabled', 'Account section', 'support@beerleaguehockey.ca']) assert.ok(html.includes(text), text);
});

test('support offers practical abuse reporting through the existing email channel', () => {
  const html = render('src/app/[locale]/mobile-support/page.tsx');
  for (const text of ['Report abuse or objectionable content', 'mailto:support@beerleaguehockey.ca', 'Report abuse', 'where you saw the content', 'game date', 'why you are reporting it', 'Do not forward private team commentary', 'Do not send', 'passwords']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<form\b|within 24|within 48|guaranteed response|moderator@/i);
});
