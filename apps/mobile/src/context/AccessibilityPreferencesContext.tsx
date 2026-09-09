import React from 'react';
import { AccessibilityInfo } from 'react-native';

import { deriveVisualPreferences, type VisualPreferences } from '../theme/ui';

const DEFAULT_PREFERENCES = deriveVisualPreferences(false, false);
const AccessibilityPreferencesContext = React.createContext<VisualPreferences>(DEFAULT_PREFERENCES);

export function AccessibilityPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = React.useState(DEFAULT_PREFERENCES);

  React.useEffect(() => {
    let mounted = true;
    let reduceMotion = false;
    let reduceTransparency = false;

    const publish = () => {
      if (mounted) setPreferences(deriveVisualPreferences(reduceMotion, reduceTransparency));
    };

    const updateMotion = (enabled: boolean) => {
      reduceMotion = enabled;
      publish();
    };
    const updateTransparency = (enabled: boolean) => {
      reduceTransparency = enabled;
      publish();
    };
    const readPreference = (
      query: 'isReduceMotionEnabled' | 'isReduceTransparencyEnabled',
      update: (enabled: boolean) => void,
    ) => {
      // Web omits some queries. Read independently so one missing/rejected
      // preference cannot discard the other, and catch synchronous throws too.
      void Promise.resolve()
        .then(() => AccessibilityInfo[query]?.())
        .then((enabled) => { if (typeof enabled === 'boolean') update(enabled); })
        .catch(() => { /* Keep the default or latest event value. */ });
    };

    readPreference('isReduceMotionEnabled', updateMotion);
    readPreference('isReduceTransparencyEnabled', updateTransparency);

    const subscribe = (
      event: 'reduceMotionChanged' | 'reduceTransparencyChanged',
      update: (enabled: boolean) => void,
    ) => {
      try {
        return AccessibilityInfo.addEventListener?.(event, update);
      } catch {
        // Some platforms expose queries but do not support every event.
        return undefined;
      }
    };
    const motionSubscription = subscribe('reduceMotionChanged', updateMotion);
    const transparencySubscription = subscribe('reduceTransparencyChanged', updateTransparency);

    return () => {
      mounted = false;
      motionSubscription?.remove?.();
      transparencySubscription?.remove?.();
    };
  }, []);

  return (
    <AccessibilityPreferencesContext.Provider value={preferences}>
      {children}
    </AccessibilityPreferencesContext.Provider>
  );
}

export function useAccessibilityPreferences() {
  return React.useContext(AccessibilityPreferencesContext);
}
