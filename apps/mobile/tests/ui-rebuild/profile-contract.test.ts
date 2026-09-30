import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';
import { subscribeToProfilePreferencesChanges } from '../../src/lib/profileContract';

const colors = {
  primary: '#0ff', textPrimary: '#fff', textSecondary: '#aaa', textOnPrimary: '#000',
  bgBase: '#000', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333', accentRed: '#f00',
};

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function mountEditProfile(options: {
  authResult?: unknown;
  profileResult?: unknown;
  rosterResult?: unknown;
  updateResult?: unknown;
  updateResults?: unknown[];
} = {}) {
  const harness = createHookHarness();
  const alerts: Array<{ title: string; message?: string }> = [];
  const updates: Record<string, unknown>[] = [];
  const updateSelects: string[] = [];
  const navigationListeners = new Map<string, () => void>();
  let profileQueries = 0;
  let rosterQueries = 0;
  let updateIndex = 0;
  let backs = 0;
  const profileResult = options.profileResult ?? {
    data: { full_name: 'Casey', position: 'C', avatar_url: null, skill_level: 'advanced' }, error: null,
  };
  const supabase = {
    auth: { getUser: async () => await (options.authResult ?? ({ data: { user: { id: 'player-1' } }, error: null })) },
    from: (table: string) => {
      const chain: Record<string, any> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = async () => {
        if (table === 'profiles') {
          profileQueries += 1;
          return await profileResult;
        }
        return { data: null, error: null };
      };
      chain.maybeSingle = async () => {
        rosterQueries += 1;
        return await (options.rosterResult ?? { data: { jersey_number: 19 }, error: null });
      };
      chain.update = (payload: Record<string, unknown>) => {
        updates.push(payload);
        const updateChain: Record<string, any> = {};
        updateChain.eq = () => updateChain;
        updateChain.select = (columns: string) => { updateSelects.push(columns); return updateChain; };
        updateChain.single = async () => await (options.updateResults?.[updateIndex++] ?? options.updateResult ?? {
          data: { id: 'player-1', position: payload.position, skill_level: payload.skill_level }, error: null,
        });
        return updateChain;
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
      '../theme/colors': { __esModule: true, default: colors },
    },
  ).default;
  const navigation = {
    goBack: () => { backs += 1; },
    addListener: (event: string, listener: () => void) => {
      navigationListeners.set(event, listener);
      return () => navigationListeners.delete(event);
    },
  };
  harness.mount(() => Screen({ navigation }));
  return {
    harness, alerts, updates, updateSelects, navigationListeners,
    get profileQueries() { return profileQueries; },
    get rosterQueries() { return rosterQueries; },
    get backs() { return backs; },
  };
}

describe('native profile database contract', () => {
  it('loads skill_level and maps it to the selected edit value', async () => {
    const mounted = mountEditProfile();
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();

    const advanced = findNode(mounted.harness.output, (node) => node.type === 'Pressable' && node.props.children?.props?.children === 'Advanced');
    assert.ok(advanced);
    assert.equal(flattenStyle(advanced.props.style).backgroundColor, colors.primary);
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
    const mounted = mountEditProfile({ updateResult: { data: null, error: new Error('update denied') } });
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
    assert.equal(flattenStyle(selectedBeginner.props.style).backgroundColor, colors.primary);
  });

  it('rejects an error-free zero-row update and retains the selected draft', async () => {
    let invalidations = 0;
    const unsubscribe = subscribeToProfilePreferencesChanges('player-1', () => { invalidations += 1; });
    const mounted = mountEditProfile({ updateResult: { data: null, error: null } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();

    const expert = findNode(mounted.harness.output, (node) => node.type === 'Pressable' && node.props.children?.props?.children === 'Expert');
    assert.ok(expert);
    expert.props.onPress();
    mounted.harness.render();
    await findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.onPress();
    mounted.harness.render();

    assert.equal(mounted.backs, 0);
    assert.equal(mounted.alerts.at(-1)?.title, 'Unable to Save Profile');
    assert.deepEqual(mounted.updates, [{ position: 'C', skill_level: 'expert' }]);
    assert.deepEqual(mounted.updateSelects, ['id, position, skill_level']);
    assert.equal(invalidations, 0);
    const selectedExpert = findNode(mounted.harness.output, (node) => node.type === 'Pressable' && node.props.children?.props?.children === 'Expert');
    assert.equal(flattenStyle(selectedExpert?.props.style).backgroundColor, colors.primary);
    unsubscribe();
  });

  it('navigates only after one exact matching row confirms the narrow update', async () => {
    let invalidations = 0;
    const unsubscribe = subscribeToProfilePreferencesChanges('player-1', () => { invalidations += 1; });
    const mounted = mountEditProfile();
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();

    await findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.onPress();

    assert.equal(mounted.backs, 1);
    assert.equal(mounted.alerts.length, 0);
    assert.deepEqual(mounted.updates, [{ position: 'C', skill_level: 'advanced' }]);
    assert.deepEqual(mounted.updateSelects, ['id, position, skill_level']);
    assert.equal(invalidations, 1);
    unsubscribe();
  });

  it('rejects a returned row that does not exactly match the target and draft', async () => {
    const mounted = mountEditProfile({ updateResult: {
      data: { id: 'different-player', position: 'C', skill_level: 'advanced' }, error: null,
    } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();
    await findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.onPress();

    assert.equal(mounted.backs, 0);
    assert.equal(mounted.alerts.at(-1)?.title, 'Unable to Save Profile');
  });

  it('settles a retained editor after blur for success, returned error, and rejection without stale UI effects', async () => {
    for (const schedule of ['refocus-before-settlement', 'refocus-after-settlement'] as const) {
      for (const outcome of ['error', 'success', 'throw'] as const) {
      const pending = deferred<any>();
      let ownInvalidations = 0;
      let otherInvalidations = 0;
      const unsubscribeOwn = subscribeToProfilePreferencesChanges('player-1', () => { ownInvalidations += 1; });
      const unsubscribeOther = subscribeToProfilePreferencesChanges('player-2', () => { otherInvalidations += 1; });
      const mounted = mountEditProfile({ updateResult: pending.promise });
      await new Promise<void>((resolve) => setImmediate(resolve));
      mounted.harness.render();
      const save = findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes');
      assert.ok(save);
      const savePromise = save.props.onPress();
      await new Promise<void>((resolve) => setImmediate(resolve));
      mounted.harness.render();
      assert.equal(mounted.updates.length, 1, `${schedule}/${outcome}: mutation must be pending first`);
      assert.equal(findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.disabled, true);
      assert.equal(findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Cancel profile editing')?.props.disabled, true);
      assert.ok(findNode(mounted.harness.output, (node) => node.type === 'ActivityIndicator'));

      mounted.navigationListeners.get('blur')?.();
      if (schedule === 'refocus-before-settlement') {
        mounted.navigationListeners.get('focus')?.();
      }

      if (outcome === 'error') pending.resolve({ data: null, error: new Error('late denied') });
      else if (outcome === 'success') pending.resolve({ data: { id: 'player-1', position: 'C', skill_level: 'advanced' }, error: null });
      else pending.reject(new Error('late rejection'));
      await savePromise;
      if (schedule === 'refocus-after-settlement') mounted.navigationListeners.get('focus')?.();
      mounted.harness.render();

      assert.equal(mounted.alerts.length, 0, `${schedule}/${outcome}`);
      assert.equal(mounted.backs, 0, `${schedule}/${outcome}`);
      assert.equal(findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.disabled, false);
      assert.equal(findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Cancel profile editing')?.props.disabled, false);
      assert.equal(findNode(mounted.harness.output, (node) => node.type === 'ActivityIndicator'), undefined);
      assert.equal(ownInvalidations, outcome === 'success' ? 1 : 0);
      assert.equal(otherInvalidations, 0);
      unsubscribeOwn();
      unsubscribeOther();
      mounted.harness.unmount();
      }
    }
  });

  it('publishes confirmed persistence after unmount only to the saved user', async () => {
    const pending = deferred<any>();
    let ownInvalidations = 0;
    let otherInvalidations = 0;
    const unsubscribeOwn = subscribeToProfilePreferencesChanges('player-1', () => { ownInvalidations += 1; });
    const unsubscribeOther = subscribeToProfilePreferencesChanges('player-2', () => { otherInvalidations += 1; });
    const mounted = mountEditProfile({ updateResult: pending.promise });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();
    const savePromise = findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.onPress();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mounted.updates.length, 1, 'mutation must be pending before unmount');
    mounted.harness.unmount();
    pending.resolve({ data: { id: 'player-1', position: 'C', skill_level: 'advanced' }, error: null });
    await savePromise;
    assert.equal(ownInvalidations, 1);
    assert.equal(otherInvalidations, 0);
    assert.equal(mounted.alerts.length, 0);
    assert.equal(mounted.backs, 0);
    unsubscribeOwn();
    unsubscribeOther();
  });

  it('does not let an older completion clear a newer save operation', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const mounted = mountEditProfile({ updateResults: [first.promise, second.promise] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();
    const handleSave = findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.onPress;
    assert.ok(handleSave);
    const firstSave = handleSave();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const secondSave = handleSave();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mounted.updates.length, 2, 'newer mutation must be pending before the older one settles');

    first.resolve({ data: null, error: new Error('older denied') });
    await firstSave;
    mounted.harness.render();
    assert.equal(findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.disabled, true);
    assert.ok(findNode(mounted.harness.output, (node) => node.type === 'ActivityIndicator'));

    second.resolve({ data: null, error: new Error('newer denied') });
    await secondSave;
    mounted.harness.render();
    assert.equal(findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.disabled, false);
    assert.equal(findNode(mounted.harness.output, (node) => node.type === 'ActivityIndicator'), undefined);
    mounted.harness.unmount();
  });

  it('finishes delayed auth, profile, and roster stages that settle while blurred', async () => {
    for (const stage of ['auth', 'profile', 'roster'] as const) {
      const pending = deferred<any>();
      const mounted = mountEditProfile({
        authResult: stage === 'auth' ? pending.promise : undefined,
        profileResult: stage === 'profile' ? pending.promise : undefined,
        rosterResult: stage === 'roster' ? pending.promise : undefined,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (stage === 'profile') assert.equal(mounted.profileQueries, 1);
      if (stage === 'roster') {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(mounted.rosterQueries, 1);
      }
      mounted.navigationListeners.get('blur')?.();
      if (stage === 'auth') pending.resolve({ data: { user: { id: 'player-1' } }, error: null });
      else if (stage === 'profile') pending.resolve({ data: { full_name: 'Casey', position: 'C', avatar_url: null, skill_level: 'expert' }, error: null });
      else pending.resolve({ data: { jersey_number: 19 }, error: null });
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      mounted.navigationListeners.get('focus')?.();
      mounted.harness.render();
      assert.ok(findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes'), stage);
      assert.equal(findNode(mounted.harness.output, (node) => node.type === 'ActivityIndicator'), undefined, stage);
      mounted.harness.unmount();
    }
  });

  it('shows a delayed load rejection that settles while blurred instead of spinning forever', async () => {
    const pending = deferred<unknown>();
    const mounted = mountEditProfile({ profileResult: pending.promise });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mounted.profileQueries, 1, 'profile read must be pending before blur');
    mounted.navigationListeners.get('blur')?.();
    pending.reject(new Error('offline'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.navigationListeners.get('focus')?.();
    mounted.harness.render();
    assert.equal(findNode(mounted.harness.output, (node) => node.type === 'ActivityIndicator'), undefined);
    assert.match(nodeText(mounted.harness.output), /couldn't load your player preferences/i);
    mounted.harness.unmount();
  });

  it('does not apply a late profile load after the screen unmounts', async () => {
    const pending = deferred<any>();
    const mounted = mountEditProfile({ profileResult: pending.promise });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mounted.profileQueries, 1, 'profile query must be pending before unmount');
    const updatesBeforeUnmount = mounted.harness.stateUpdateCount;
    mounted.harness.unmount();
    pending.resolve({ data: { full_name: 'Late', position: 'G', avatar_url: null, skill_level: 'expert' }, error: null });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mounted.harness.stateUpdateCount, updatesBeforeUnmount);
  });
});
