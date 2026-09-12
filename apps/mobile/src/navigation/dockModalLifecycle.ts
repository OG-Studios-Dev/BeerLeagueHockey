export type ModalSnapshot = { mounted: boolean; open: boolean };
export type ModalAnimator = (open: boolean, complete: (finished: boolean) => void) => void;

export function createDockModalLifecycle(
  initialAnimate: ModalAnimator,
  publish: (snapshot: ModalSnapshot) => void,
) {
  let snapshot: ModalSnapshot = { mounted: false, open: false };
  let animate = initialAnimate;
  let generation = 0;
  let disposed = false;
  let pendingAction: (() => void) | undefined;
  const set = (next: ModalSnapshot) => {
    if (disposed) return;
    snapshot = next;
    publish(snapshot);
  };
  const run = (open: boolean) => {
    const request = ++generation;
    animate(open, (finished) => {
      if (disposed || !finished || request !== generation) return;
      if (!open) {
        const action = pendingAction;
        pendingAction = undefined;
        set({ mounted: false, open: false });
        action?.();
      }
    });
  };
  return {
    setAnimator: (next: ModalAnimator) => { animate = next; },
    open: () => {
      if (disposed) return;
      pendingAction = undefined;
      set({ mounted: true, open: true });
      run(true);
    },
    close: (after?: () => void) => {
      if (disposed) return;
      if (!snapshot.mounted || !snapshot.open) return;
      pendingAction = after;
      set({ mounted: true, open: false });
      run(false);
    },
    reset: () => {
      if (disposed) return;
      generation += 1;
      pendingAction = undefined;
      set({ mounted: false, open: false });
    },
    activate: () => {
      disposed = false;
      generation += 1;
      pendingAction = undefined;
      snapshot = { mounted: false, open: false };
    },
    dispose: () => {
      disposed = true;
      generation += 1;
      pendingAction = undefined;
      snapshot = { mounted: false, open: false };
    },
    snapshot: () => snapshot,
  };
}
