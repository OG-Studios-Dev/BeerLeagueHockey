import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

type QueryResult = { data: unknown; error: unknown; status?: unknown };

type LookupResult = {
  status: string;
  leagues: Array<{ id: string }>;
  identityMatchesExpected: boolean | null;
  userSuffix: string | null;
  getUser: { status: string; code: string | null; httpStatus: number | null };
  membership: {
    status: string;
    code: string | null;
    httpStatus: number | null;
    rowCount: number | null;
    nonNullLeagueCount: number | null;
  };
};

function loadHelper(options: {
  getUser: () => Promise<unknown>;
  query?: () => Promise<QueryResult>;
}) {
  let queryCalls = 0;
  const query = {
    select() { return this; },
    eq() {
      queryCalls += 1;
      return options.query?.() ?? Promise.resolve({ data: [], error: null });
    },
  };
  const exports = compileCommonJs<{
    getUserLeaguesDetailed: (expectedUserId?: string | null) => Promise<LookupResult>;
    getUserLeagues: () => Promise<Array<{ id: string }>>;
  }>(new URL('../../src/lib/supabase/leagues.ts', import.meta.url), {
    './client': {
      supabase: {
        auth: { getUser: options.getUser },
        from: () => query,
      },
    },
  });

  return { exports, get queryCalls() { return queryCalls; } };
}

const row = (id: string) => ({
  league: {
    id,
    name: `League ${id}`,
    slug: `league-${id}`,
    logo_url: null,
    primary_color: null,
    secondary_color: null,
    short_name: null,
    city: null,
  },
});

describe('explicit current-user league lookup', () => {
  it('separates authentication failure and missing user without issuing a membership query', async () => {
    const authFailure = loadHelper({
      getUser: async () => ({
        data: { user: null },
        error: { code: 'session_not_found', status: 401, message: 'Bearer SYNTHETIC_PRIVATE_TOKEN' },
      }),
    });
    const failed = await authFailure.exports.getUserLeaguesDetailed('expected-user');
    assert.equal(failed.status, 'auth-error');
    assert.deepEqual(failed.getUser, { status: 'error', code: 'session_not_found', httpStatus: 401 });
    assert.equal(failed.membership.rowCount, null);
    assert.equal(authFailure.queryCalls, 0);

    const missing = loadHelper({
      getUser: async () => ({ data: { user: null }, error: null }),
    });
    const absent = await missing.exports.getUserLeaguesDetailed('expected-user');
    assert.equal(absent.status, 'missing-user');
    assert.deepEqual(absent.getUser, { status: 'missing-user', code: null, httpStatus: null });
    assert.equal(absent.membership.status, 'not-requested');
    assert.equal(missing.queryCalls, 0);

    const mismatched = loadHelper({
      getUser: async () => ({ data: { user: { id: 'validated-user-abcd' } }, error: null }),
    });
    const mismatch = await mismatched.exports.getUserLeaguesDetailed('current-user-efgh');
    assert.equal(mismatch.status, 'identity-mismatch');
    assert.equal(mismatch.identityMatchesExpected, false);
    assert.equal(mismatch.userSuffix, null);
    assert.equal(mismatch.membership.status, 'not-requested');
    assert.equal(mismatched.queryCalls, 0);
  });

  it('distinguishes successful empty, successful memberships, and inaccessible embedded rows', async () => {
    const user = { id: '00000000-0000-0000-0000-00000000abcd', email: 'private@example.invalid' };

    const empty = loadHelper({
      getUser: async () => ({ data: { user }, error: null }),
      query: async () => ({ data: [], error: null, status: 200 }),
    });
    const emptyResult = await empty.exports.getUserLeaguesDetailed(user.id);
    assert.equal(emptyResult.status, 'success');
    assert.equal(emptyResult.identityMatchesExpected, true);
    assert.equal(emptyResult.userSuffix, '••••abcd');
    assert.deepEqual(emptyResult.membership, {
      status: 'success', code: null, httpStatus: 200, rowCount: 0, nonNullLeagueCount: 0,
    });

    const member = loadHelper({
      getUser: async () => ({ data: { user }, error: null }),
      query: async () => ({ data: [row('member')], error: null, status: 200 }),
    });
    const memberResult = await member.exports.getUserLeaguesDetailed(user.id);
    assert.equal(memberResult.status, 'success');
    assert.deepEqual(memberResult.leagues.map(({ id }) => id), ['member']);
    assert.equal(memberResult.membership.rowCount, 1);
    assert.equal(memberResult.membership.nonNullLeagueCount, 1);
    assert.equal(memberResult.membership.httpStatus, 200);

    const inaccessible = loadHelper({
      getUser: async () => ({ data: { user }, error: null }),
      query: async () => ({ data: [row('visible'), { league: null }], error: null, status: 206 }),
    });
    const partial = await inaccessible.exports.getUserLeaguesDetailed(user.id);
    assert.equal(partial.status, 'incomplete');
    assert.deepEqual(partial.leagues.map(({ id }) => id), ['visible']);
    assert.equal(partial.membership.status, 'incomplete');
    assert.equal(partial.membership.rowCount, 2);
    assert.equal(partial.membership.nonNullLeagueCount, 1);
    assert.equal(partial.membership.httpStatus, 206);
  });

  it('settles returned and thrown query/auth failures with allowlisted facts only', async () => {
    const secretMarker = 'Bearer_SYNTHETIC_PRIVATE_TOKEN_DO_NOT_RENDER';
    const originalLog = console.log;
    const originalError = console.error;
    const consoleOutput: unknown[] = [];
    console.log = (...values: unknown[]) => { consoleOutput.push(values); };
    console.error = (...values: unknown[]) => { consoleOutput.push(values); };

    try {
      const returnedFailure = loadHelper({
        getUser: async () => ({
          data: { user: { id: 'user-abcd', email: `${secretMarker}@example.invalid` } },
          error: null,
        }),
        query: async () => ({
          data: [{ raw: secretMarker }],
          error: { code: 'PGRST301', message: secretMarker, details: secretMarker },
          status: 403,
        }),
      });
      const returned = await returnedFailure.exports.getUserLeaguesDetailed('user-abcd');
      assert.equal(returned.status, 'query-error');
      assert.deepEqual(returned.membership, {
        status: 'error', code: 'PGRST301', httpStatus: 403, rowCount: null, nonNullLeagueCount: null,
      });

      const missingResponse = loadHelper({
        getUser: async () => ({ data: { user: { id: 'user-abcd' } }, error: null }),
        query: async () => ({ data: null, error: null }),
      });
      const unknown = await missingResponse.exports.getUserLeaguesDetailed('user-abcd');
      assert.equal(unknown.status, 'query-error');
      assert.equal(unknown.membership.rowCount, null);
      assert.equal(unknown.membership.nonNullLeagueCount, null);

      const invalidReturnedStatus = loadHelper({
        getUser: async () => ({ data: { user: { id: 'user-abcd' } }, error: null }),
        query: async () => ({ data: [], error: null, status: 99 }),
      });
      const invalidStatus = await invalidReturnedStatus.exports.getUserLeaguesDetailed('user-abcd');
      assert.equal(invalidStatus.status, 'success');
      assert.equal(invalidStatus.membership.httpStatus, null);

      const thrownQuery = loadHelper({
        getUser: async () => ({ data: { user: { id: 'user-abcd' } }, error: null }),
        query: async () => { throw { code: secretMarker, status: 502, message: secretMarker }; },
      });
      const thrown = await thrownQuery.exports.getUserLeaguesDetailed('user-abcd');
      assert.equal(thrown.status, 'query-error');
      assert.equal(thrown.membership.code, null);
      assert.equal(thrown.membership.httpStatus, 502);

      const thrownAuth = loadHelper({
        getUser: async () => { throw { code: secretMarker, status: 401, message: secretMarker }; },
      });
      const rejected = await thrownAuth.exports.getUserLeaguesDetailed('user-abcd');
      assert.equal(rejected.status, 'auth-error');
      assert.equal(rejected.getUser.code, null);
      assert.equal(rejected.getUser.httpStatus, 401);

      const serialized = JSON.stringify([returned, thrown, rejected, consoleOutput]);
      assert.equal(serialized.includes(secretMarker), false);
      assert.equal(serialized.includes('example.invalid'), false);
      assert.equal(serialized.includes('user-abcd'), false);
      assert.deepEqual(consoleOutput, []);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  it('keeps the compatibility helper returning leagues for unrelated callers', async () => {
    const helper = loadHelper({
      getUser: async () => ({ data: { user: { id: 'user-abcd' } }, error: null }),
      query: async () => ({ data: [row('member')], error: null }),
    });
    assert.deepEqual((await helper.exports.getUserLeagues()).map(({ id }) => id), ['member']);
  });
});
