import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness.ts';

const PLAYER_ID = '40000000-0000-4000-8000-000000000011';
const OTHER_ID = '40000000-0000-4000-8000-000000000012';

function renderToggle(props: Record<string, unknown>) {
  const harness = createHookHarness();
  const Toggle = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/components/BeerGuyToggle.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View',
      },
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      '../theme/colors': { default: {
        brandGold: '#fbbf24', textPrimary: '#fff', textSecondary: '#aaa', bgInteractive: '#111',
        glassStrokeStrong: '#555', accentRed: '#f00',
      } },
    },
  ).default;
  harness.mount(() => Toggle(props));
  return harness;
}

function assignment(playerId: string, playerName: string) {
  return {
    id: '70000000-0000-4000-8000-000000000011',
    version: 1,
    player_id: playerId,
    status: 'pending',
    player_name: playerName,
    player_avatar_url: null,
  };
}

describe('BeerGuyToggle', () => {
  it('renders an independent accessible checkbox for unassigned, self-assigned, and other-assigned state', () => {
    const presses: string[] = [];
    const unassigned = renderToggle({
      assignment: null,
      currentUserId: PLAYER_ID,
      callerEligible: true,
      loading: false,
      busy: false,
      error: null,
      onToggle: () => presses.push('claim'),
    });
    const unassignedControl = findNode(unassigned.output, (node) => node.type === 'Pressable')!;
    assert.equal(unassignedControl.props.accessibilityRole, 'checkbox');
    assert.equal(unassignedControl.props.accessibilityLabel, 'Beer Guy');
    assert.match(unassignedControl.props.accessibilityHint, /claim.*check.*In/i);
    assert.deepEqual(unassignedControl.props.accessibilityState, { checked: false, disabled: false, busy: false });
    assert.ok(Number(flattenStyle(unassignedControl.props.style({ pressed: false })).minHeight) >= 44);
    unassignedControl.props.onPress();
    assert.deepEqual(presses, ['claim']);

    const self = renderToggle({
      assignment: assignment(PLAYER_ID, 'Current Player'),
      currentUserId: PLAYER_ID,
      callerEligible: true,
      loading: false,
      busy: false,
      error: null,
      onToggle: () => presses.push('clear'),
    });
    const selfControl = findNode(self.output, (node) => node.type === 'Pressable')!;
    assert.deepEqual(selfControl.props.accessibilityState, { checked: true, disabled: false, busy: false });
    assert.match(selfControl.props.accessibilityHint, /clear.*remain.*In/i);
    assert.match(nodeText(self.output), /You’re Beer Guy/);
    selfControl.props.onPress();
    assert.deepEqual(presses, ['claim', 'clear']);

    const other = renderToggle({
      assignment: assignment(OTHER_ID, 'Pat Holder'),
      currentUserId: PLAYER_ID,
      callerEligible: true,
      loading: false,
      busy: false,
      error: null,
      onToggle: () => presses.push('wrong'),
    });
    const otherControl = findNode(other.output, (node) => node.type === 'Pressable')!;
    assert.deepEqual(otherControl.props.accessibilityState, { checked: false, disabled: true, busy: false });
    assert.match(otherControl.props.accessibilityLabel, /Beer Guy.*Pat Holder/);
    assert.match(nodeText(other.output), /Assigned to Pat Holder/);
    otherControl.props.onPress();
    assert.deepEqual(presses, ['claim', 'clear']);

    const icon = findNode(other.output, (node) => node.type === 'Ionicons')!;
    assert.equal(icon.props.accessible, false);
  });
});
