import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle } from './component-harness';

function renderLogin() {
  const harness = createHookHarness();
  const Screen = compileCommonJs<{ default: () => unknown }>(
    new URL('../../src/screens/auth/LoginScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', Alert: { alert: () => undefined }, Image: 'Image',
        Linking: { openURL: async () => undefined }, Platform: { OS: 'android' }, Pressable: 'Pressable',
        StyleSheet: { create: <T>(styles: T) => styles }, Text: 'Text', TextInput: 'TextInput', View: 'View',
      },
      '@react-navigation/native': { useNavigation: () => ({ navigate: () => undefined }) },
      '../../components/AuthShell': ({ children }: Record<string, unknown>) => createElement('AuthShell', {}, children),
      '../../context/AuthContext': { useAuth: () => ({
        signInWithApple: async () => ({ error: null }), signInWithEmail: async () => ({ error: null }),
        signInWithGoogle: async () => ({ error: null }), continueAsGuest: () => undefined,
      }) },
      '../../context/LeagueContext': { useLeague: () => ({ enterGuestLeague: () => undefined }) },
      '../../theme/colors': { default: {
        textSecondary: '#aaa', textInteractive: '#0ff', borderCard: '#333', bgSurface: '#111',
        primary: '#0ff', textOnPrimary: '#000', accentRed: '#f00',
      } },
    },
  ).default;
  harness.mount(() => Screen());
  return harness.output;
}

describe('signed-out public link accessibility', () => {
  it('renders Privacy, Terms, and Support as descriptive 44-point links', () => {
    const tree = renderLogin();
    for (const expected of [
      { label: 'Open Privacy Policy', hint: 'Opens the Hockey Life privacy policy in your browser' },
      { label: 'Open Terms of Service', hint: 'Opens the Hockey Life terms of service in your browser' },
      { label: 'Open Support', hint: 'Opens Hockey Life support in your browser' },
    ]) {
      const link = findNode(tree, (node) => node.props.accessibilityLabel === expected.label);
      assert.ok(link, `${expected.label} should render`);
      assert.equal(link.props.accessibilityRole, 'link');
      assert.equal(link.props.accessibilityHint, expected.hint);
      const style = flattenStyle(typeof link.props.style === 'function' ? link.props.style({ pressed: false }) : link.props.style);
      assert.ok((style.minHeight ?? 0) >= 44 || (link.props.hitSlop ?? 0) >= 12, `${expected.label} needs a 44-point target or equivalent hitSlop`);
    }
  });
});
