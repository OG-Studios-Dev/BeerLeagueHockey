import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chooseFocusCandidate,
  createFocusScheduler,
  type FocusCandidateLayout,
} from '../../src/components/cardFocusMath.ts';

const candidates: FocusCandidateLayout[] = [
  { id: 'first', top: 0, height: 180 },
  { id: 'second', top: 204, height: 180 },
  { id: 'tall', top: 408, height: 620 },
  { id: 'last', top: 1052, height: 180 },
];

describe('scroll-linked card focus math', () => {
  it('selects the visible card nearest the center-ish focal line in both scroll directions', () => {
    assert.equal(chooseFocusCandidate(candidates, { offset: 0, height: 420 }, null), 'first');
    assert.equal(chooseFocusCandidate(candidates, { offset: 180, height: 420 }, 'first'), 'second');
    assert.equal(chooseFocusCandidate(candidates, { offset: 780, height: 420 }, 'tall'), 'tall');
    assert.equal(chooseFocusCandidate(candidates, { offset: 950, height: 420 }, 'tall'), 'last');
    assert.equal(chooseFocusCandidate(candidates, { offset: 350, height: 420 }, 'last'), 'tall');
  });

  it('keeps a tall card while the focal line is inside it and ignores fully offscreen cards', () => {
    assert.equal(chooseFocusCandidate(candidates, { offset: 500, height: 300 }, 'second'), 'tall');
    assert.equal(chooseFocusCandidate(candidates, { offset: 1300, height: 300 }, 'last'), null);
  });

  it('uses hysteresis to avoid swapping winners around a boundary', () => {
    const close = [
      { id: 'a', top: 0, height: 200 },
      { id: 'b', top: 208, height: 200 },
    ];
    assert.equal(chooseFocusCandidate(close, { offset: 4, height: 400 }, 'a'), 'a');
    assert.equal(chooseFocusCandidate(close, { offset: 80, height: 400 }, 'a'), 'b');
  });

  it('uses visual position and stable identity to break grid ties regardless of registration order', () => {
    const grid = [
      { id: 'bravo', top: 0, left: 180, height: 200 },
      { id: 'alpha', top: 0, left: 0, height: 200 },
    ];
    assert.equal(chooseFocusCandidate(grid, { offset: 0, height: 400 }, null), 'alpha');
    assert.equal(chooseFocusCandidate([...grid].reverse(), { offset: 0, height: 400 }, null), 'alpha');
  });
});

describe('focus evaluation scheduler', () => {
  it('coalesces repeated scroll/layout requests into one bounded frame callback', () => {
    const queued: Array<() => void> = [];
    let evaluations = 0;
    const scheduler = createFocusScheduler(
      () => { evaluations += 1; },
      (callback) => { queued.push(callback); return queued.length; },
      () => {},
    );

    scheduler.request();
    scheduler.request();
    scheduler.request();
    assert.equal(queued.length, 1);
    queued.shift()?.();
    assert.equal(evaluations, 1);
    scheduler.request();
    assert.equal(queued.length, 1);
  });

  it('cancels queued work and prevents evaluation after disposal', () => {
    const queued = new Map<number, () => void>();
    const cancelled: number[] = [];
    let evaluations = 0;
    let nextId = 0;
    const scheduler = createFocusScheduler(
      () => { evaluations += 1; },
      (callback) => { const id = ++nextId; queued.set(id, callback); return id; },
      (id) => { cancelled.push(id); },
    );

    scheduler.request();
    scheduler.dispose();
    queued.get(1)?.();
    assert.deepEqual(cancelled, [1]);
    assert.equal(evaluations, 0);
    scheduler.request();
    assert.equal(nextId, 1);
  });

  it('ignores a cancelled frame even if its host callback arrives after a new lifecycle lease', () => {
    const queued: Array<() => void> = [];
    let evaluations = 0;
    const scheduler = createFocusScheduler(
      () => { evaluations += 1; },
      (callback) => { queued.push(callback); return queued.length; },
      () => {},
    );
    scheduler.request();
    scheduler.cancel();
    scheduler.request();
    queued[0]?.();
    assert.equal(evaluations, 0);
    queued[1]?.();
    assert.equal(evaluations, 1);
  });
});
