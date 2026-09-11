import assert from 'node:assert/strict';
import { it } from 'node:test';

import { compileCommonJs, createElement, findNode } from './component-harness.ts';

it('uses the guest-only exit for the banner Sign In action', () => {
  const sourceUrl = new URL('../../src/components/AuthGuestBanner.tsx', import.meta.url);
  let exitGuestCalls = 0;
  let signOutCalls = 0;
  const exports = compileCommonJs<{ default: () => unknown }>(sourceUrl, {
    react: { createElement },
    'react-native': {
      Pressable: 'Pressable', StyleSheet: { create: (styles: unknown) => styles }, Text: 'Text', View: 'View',
    },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '../context/AuthContext': {
      useAuth: () => ({
        exitGuest: () => { exitGuestCalls += 1; },
        signOut: () => { signOutCalls += 1; },
      }),
    },
    '../theme/colors': { default: { brandArena: '#2563EB' } },
  });

  const tree = exports.default();
  const button = findNode(tree, (node) => node.props.accessibilityLabel === 'Sign in');
  assert.ok(button);
  button.props.onPress();
  assert.equal(exitGuestCalls, 1);
  assert.equal(signOutCalls, 0);
});
