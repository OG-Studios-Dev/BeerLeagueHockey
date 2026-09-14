import React from 'react';

export type FocusPauseStore = ReturnType<typeof createFocusPauseStore>;

export function createFocusPauseStore() {
  const leases = new Set<number>();
  const listeners = new Set<(paused: boolean) => void>();
  let sequence = 0;
  let paused = false;

  const publish = () => {
    const nextPaused = leases.size > 0;
    if (nextPaused === paused) return;
    paused = nextPaused;
    for (const listener of listeners) listener(paused);
  };

  return {
    acquire() {
      const lease = ++sequence;
      leases.add(lease);
      publish();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        leases.delete(lease);
        publish();
      };
    },
    isPaused: () => paused,
    subscribe(listener: (paused: boolean) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const FocusPauseContext = React.createContext<FocusPauseStore | null>(null);

export function FocusPauseProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(() => createFocusPauseStore());
  return <FocusPauseContext.Provider value={store}>{children}</FocusPauseContext.Provider>;
}

export function useFocusPaused() {
  const store = React.useContext(FocusPauseContext);
  const [paused, setPaused] = React.useState(() => store?.isPaused() ?? false);
  React.useEffect(() => {
    setPaused(store?.isPaused() ?? false);
    return store?.subscribe(setPaused);
  }, [store]);
  return paused;
}

export function useFocusPauseLease(active: boolean) {
  const store = React.useContext(FocusPauseContext);
  React.useEffect(() => {
    if (!active || !store) return undefined;
    return store.acquire();
  }, [active, store]);
}
