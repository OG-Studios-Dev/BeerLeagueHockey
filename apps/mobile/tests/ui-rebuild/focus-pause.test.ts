import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFocusPauseStore } from '../../src/context/FocusPauseContext.tsx';
import { createDockModalLifecycle } from '../../src/navigation/dockModalLifecycle.ts';

describe('navigation-owned focus pause leases', () => {
  it('keeps focus paused through close animation and ignores stale cleanup after reopen', () => {
    const store = createFocusPauseStore();
    let release: (() => void) | undefined;
    const completions: Array<(finished: boolean) => void> = [];
    const lifecycle = createDockModalLifecycle(
      (_open, complete) => completions.push(complete),
      ({ mounted }) => {
        if (mounted && !release) release = store.acquire();
        if (!mounted && release) {
          const current = release;
          release = undefined;
          current();
        }
      },
    );

    lifecycle.open();
    assert.equal(store.isPaused(), true);
    completions.shift()?.(true);
    lifecycle.close();
    assert.equal(store.isPaused(), true, 'closing sheet remains mounted and holds the pause');
    const staleClose = completions.shift()!;
    lifecycle.open();
    staleClose(true);
    assert.equal(store.isPaused(), true, 'stale close completion cannot release the reopened sheet');

    lifecycle.reset();
    assert.equal(store.isPaused(), false, 'route/identity reset releases the mounted overlay');
  });

  it('uses independent idempotent leases so an old cleanup cannot unpause a new overlay', () => {
    const store = createFocusPauseStore();
    const oldRelease = store.acquire();
    oldRelease();
    const newRelease = store.acquire();
    oldRelease();
    assert.equal(store.isPaused(), true);
    newRelease();
    newRelease();
    assert.equal(store.isPaused(), false);
  });
});
