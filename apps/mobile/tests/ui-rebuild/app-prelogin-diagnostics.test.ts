import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode } from './component-harness.ts';

describe('unauthenticated app diagnostics reachability', () => {
  it('renders the real diagnostics card seam before an authenticated profile exists', () => {
    const passthrough = ({ children }: { children?: unknown }) => children ?? null;
    const stack = {
      Navigator: 'AuthStack.Navigator',
      Screen: 'AuthStack.Screen',
    };
    const react = {
      createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
        const childValue = children.length <= 1 ? children[0] : children;
        if (typeof type === 'function') return type({ ...(props ?? {}), children: childValue });
        return createElement(type, props, ...children);
      },
    };
    const exports = compileCommonJs<{ default: () => unknown }>(new URL('../../App.tsx', import.meta.url), {
      react,
      '@react-navigation/native': { NavigationContainer: passthrough },
      '@react-navigation/native-stack': { createNativeStackNavigator: () => stack },
      'expo-status-bar': { StatusBar: 'StatusBar' },
      'react-native': {
        ActivityIndicator: 'ActivityIndicator',
        StyleSheet: { create: (styles: unknown) => styles },
        View: 'View',
      },
      'react-native-safe-area-context': { SafeAreaProvider: passthrough },
      './src/context/AuthContext': {
        AuthProvider: passthrough,
        useAuth: () => ({ session: null, isLoading: false, isGuest: false }),
      },
      './src/context/AccessibilityPreferencesContext': { AccessibilityPreferencesProvider: passthrough },
      './src/context/LeagueContext': {
        LeagueProvider: passthrough,
        useLeague: () => ({
          membershipDiagnostics: { backendOrigin: null, appVersion: null, appBuild: null, entries: [] },
          membershipStatus: 'error',
          retryMemberships: () => undefined,
        }),
      },
      './src/components/MembershipDiagnosticsCard': (props: Record<string, unknown>) => (
        createElement('MembershipDiagnosticsCard', { ...props, accessibilityLabel: 'League status diagnostics' })
      ),
      './src/navigation': 'RootNavigation',
      './src/screens/auth/LeagueSelectScreen': 'LeagueSelectScreen',
      './src/screens/auth/LoginScreen': 'LoginScreen',
      './src/screens/auth/ForgotPasswordScreen': 'ForgotPasswordScreen',
      './src/screens/auth/SignUpScreen': 'SignUpScreen',
      './src/screens/auth/SplashScreen': 'SplashScreen',
    });

    const tree = exports.default();
    const card = findNode(tree, (node) => node.props.accessibilityLabel === 'League status diagnostics');
    assert.ok(card);
    assert.equal(card.props.status, 'error');
    assert.equal(typeof card.props.onRetry, 'function');
  });
});
