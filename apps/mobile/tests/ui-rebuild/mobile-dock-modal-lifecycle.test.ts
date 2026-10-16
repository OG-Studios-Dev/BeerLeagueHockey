import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDockModalLifecycle, createModalScopeLifecycle } from '../../src/navigation/dockModalLifecycle.ts';

describe('More modal lifecycle', () => {
  it('keeps the modal mounted until close animation completion, then navigates once', () => {
    const completions: Array<(finished: boolean) => void> = [];
    const publishes: Array<{ mounted: boolean; open: boolean }> = [];
    let navigations = 0;
    const lifecycle = createDockModalLifecycle((_open, complete) => completions.push(complete), (state) => publishes.push(state));

    lifecycle.open();
    completions.shift()?.(true);
    lifecycle.close(() => { navigations += 1; });
    assert.deepEqual(lifecycle.snapshot(), { mounted: true, open: false });
    assert.equal(navigations, 0);
    completions.shift()?.(true);
    assert.deepEqual(lifecycle.snapshot(), { mounted: false, open: false });
    assert.equal(navigations, 1);
    assert.ok(publishes.some((state) => state.mounted && !state.open));
  });

  it('ignores an interrupted close after reopen and never runs its stale navigation', () => {
    const completions: Array<(finished: boolean) => void> = [];
    let navigations = 0;
    const lifecycle = createDockModalLifecycle((_open, complete) => completions.push(complete), () => {});

    lifecycle.open();
    completions.shift()?.(true);
    lifecycle.close(() => { navigations += 1; });
    const staleClose = completions.shift()!;
    lifecycle.open();
    staleClose(true);

    assert.deepEqual(lifecycle.snapshot(), { mounted: true, open: true });
    assert.equal(navigations, 0);
  });

  it('resets immediately on auth or league identity changes', () => {
    const completions: Array<(finished: boolean) => void> = [];
    let navigations = 0;
    const lifecycle = createDockModalLifecycle((_open, complete) => completions.push(complete), () => {});
    lifecycle.open();
    lifecycle.close(() => { navigations += 1; });
    const staleClose = completions.at(-1)!;

    lifecycle.reset();
    staleClose(true);

    assert.deepEqual(lifecycle.snapshot(), { mounted: false, open: false });
    assert.equal(navigations, 0);
  });

  it('disposes pending work without publishing state during cleanup', () => {
    const completions: Array<(finished: boolean) => void> = [];
    const publishes: Array<{ mounted: boolean; open: boolean }> = [];
    let navigations = 0;
    const lifecycle = createDockModalLifecycle((_open, complete) => completions.push(complete), (state) => publishes.push(state));
    lifecycle.open();
    completions.shift()?.(true);
    lifecycle.close(() => { navigations += 1; });
    const staleClose = completions.shift()!;
    const publishCount = publishes.length;

    lifecycle.dispose();
    staleClose(true);
    lifecycle.open();

    assert.deepEqual(lifecycle.snapshot(), { mounted: false, open: false });
    assert.equal(navigations, 0);
    assert.equal(publishes.length, publishCount);
  });

  it('keeps only the current action through rapid reopen and close', () => {
    const completions: Array<(finished: boolean) => void> = [];
    const actions: string[] = [];
    const lifecycle = createDockModalLifecycle((_open, complete) => completions.push(complete), () => {});
    lifecycle.open();
    completions.shift()?.(true);
    lifecycle.close(() => actions.push('stale'));
    const staleClose = completions.shift()!;
    lifecycle.open();
    completions.shift()?.(true);
    lifecycle.close(() => actions.push('current'));
    const currentClose = completions.shift()!;

    staleClose(true);
    currentClose(true);
    assert.deepEqual(actions, ['current']);
  });
});

describe('route-owned modal scope lifecycle', () => {
  it('uses monotonic owner tokens so stale A and B work cannot revive after A-to-B-to-A', () => {
    const lifecycle = createModalScopeLifecycle();
    const firstA = lifecycle.activate('team-a:season-1');
    const b = lifecycle.activate('team-b:season-1');
    const secondA = lifecycle.activate('team-a:season-1');

    assert.equal(lifecycle.isCurrent(firstA), false);
    assert.equal(lifecycle.isCurrent(b), false);
    assert.equal(lifecycle.isCurrent(secondA), true);
    lifecycle.reset(b);
    assert.equal(lifecycle.isCurrent(secondA), true, 'stale cleanup cannot reset the current owner');
    lifecycle.reset(secondA);
    assert.equal(lifecycle.isCurrent(secondA), false);
  });
});
