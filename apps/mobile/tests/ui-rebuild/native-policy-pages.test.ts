import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CUT_ICE_ROUTE_TITLES } from '../../src/components/cutIceTitleModel.ts';
import { REGISTERED_USER_SCREENS } from '../../src/navigation/screenRegistry.ts';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness.ts';

const SUPPORT_MAILTO_URL = 'mailto:support@beerleaguehockey.ca?subject=Hockey%20Life%20App%20Support';
const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url).toString()),
  'utf8',
);

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

function createScreenFixture(
  screenPath: 'SupportScreen.tsx' | 'PrivacyScreen.tsx' | 'TermsScreen.tsx',
  opener: (url: string) => Promise<unknown> = async () => undefined,
) {
  const harness = createHookHarness();
  const openedUrls: string[] = [];
  let backCalls = 0;
  const host = (type: string) => (props: Record<string, unknown>) => createElement(type, props, props.children);
  const Screen = compileCommonJs<{ default: (props: { navigation: { goBack: () => void } }) => unknown }>(
    new URL(`../../src/screens/${screenPath}`, import.meta.url),
    {
      react: harness.react,
      'react-native': {
        Linking: {
          openURL: (url: string) => {
            openedUrls.push(url);
            return opener(url);
          },
        },
        Pressable: host('Pressable'),
        StyleSheet: { create: <T>(value: T) => value },
        Text: host('Text'),
        View: host('View'),
      },
      'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
      '../components/CardFocus': {
        FocusCard: host('FocusCard'),
        FocusScrollView: host('FocusScrollView'),
      },
      '../theme/colors': {
        __esModule: true,
        default: {
          accentRed: '#EF4444', bgElevated: '#0B192B', bgInteractive: '#1C2A42', bgSurface: '#101D31',
          glassStroke: '#334155', primary: '#22D3EE', textInteractive: '#67E8F9', textOnPrimary: '#02111B',
          textPrimary: '#F7FBFF', textSecondary: '#A8B4C8',
        },
      },
    },
  ).default;
  harness.mount(() => Screen({ navigation: { goBack: () => { backCalls += 1; } } }));
  return { harness, openedUrls, backCalls: () => backCalls };
}

describe('native Hockey Life policy and support routes', () => {
  it('registers all three dependency-free pages in the global Profile stack and Cut Ice inventory', () => {
    const navigation = source('src/navigation/index.tsx');
    const types = source('src/navigation/types.ts');

    for (const [route, screen, title] of [
      ['Support', 'SupportScreen', 'Support'],
      ['Privacy', 'PrivacyScreen', 'Privacy'],
      ['Terms', 'TermsScreen', 'Terms'],
    ] as const) {
      assert.match(types, new RegExp(`${route}:\\s*undefined`));
      assert.match(navigation, new RegExp(`ProfileStack\\.Screen name="${route}" component=\\{${screen}\\} options=\\{cutIceOptions\\('${title}'\\)\\}`));
      assert.ok(REGISTERED_USER_SCREENS.includes(route));
      assert.equal(CUT_ICE_ROUTE_TITLES[route], title);
    }
  });

  it('mounts Support with clear scope, safety guidance, response expectations, and accessible back behavior', () => {
    const fixture = createScreenFixture('SupportScreen.tsx');
    const text = nodeText(fixture.harness.output);
    assert.match(text, /app and technical support/i);
    assert.match(text, /league-specific questions/i);
    assert.match(text, /More → Contact/);
    assert.match(text, /device.*operating system.*app version.*what you were doing.*error message/is);
    assert.match(text, /never send.*passwords.*payment-card information/is);
    assert.match(text, /typically repl(?:y|ies) within 24–48 hours.*not a guarantee/is);
    assert.match(text, /support@beerleaguehockey\.ca/);

    const safeArea = findNode(fixture.harness.output, (node) => node.type === 'SafeAreaView');
    assert.deepEqual(safeArea?.props.edges, ['left', 'right', 'bottom']);
    safeArea?.props.onAccessibilityEscape();
    assert.equal(fixture.backCalls(), 1);
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'FocusScrollView')?.props.horizontal, undefined);
    assert.ok(allNodes(fixture.harness.output).filter((node) => node.type === 'Text' && node.props.accessibilityRole === 'header').length >= 4);
  });

  it('opens the exact encoded support email action and keeps the page usable after sync or async failure', async () => {
    const success = createScreenFixture('SupportScreen.tsx');
    const action = findNode(success.harness.output, (node) => node.props.accessibilityLabel === 'Email Hockey Life Support');
    assert.equal(action?.props.accessibilityRole, 'button');
    assert.ok(flattenStyle(action?.props.style).minHeight >= 48);
    action?.props.onPress();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(success.openedUrls, [SUPPORT_MAILTO_URL]);

    for (const opener of [
      () => { throw new Error('no mail app'); },
      async () => { throw new Error('mail app rejected'); },
    ]) {
      const failure = createScreenFixture('SupportScreen.tsx', opener);
      findNode(failure.harness.output, (node) => node.props.accessibilityLabel === 'Email Hockey Life Support')?.props.onPress();
      await new Promise<void>((resolve) => setImmediate(resolve));
      failure.harness.render();
      const alert = findNode(failure.harness.output, (node) => node.props.accessibilityRole === 'alert');
      assert.match(nodeText(alert), /could not open your email app.*support@beerleaguehockey\.ca/i);
      assert.match(nodeText(failure.harness.output), /What to include/);
      assert.ok(findNode(failure.harness.output, (node) => node.props.accessibilityLabel === 'Email Hockey Life Support'));
    }
  });

  it('renders the complete Privacy policy with required sections and readable native text', () => {
    const fixture = createScreenFixture('PrivacyScreen.tsx');
    const text = nodeText(fixture.harness.output);
    for (const required of [
      'Last updated: October 16, 2026', 'Account and profile information', 'roster, league, game participation, and statistics',
      'availability, attendance, and app interactions', 'support submissions', 'push token', 'technical and security data',
      'signed waivers', 'payment, audit, and tax records', 'league organizers', 'service providers',
      'do not sell your personal data', 'Retention', 'Security', 'access, correct, or delete',
      'notifications are optional', 'not directed to children under 13', 'Policy updates', 'support@beerleaguehockey.ca',
    ]) assert.match(text, new RegExp(required, 'i'), required);
    assert.match(text, /Information we collect.*signed waivers.*payment, audit, and tax records.*How we use information/is);
    assert.match(text, /Retention.*signed waivers.*minimum evidentiary fields.*not anonymous/is);
    assert.match(text, /Retention.*payment.*audit.*tax.*legal identifiers.*not anonymous/is);
    assert.match(text, /Retention.*clears? Stripe handles, metadata, idempotency material, reminders, and free text/is);
    assert.match(text, /Hockey Life does not collect or retain full payment-card numbers/i);
    assert.doesNotMatch(text, /encrypted|certif(?:ied|ication)|delet(?:e|ion) within \d+|coming soon|lorem ipsum|placeholder|\bTODO\b/i);
  });

  it('renders complete measured Terms without invented payment, entity, venue, or availability promises', () => {
    const fixture = createScreenFixture('TermsScreen.tsx');
    const text = nodeText(fixture.harness.output);
    for (const required of [
      'Last updated: October 16, 2026', 'Acceptance', 'Account accuracy and security', 'League participation and conduct',
      'organizer rules', 'availability, schedules, and stats', 'operational records', 'may change',
      'Your submissions and content', 'operating and promoting Hockey Life and league services', 'Prohibited conduct',
      'Third-party, device, and network services', 'Suspension and termination', 'Service changes and availability',
      'Disclaimers and limits', 'Updates to these terms', 'support@beerleaguehockey.ca',
    ]) assert.match(text, new RegExp(required, 'i'), required);
    assert.doesNotMatch(text, /refund|governing law|exclusive jurisdiction|incorporated|guarantee(?:d)? uptime|coming soon|lorem ipsum|placeholder|\bTODO\b/i);

    const scroll = findNode(fixture.harness.output, (node) => node.type === 'FocusScrollView');
    assert.ok(scroll);
    for (const node of allNodes(fixture.harness.output).filter((candidate) => candidate.type === 'Text')) {
      assert.notEqual(node.props.allowFontScaling, false);
      assert.equal(node.props.numberOfLines, undefined);
    }
  });
});