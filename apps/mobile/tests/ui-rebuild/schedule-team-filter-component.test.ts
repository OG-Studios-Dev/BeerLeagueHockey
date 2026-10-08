import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness.ts';

function createRuntime(selectedTeamId: string | null = 'team-long') {
  const harness = createHookHarness();
  const selections: Array<string | null> = [];
  const options = [
    { id: 'team-a', name: 'Alpha', logoUrl: 'https://example.test/a.png', primaryColor: '#112233' },
    { id: 'team-long', name: 'A Very Long Team Name That Must Wrap Without Clipping', logoUrl: null, primaryColor: '#445566' },
  ];
  const Filter = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/components/ScheduleTeamFilter.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        FlatList: ({ data = [], renderItem, ...props }: Record<string, any>) =>
          createElement('FlatList', props, ...data.map((item: unknown, index: number) => renderItem({ item, index }))),
        Modal: 'Modal',
        Pressable: 'Pressable',
        SafeAreaView: 'SafeAreaView',
        StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1 },
        Text: 'Text',
        View: 'View',
      },
      './TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../theme/home': { HOME_VISUAL_TOKENS: { minTouchTarget: 44, text: '#fff', textSecondary: '#aaa', surfaceOpaque: '#111', elevatedOpaque: '#222', strokeOpaque: '#333', cardRadius: 18 } },
    },
  ).default;
  let props = { options, selectedTeamId, onSelect: (teamId: string | null) => selections.push(teamId) };
  harness.mount(() => Filter(props));
  return { harness, selections, updateSelected: (teamId: string | null) => { props = { ...props, selectedTeamId: teamId }; harness.render(); } };
}

describe('Schedule team filter', () => {
  it('exposes a 44pt labelled trigger and returns the exact selected canonical team ID', () => {
    const runtime = createRuntime();
    const trigger = findNode(runtime.harness.output, (node) => node.props.testID === 'schedule-team-filter-trigger')!;
    assert.equal(trigger.props.accessibilityRole, 'button');
    assert.equal(trigger.props.accessibilityLabel, 'Filter schedule by team, A Very Long Team Name That Must Wrap Without Clipping');
    assert.equal(trigger.props.accessibilityHint, 'Opens team list');
    const triggerStyle = typeof trigger.props.style === 'function' ? trigger.props.style({ pressed: false }) : trigger.props.style;
    assert.ok(flattenStyle(triggerStyle).minHeight >= 44);

    trigger.props.onPress();
    runtime.harness.render();
    const modal = findNode(runtime.harness.output, (node) => node.type === 'Modal')!;
    assert.equal(modal.props.visible, true);
    assert.match(nodeText(modal), /All teams/);
    assert.match(nodeText(modal), /A Very Long Team Name That Must Wrap Without Clipping/);

    const selected = findNode(modal, (node) => node.props.testID === 'schedule-team-option-team-long')!;
    const all = findNode(modal, (node) => node.props.testID === 'schedule-team-option-all')!;
    assert.deepEqual(selected.props.accessibilityState, { selected: true });
    assert.deepEqual(all.props.accessibilityState, { selected: false });
    const optionStyle = typeof selected.props.style === 'function' ? selected.props.style({ pressed: false }) : selected.props.style;
    assert.ok(flattenStyle(optionStyle).minHeight >= 44);
    const longName = findNode(selected, (node) => node.props.testID === 'schedule-team-option-name-team-long')!;
    assert.equal(longName.props.numberOfLines, undefined);

    const alpha = findNode(modal, (node) => node.props.testID === 'schedule-team-option-team-a')!;
    alpha.props.onPress();
    runtime.harness.render();
    assert.deepEqual(runtime.selections, ['team-a']);
    assert.equal(findNode(runtime.harness.output, (node) => node.type === 'Modal')!.props.visible, false);
  });

  it('names a scope-owned selection safely when its team is absent from refreshed options', () => {
    const runtime = createRuntime('team-no-longer-scheduled');
    const trigger = findNode(runtime.harness.output, (node) => node.props.testID === 'schedule-team-filter-trigger')!;
    assert.equal(trigger.props.accessibilityLabel, 'Filter schedule by team, Team unavailable');
    assert.match(nodeText(trigger), /Team unavailable/);
    assert.doesNotMatch(nodeText(trigger), /team-no-longer-scheduled/);
  });
});
