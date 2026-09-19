import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, flattenStyle } from './component-harness.ts';

describe('production App navigation canvas', () => {
  it('supplies a complete dark v7 theme and dark native-stack backing', () => {
    const passthrough = ({ children }: { children?: unknown }) => children ?? null;
    const stack = {
      Navigator: 'Stack.Navigator',
      Screen: 'Stack.Screen',
    };
    const react = {
      createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
        const childValue = children.length <= 1 ? children[0] : children;
        if (typeof type === 'function') return type({ ...(props ?? {}), children: childValue });
        return createElement(type, props, ...children);
      },
    };
    const navigationFonts = {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '600' },
      heavy: { fontFamily: 'System', fontWeight: '700' },
    };
    const exports = compileCommonJs<{ default: () => unknown }>(new URL('../../App.tsx', import.meta.url), {
      react,
      '@react-navigation/native': {
        NavigationContainer: 'NavigationContainer',
        DarkTheme: {
          dark: true,
          colors: {
            primary: 'default-primary', background: 'default-light-leak', card: 'default-card',
            text: 'default-text', border: 'default-border', notification: 'default-notification',
          },
          fonts: navigationFonts,
        },
      },
      '@react-navigation/native-stack': { createNativeStackNavigator: () => stack },
      'expo-status-bar': { StatusBar: 'StatusBar' },
      'react-native': {
        ActivityIndicator: 'ActivityIndicator',
        StyleSheet: { create: <T>(styles: T) => styles },
        View: 'View',
      },
      'react-native-safe-area-context': { SafeAreaProvider: passthrough },
      './src/context/AuthContext': {
        AuthProvider: passthrough,
        useAuth: () => ({ session: { user: { id: 'member-a' } }, isLoading: false, isGuest: false }),
      },
      './src/context/AccessibilityPreferencesContext': { AccessibilityPreferencesProvider: passthrough },
      './src/context/LeagueContext': {
        LeagueProvider: passthrough,
        useLeague: () => ({ membershipDiagnostics: null, membershipStatus: 'ready', retryMemberships: () => undefined }),
      },
      './src/components/MembershipDiagnosticsCard': 'MembershipDiagnosticsCard',
      './src/components/CutIceTitle': 'CutIceTitle',
      './src/navigation/CutIceScreenBoundary': { cutIceScreenLayout: ({ children }: { children: unknown }) => children },
      './src/navigation': 'RootNavigation',
      './src/screens/auth/LoginScreen': 'LoginScreen',
      './src/screens/auth/ForgotPasswordScreen': 'ForgotPasswordScreen',
      './src/screens/auth/SignUpScreen': 'SignUpScreen',
      './src/screens/auth/SplashScreen': 'SplashScreen',
    });

    const tree = exports.default();
    const container = findNode(tree, (node) => node.type === 'NavigationContainer');
    assert.ok(container, 'the real App must own the navigation theme');
    assert.equal(container.props.theme.dark, true);
    assert.equal(container.props.theme.colors.background, '#07111F');
    assert.equal(container.props.theme.colors.card, '#0A1628');
    assert.equal(container.props.theme.colors.text, '#F7FBFF');
    assert.deepEqual(container.props.theme.fonts, navigationFonts, 'v7 fonts must remain complete');

    const navigator = findNode(tree, (node) => node.type === 'Stack.Navigator');
    assert.ok(navigator);
    assert.equal(flattenStyle(navigator.props.screenOptions.contentStyle).backgroundColor, '#07111F');
  });
});
