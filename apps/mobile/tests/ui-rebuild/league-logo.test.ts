import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, findNode, nodeText } from './component-harness';

describe('league identity logo', () => {
  it('uses official art when available and an entity-correct named initials fallback otherwise or after failure', () => {
    const harness = createHookHarness();
    const LeagueLogo = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/LeagueLogo.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': { Image: 'Image', Text: 'Text', View: 'View', StyleSheet: { create: <T>(styles: T) => styles } },
      },
    ).default;
    let logoUrl: string | null = null;
    harness.mount(() => LeagueLogo({ logoUrl, leagueName: 'Synthetic Harbour League', primaryColor: '#00ffff', size: 44 }));
    assert.equal(findNode(harness.output, (node) => node.type === 'Image'), undefined);
    assert.equal(nodeText(harness.output), 'SH');
    assert.equal(findNode(harness.output, (node) => node.props.accessibilityLabel === 'Synthetic Harbour League logo')?.type, 'View');

    logoUrl = 'https://assets.example.test/synthetic-official-league.png';
    harness.render();
    const image = findNode(harness.output, (node) => node.type === 'Image');
    assert.equal(image?.props.source.uri, logoUrl);
    image?.props.onError();
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.type === 'Image'), undefined);
    assert.equal(nodeText(harness.output), 'SH');
  });
});
