import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, findNode, nodeText } from './component-harness';

const colors = {
  primary: '#0ff', textPrimary: '#fff', textSecondary: '#aaa', textOnPrimary: '#000',
  bgBase: '#000', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333', accentRed: '#f00',
};

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mountEditProfile(options: {
  profileResult?: Promise<any> | any;
  updateResult?: Promise<any> | any;
} = {}) {
  const harness = createHookHarness();
  const alerts: Array<{ title: string; message?: string }> = [];
  const updates: Record<string, unknown>[] = [];
  let backs = 0;
  const profileResult = options.profileResult ?? {
    data: { full_name: 'Casey', position: 'C', avatar_url: null, skill_level: 'advanced' }, error: null,
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'player-1' } }, error: null }) },
    from: (table: string) => {
      const chain: Record<string, any> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = async () => table === 'profiles' ? await profileResult : { data: null, error: null };
      chain.maybeSingle = async () => ({ data: { jersey_number: 19 }, error: null });
      chain.update = (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: async () => await (options.updateResult ?? { error: null }) };
      };
      return chain;
    },
  };
  const Screen = compileCommonJs<{ default: (props: any) => unknown }>(
    new URL('../../src/screens/EditProfileScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', Alert: { alert: (title: string, message?: string) => alerts.push({ title, message }) },
        Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles }, useWindowDimensions: () => ({ width: 390 }),
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../components/Avatar': () => null,
      '../lib/supabase/client': { supabase },
      '../theme/colors': { default: colors },
    },
  ).default;
  harness.mount(() => Screen({ navigation: { goBack: () => { backs += 1; } } }));
  return { harness, alerts, updates, get backs() { return backs; } };
}

describe('native profile database contract', () => {
  it('loads skill_level and maps it to the selected edit value', async () => {
    const mounted = mountEditProfile();
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();

    const advanced = findNode(mounted.harness.output, (node) => node.type === 'Pressable' && node.props.children?.props?.children === 'Advanced');
    assert.ok(advanced);
    assert.equal(nodeText(mounted.harness.output).includes("couldn't load"), false);
    await findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.onPress();
    assert.deepEqual(mounted.updates, [{ position: 'C', skill_level: 'advanced' }]);
  });

  it('shows a denied profile read and disables saving empty fallback values', async () => {
    const mounted = mountEditProfile({ profileResult: { data: null, error: new Error('RLS denied') } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();

    assert.match(nodeText(mounted.harness.output), /couldn't load your player preferences/i);
    const save = findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes');
    assert.equal(save?.props.disabled, true);
    assert.equal(mounted.updates.length, 0);
  });

  it('keeps entered values and does not navigate when a resolved update reports an error', async () => {
    const mounted = mountEditProfile({ updateResult: { error: new Error('update denied') } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();

    const beginner = findNode(mounted.harness.output, (node) => node.type === 'Pressable' && node.props.children?.props?.children === 'Beginner');
    assert.ok(beginner);
    beginner.props.onPress();
    mounted.harness.render();
    await findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.onPress();
    mounted.harness.render();

    assert.equal(mounted.backs, 0);
    assert.equal(mounted.alerts.at(-1)?.title, 'Unable to Save Profile');
    assert.deepEqual(mounted.updates, [{ position: 'C', skill_level: 'beginner' }]);
    const selectedBeginner = findNode(mounted.harness.output, (node) => node.type === 'Pressable' && node.props.children?.props?.children === 'Beginner');
    assert.ok(selectedBeginner);
  });

  it('does not apply a late profile load after the screen unmounts', async () => {
    const pending = deferred<any>();
    const mounted = mountEditProfile({ profileResult: pending.promise });
    const updatesBeforeUnmount = mounted.harness.stateUpdateCount;
    mounted.harness.unmount();
    pending.resolve({ data: { full_name: 'Late', position: 'G', avatar_url: null, skill_level: 'expert' }, error: null });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mounted.harness.stateUpdateCount, updatesBeforeUnmount);
  });
});
