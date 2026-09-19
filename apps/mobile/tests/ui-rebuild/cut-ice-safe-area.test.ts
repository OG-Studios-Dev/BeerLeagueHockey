import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle } from './component-harness.ts';

function mountBoundary(routeName: string) {
  const harness = createHookHarness();
  const insetsContext: { current?: { top: number; right: number; bottom: number; left: number }; Provider?: (props: Record<string, unknown>) => unknown } = {
    current: { top: 47, right: 3, bottom: 34, left: 4 },
  };
  insetsContext.Provider = ({ value, children }: Record<string, unknown>) => {
    insetsContext.current = value as { top: number; right: number; bottom: number; left: number };
    const child = children as { type?: unknown; props?: Record<string, unknown> } | undefined;
    return child && typeof child.type === 'function'
      ? (child.type as (props: Record<string, unknown>) => unknown)(child.props ?? {})
      : child;
  };
  const boundary = compileCommonJs<{
    CutIceScreenBoundary: (props: Record<string, unknown>) => unknown;
    cutIceScreenLayout: (props: Record<string, unknown>) => unknown;
  }>(new URL('../../src/navigation/CutIceScreenBoundary.tsx', import.meta.url), {
    react: harness.react,
    'react-native-safe-area-context': {
      SafeAreaInsetsContext: insetsContext,
      useSafeAreaInsets: () => insetsContext.current,
    },
    '../components/cutIceTitleModel': { CUT_ICE_EXCLUDED_ROUTES: ['Home', 'TeamDetail', 'LeagueTeamDetail'] },
  });

  function Screen() {
    const insets = insetsContext.current!;
    return createElement('View', { testID: 'screen-content', style: { paddingTop: insets.top, paddingRight: insets.right, paddingBottom: insets.bottom, paddingLeft: insets.left } });
  }

  harness.mount(() => boundary.cutIceScreenLayout({ route: { name: routeName }, children: createElement(Screen, null) }));
  const mounted = harness.output as { type?: unknown; props?: Record<string, unknown> };
  const output = typeof mounted?.type === 'function'
    ? (mounted.type as (props: Record<string, unknown>) => unknown)(mounted.props ?? {})
    : mounted;
  return { output, insetsContext };
}

describe('Cut Ice centralized safe-area geometry', () => {
  it('consumes the device top inset once for a root titled route and preserves the other edges', () => {
    const { output } = mountBoundary('ScheduleList');
    const content = findNode(output, (node) => node.props.testID === 'screen-content');
    assert.deepEqual(flattenStyle(content?.props.style), { paddingTop: 0, paddingRight: 3, paddingBottom: 34, paddingLeft: 4 });
    assert.equal(47 + 62 + flattenStyle(content?.props.style).paddingTop, 109);
  });

  it('uses the same one-inset boundary for pushed detail routes', () => {
    const { output } = mountBoundary('GamePreview');
    const content = findNode(output, (node) => node.props.testID === 'screen-content');
    assert.equal(flattenStyle(content?.props.style).paddingTop, 0);
  });

  it('does not suppress the top inset for Home or active Team detail exclusions', () => {
    for (const routeName of ['Home', 'TeamDetail', 'LeagueTeamDetail']) {
      const { output } = mountBoundary(routeName);
      const content = findNode(output, (node) => node.props.testID === 'screen-content');
      assert.equal(flattenStyle(content?.props.style).paddingTop, 47, routeName);
    }
  });
});
