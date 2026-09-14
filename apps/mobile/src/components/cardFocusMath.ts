export type FocusCandidateLayout = {
  id: string;
  top: number;
  left?: number;
  height: number;
};

export type FocusViewport = {
  offset: number;
  height: number;
};

const FOCAL_RATIO = 0.42;

export function readVerticalScrollOffset(event: unknown): number {
  const offset = (event as { nativeEvent?: { contentOffset?: { y?: unknown } } })
    ?.nativeEvent?.contentOffset?.y;
  return typeof offset === 'number' && Number.isFinite(offset) ? Math.max(0, offset) : 0;
}

function distanceToInterval(point: number, start: number, end: number) {
  if (point < start) return start - point;
  if (point > end) return point - end;
  return 0;
}

export function chooseFocusCandidate(
  candidates: readonly FocusCandidateLayout[],
  viewport: FocusViewport,
  currentId: string | null,
): string | null {
  if (viewport.height <= 0) return null;

  const viewportEnd = viewport.offset + viewport.height;
  const focalLine = viewport.offset + viewport.height * FOCAL_RATIO;
  const visible = candidates
    .filter(({ top, height }) => height > 0 && top < viewportEnd && top + height > viewport.offset)
    .map((candidate) => ({
      candidate,
      score: distanceToInterval(focalLine, candidate.top, candidate.top + candidate.height),
    }))
    .sort((left, right) => left.score - right.score
      || left.candidate.top - right.candidate.top
      || (left.candidate.left ?? 0) - (right.candidate.left ?? 0)
      || left.candidate.id.localeCompare(right.candidate.id));

  const best = visible[0];
  if (!best) return null;
  if (!currentId || best.candidate.id === currentId) return best.candidate.id;

  const current = visible.find(({ candidate }) => candidate.id === currentId);
  const hysteresis = Math.max(18, viewport.height * 0.04);
  return current && current.score <= best.score + hysteresis ? currentId : best.candidate.id;
}

export type FocusScheduler = {
  request(): void;
  cancel(): void;
  dispose(): void;
};

export function createFocusScheduler(
  evaluate: () => void,
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void,
): FocusScheduler {
  let pending: number | null = null;
  let disposed = false;
  let generation = 0;

  return {
    request() {
      if (disposed || pending !== null) return;
      const requestGeneration = generation;
      pending = requestFrame(() => {
        if (requestGeneration !== generation) return;
        pending = null;
        if (!disposed) evaluate();
      });
    },
    cancel() {
      generation += 1;
      if (pending !== null) cancelFrame(pending);
      pending = null;
    },
    dispose() {
      disposed = true;
      generation += 1;
      if (pending !== null) cancelFrame(pending);
      pending = null;
    },
  };
}
