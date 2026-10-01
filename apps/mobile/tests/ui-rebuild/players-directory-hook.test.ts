import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness } from './component-harness.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('Players directory request lifecycle', () => {
  it('drops a stale tenant response and exposes current request errors for retry', async () => {
    const harness = createHookHarness();
    const first = deferred<any>();
    const second = deferred<any>();
    const requests = [first, second];
    const hook = compileCommonJs<any>(new URL('../../src/hooks/usePlayersDirectory.ts', import.meta.url), {
      react: { ...harness.react, default: harness.react },
      '../lib/playersDirectory': { loadPublicPlayersDirectory: () => requests.shift()!.promise },
      '../lib/leaguePagesModel': {
        createLatestRequestGate: () => {
          let generation = 0;
          return {
            begin: (scope: string) => ({ scope, requestGeneration: ++generation }),
            invalidate: () => { generation += 1; },
            isCurrent: (request: any, scope: string) => request.requestGeneration === generation && request.scope === scope,
          };
        },
        commitLatestPageResult: (gate: any, request: any, scope: string, commit: () => void) => {
          if (!gate.isCurrent(request, scope)) return false;
          commit(); return true;
        },
      },
    });
    let scope = { leagueId: 'league-a', leagueSlug: 'league-a' };
    harness.mount(() => hook.usePlayersDirectory(scope));
    scope = { leagueId: 'league-b', leagueSlug: 'league-b' };
    harness.render();

    first.resolve({ league: { id: 'league-a' } });
    await flush();
    assert.equal((harness.render() as any).data, null);

    second.reject(new Error('Public roster unavailable'));
    await flush();
    const current = harness.render() as any;
    assert.equal(current.loading, false);
    assert.equal(current.data, null);
    assert.equal(current.error, 'Public roster unavailable');
    assert.equal(typeof current.retry, 'function');
  });
});
