import React from 'react';

import { CUT_ICE_EXCLUDED_ROUTES } from '../components/cutIceTitleModel';

export function CutIceScreenBoundary({ children }: { children: React.ReactNode }) {
  return children as React.ReactElement;
}

export function cutIceScreenLayout({ children, route }: { children: React.ReactNode; route: { name: string } }) {
  if (CUT_ICE_EXCLUDED_ROUTES.includes(route.name as never)) return children as React.ReactElement;
  return <CutIceScreenBoundary>{children}</CutIceScreenBoundary>;
}
