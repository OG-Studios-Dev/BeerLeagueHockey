import React from 'react';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { CUT_ICE_EXCLUDED_ROUTES } from '../components/cutIceTitleModel';

export function CutIceScreenBoundary({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const contentInsets = { ...insets, top: 0 };
  return <SafeAreaInsetsContext.Provider value={contentInsets}>{children}</SafeAreaInsetsContext.Provider>;
}

export function cutIceScreenLayout({ children, route }: { children: React.ReactNode; route: { name: string } }) {
  if (CUT_ICE_EXCLUDED_ROUTES.includes(route.name as never)) return children as React.ReactElement;
  return <CutIceScreenBoundary>{children}</CutIceScreenBoundary>;
}
