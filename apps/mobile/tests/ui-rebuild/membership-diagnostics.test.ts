import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, nodeText } from './component-harness.ts';

const secretMarker = 'Bearer_SYNTHETIC_PRIVATE_MARKER';

const diagnostics = {
  backendOrigin: 'https://project.example.invalid',
  appVersion: '1.0.0',
  appBuild: '14',
  entries: [{
    requestId: 7,
    generation: 3,
    trigger: 'manual-retry',
    phase: 'completed',
    outcome: 'query-error',
    sessionPresent: true,
    startedAt: '2026-09-10T12:00:00.000Z',
    finishedAt: '2026-09-10T12:00:00.125Z',
    durationMs: 125,
    userSuffix: '••••abcd',
    getUserStatus: 'ok',
    getUserCode: null,
    getUserHttpStatus: null,
    membershipResponseStatus: 'error',
    membershipErrorCode: 'PGRST301',
    membershipHttpStatus: 503,
    rowCount: null,
    nonNullLeagueCount: null,
    commit: 'retained',
    availableLeagueCount: 1,
  }],
};

describe('privacy-safe membership diagnostics projection', () => {
  it('keeps only backend origin and runtime app metadata', () => {
    const exports = compileCommonJs<{
      safeBackendOrigin: (value: unknown) => string | null;
    }>(new URL('../../src/lib/membershipDiagnostics.ts', import.meta.url), {
      'expo-constants': { default: { expoConfig: { version: '1.2.3', ios: { buildNumber: '15' } } } },
    });

    assert.equal(
      exports.safeBackendOrigin(`https://user:${secretMarker}@project.example.invalid/private/path?token=${secretMarker}#${secretMarker}`),
      'https://project.example.invalid',
    );
    assert.equal(exports.safeBackendOrigin(`javascript:${secretMarker}`), null);
  });

  it('formats an explicit allowlist and rejects secret-shaped injected fields', () => {
    const exports = compileCommonJs<{
      formatMembershipDiagnostics: (value: unknown, status: string) => string;
    }>(new URL('../../src/lib/membershipDiagnostics.ts', import.meta.url), {
      'expo-constants': { default: { expoConfig: null } },
    });
    const hostile = {
      ...diagnostics,
      appVersion: secretMarker,
      appBuild: secretMarker,
      entries: [{
        ...diagnostics.entries[0],
        userSuffix: secretMarker,
        getUserCode: secretMarker,
        membershipErrorCode: secretMarker,
        rawError: { message: secretMarker, stack: secretMarker },
        session: { access_token: secretMarker, user: { email: secretMarker } },
      }],
      raw: secretMarker,
    };

    const rendered = exports.formatMembershipDiagnostics(hostile, 'error');
    assert.equal(rendered.includes(secretMarker), false);
    assert.match(rendered, /App: unknown \(build unknown\)/);
    assert.match(rendered, /Backend: https:\/\/project\.example\.invalid/);
    assert.match(rendered, /Request: #7 · generation 3 · manual-retry · completed/);
    assert.match(rendered, /Rows: unknown · accessible leagues: unknown/);
    assert.match(rendered, /Available leagues: 1/);
    assert.equal(rendered.includes('rawError'), false);
    assert.equal(rendered.includes('access_token'), false);
  });

  it('preserves every explicitly supported auth code from helper through formatter', async () => {
    type HelperExports = {
      getUserLeaguesDetailed: (expectedUserId: string) => Promise<{
        status: string;
        getUser: { status: string; code: string | null; httpStatus: number | null };
      }>;
    };
    const formatter = compileCommonJs<{
      formatMembershipDiagnostics: (value: unknown, status: string) => string;
    }>(new URL('../../src/lib/membershipDiagnostics.ts', import.meta.url), {
      'expo-constants': { default: { expoConfig: null } },
    });
    const supportedCodes = [
      'bad_jwt',
      'request_timeout',
      'refresh_token_already_used',
      'refresh_token_not_found',
      'session_expired',
      'session_not_found',
      'unexpected_audience',
      'unexpected_failure',
      'user_banned',
      'user_not_found',
    ];

    for (const code of supportedCodes) {
      const isolatedHelper = compileCommonJs<HelperExports>(
        new URL('../../src/lib/supabase/leagues.ts', import.meta.url),
        {
          './client': {
            supabase: {
              auth: { getUser: async () => ({ data: { user: null }, error: { code, message: secretMarker } }) },
              from: () => { throw new Error('membership query must not run'); },
            },
          },
        },
      );
      const result = await isolatedHelper.getUserLeaguesDetailed('expected-user');
      assert.equal(result.status, 'auth-error');
      assert.equal(result.getUser.code, code);

      const rendered = formatter.formatMembershipDiagnostics({
        ...diagnostics,
        entries: [{
          ...diagnostics.entries[0],
          outcome: 'auth-error',
          getUserStatus: 'error',
          getUserCode: result.getUser.code,
          membershipResponseStatus: 'not-requested',
          membershipErrorCode: null,
        }],
      }, 'error');
      assert.equal(rendered.includes(`code ${code}`), true);
      assert.equal(rendered.includes(secretMarker), false);
    }
  });

  it('renders selectable text and an accessible bounded retry control', () => {
    const sourceUrl = new URL('../../src/components/MembershipDiagnosticsCard.tsx', import.meta.url);
    const exports = compileCommonJs<{ default: (props: object) => unknown }>(sourceUrl, {
      react: {
        createElement,
        useMemo: (factory: () => unknown) => factory(),
        useState: () => [true, () => undefined],
      },
      'react-native': {
        ActivityIndicator: 'ActivityIndicator',
        Pressable: 'Pressable',
        ScrollView: 'ScrollView',
        StyleSheet: { create: (styles: unknown) => styles },
        Text: 'Text',
        View: 'View',
      },
      '../lib/membershipDiagnostics': {
        formatMembershipDiagnostics: () => 'safe diagnostic text',
      },
      '../theme/colors': { default: {
        textPrimary: '#fff', textSecondary: '#aaa', primary: '#0ff', bgSurface: '#111',
        bgInteractive: '#222', borderCard: '#333', accentRed: '#f00',
      } },
    });
    const tree = exports.default({
      diagnostics,
      status: 'error',
      onRetry: () => undefined,
      initiallyExpanded: true,
    });

    const diagnosticText = findNode(tree, (node) => nodeText(node) === 'safe diagnostic text');
    assert.equal(diagnosticText?.props.selectable, true);
    const retry = findNode(tree, (node) => node.props.accessibilityLabel === 'Retry league membership lookup');
    assert.ok(retry);
    assert.equal(retry.props.accessibilityRole, 'button');
    assert.equal(retry.props.disabled, false);
  });
});
