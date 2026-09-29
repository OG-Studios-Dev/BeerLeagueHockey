import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode } from './component-harness.ts';

function mountBoundary(routeName: string) {
  const harness = createHookHarness();
  const nativeReact = {
    createElement,
    forwardRef: (render: (props: Record<string, unknown>, ref: null) => unknown) =>
      (props: Record<string, unknown>) => render(props, null),
    useMemo: (factory: () => unknown) => factory(),
  };
  const nativeSafeAreaView = compileCommonJs<{ SafeAreaView: (props: Record<string, unknown>) => unknown }>(
    new URL('../../node_modules/react-native-safe-area-context/src/SafeAreaView.tsx', import.meta.url),
    {
      react: nativeReact,
      './specs/NativeSafeAreaView': 'NativeSafeAreaView',
    },
  ).SafeAreaView;
  const policy = compileCommonJs<{ cutIceContentEdges: (edges: string[]) => string[] }>(
    new URL('../../src/navigation/cutIceSafeAreaPolicy.ts', import.meta.url),
    {},
  );
  const excludedRoutes = ['Home', 'TeamDetail', 'LeagueTeamDetail'];
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
      SafeAreaView: nativeSafeAreaView,
      useSafeAreaInsets: () => insetsContext.current,
    },
    '../components/cutIceTitleModel': { CUT_ICE_EXCLUDED_ROUTES: excludedRoutes },
  });

  function Screen() {
    const edges = excludedRoutes.includes(routeName)
      ? ['top', 'left', 'right']
      : policy.cutIceContentEdges(['top', 'left', 'right']);
    return nativeSafeAreaView({ testID: 'screen-content', edges });
  }

  harness.mount(() => boundary.cutIceScreenLayout({ route: { name: routeName }, children: createElement(Screen, null) }));
  const mounted = harness.output as { type?: unknown; props?: Record<string, unknown> };
  const output = typeof mounted?.type === 'function'
    ? (mounted.type as (props: Record<string, unknown>) => unknown)(mounted.props ?? {})
    : mounted;
  return { output, insetsContext };
}

describe('Cut Ice centralized safe-area geometry', () => {
  it('turns off the actual native top edge for a root titled route while preserving physical JS insets', () => {
    const { output, insetsContext } = mountBoundary('ScheduleList');
    const content = findNode(output, (node) => node.props.testID === 'screen-content');
    assert.deepEqual(insetsContext.current, { top: 47, right: 3, bottom: 34, left: 4 });
    assert.deepEqual(content?.props.edges, { top: 'off', right: 'additive', bottom: 'off', left: 'additive' });
  });

  it('uses the same one-inset boundary for pushed detail routes', () => {
    const { output } = mountBoundary('GamePreview');
    const content = findNode(output, (node) => node.props.testID === 'screen-content');
    assert.equal(content?.props.edges.top, 'off');
  });

  it('does not suppress the top inset for Home or active Team detail exclusions', () => {
    for (const routeName of ['Home', 'TeamDetail', 'LeagueTeamDetail']) {
      const { output } = mountBoundary(routeName);
      const content = findNode(output, (node) => node.props.testID === 'screen-content');
      assert.equal(content?.props.edges.top, 'additive', routeName);
    }
  });
});
