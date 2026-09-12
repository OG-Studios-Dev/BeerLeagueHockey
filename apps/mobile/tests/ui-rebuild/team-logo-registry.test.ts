import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileCommonJs, createHookHarness, findNode, nodeText } from './component-harness';

const registryUrl = fileURLToPath(new URL('../../src/lib/teamLogoSources.ts', import.meta.url) as any);
const registrySource = existsSync(registryUrl) ? readFileSync(registryUrl, 'utf8') : '';

const expected = [
  ['453d62d9-80b4-4f26-a2ee-861f0c063402', 'first-general-london.png', '34ed7d2155fb47d788791de414c051f44ca7350bd6c1b24a7002e6985e0e2515'],
  ['e4be829d-952c-4531-8376-215907fab3b7', 'fitzrays-flyers.png', 'dadbec3aa4457bf36dcd91160ede3bfe87c14286600eee59875bed9371dd15f0'],
  ['346833e0-2780-492d-86db-94df0b0cb3e1', 'fitzrays-premier.png', '8b4851d2f92725e00ea55daadd2178510a14d5c80111be4876d7845fd01c52ab'],
  ['093f611c-0cdc-4509-afde-9c661b5833c9', 'london-eco-metal.png', '3de073cd6427d4c87445a89ff514631f48d498cc390397d44b0610ffba138d11'],
] as const;

describe('Hockey Life native artwork registry', () => {
  it('preserves the exact four public PNG payloads', () => {
    for (const [, filename, digest] of expected) {
      const bytes = readFileSync(fileURLToPath(new URL(`../../assets/team-logos/${filename}`, import.meta.url) as any));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
    }
  });

  it('maps every artwork by verified team UUID with a static Metro require', () => {
    for (const [teamId, filename] of expected) {
      assert.match(registrySource, new RegExp(`['"]${teamId}['"]\\s*:\\s*require\\(['"]\\.\\.\\/\\.\\.\\/assets/team-logos/${filename.replace('.', '\\.')}['"]\\)`));
    }
    assert.doesNotMatch(registrySource, /teamName|toLowerCase\(\)/);
  });

  it('clears an error fallback immediately when the team identity changes', () => {
    const harness = createHookHarness();
    const props = { teamId: 'team-a', logoUrl: 'https://example.test/a.png', teamName: 'A' };
    const TeamLogo = compileCommonJs<{ default: (value: typeof props) => unknown }>(
      new URL('../../src/components/TeamLogo.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          Image: 'Image', Text: 'Text', View: 'View',
          StyleSheet: { create: <T>(value: T) => value },
        },
        '../lib/imagePlaceholders': { BLH_DEFAULT_TEAM_LOGO_URL: 'https://example.test/fallback.png' },
        '../lib/teamLogoSources': { getBundledTeamLogoSource: (teamId: string | null) => teamId ? { bundled: teamId } : null },
      },
    ).default;
    harness.mount(() => TeamLogo(props));
    let image = findNode(harness.output, (node) => node.type === 'Image')!;
    assert.deepEqual(image.props.source, { bundled: 'team-a' });

    image.props.onError();
    harness.render();
    image = findNode(harness.output, (node) => node.type === 'Image')!;
    assert.deepEqual(image.props.source, { uri: 'https://example.test/fallback.png' });

    props.teamId = 'team-b';
    props.logoUrl = 'https://example.test/b.png';
    props.teamName = 'B';
    harness.render();
    image = findNode(harness.output, (node) => node.type === 'Image')!;
    assert.deepEqual(image.props.source, { bundled: 'team-b' });
  });

  it('uses default exactly once and falls back to initials for default, remote, and bundled failures', () => {
    const harness = createHookHarness();
    const props = { teamId: null as string | null, logoUrl: null as string | null, teamName: 'Unlisted Team' };
    const TeamLogo = compileCommonJs<{ default: (value: typeof props) => unknown }>(
      new URL('../../src/components/TeamLogo.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          Image: 'Image', Text: 'Text', View: 'View',
          StyleSheet: { create: <T>(value: T) => value },
        },
        '../lib/imagePlaceholders': { BLH_DEFAULT_TEAM_LOGO_URL: 'https://example.test/fallback.png' },
        '../lib/teamLogoSources': { getBundledTeamLogoSource: (teamId: string | null) => teamId === 'bundled' ? { bundled: teamId } : null },
      },
    ).default;
    harness.mount(() => TeamLogo(props));

    findNode(harness.output, (node) => node.type === 'Image')!.props.onError();
    harness.render();
    assert.equal(nodeText(harness.output), 'UT');
    assert.equal(findNode(harness.output, (node) => node.type === 'Image'), undefined);

    props.teamId = 'remote';
    props.logoUrl = 'https://example.test/remote.png';
    props.teamName = 'Remote Rockets';
    harness.render();
    let image = findNode(harness.output, (node) => node.type === 'Image')!;
    assert.deepEqual(image.props.source, { uri: 'https://example.test/remote.png' });
    image.props.onError();
    harness.render();
    image = findNode(harness.output, (node) => node.type === 'Image')!;
    assert.deepEqual(image.props.source, { uri: 'https://example.test/fallback.png' });
    image.props.onError();
    harness.render();
    assert.equal(nodeText(harness.output), 'RR');

    props.teamId = 'bundled';
    props.logoUrl = 'https://example.test/ignored.png';
    props.teamName = 'Bundled Bears';
    harness.render();
    image = findNode(harness.output, (node) => node.type === 'Image')!;
    assert.deepEqual(image.props.source, { bundled: 'bundled' });
    image.props.onError();
    harness.render();
    assert.deepEqual(findNode(harness.output, (node) => node.type === 'Image')!.props.source, { uri: 'https://example.test/fallback.png' });
  });

  it('keeps the shared image backing by default and removes it only for an explicit presentation opt-in', () => {
    const harness = createHookHarness();
    const props = {
      teamId: 'team-a', logoUrl: null, teamName: 'Team A', transparentBacking: false,
    };
    const TeamLogo = compileCommonJs<{ default: (value: typeof props) => unknown }>(
      new URL('../../src/components/TeamLogo.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          Image: 'Image', Text: 'Text', View: 'View',
          StyleSheet: { create: <T>(value: T) => value },
        },
        '../lib/imagePlaceholders': { BLH_DEFAULT_TEAM_LOGO_URL: 'https://example.test/fallback.png' },
        '../lib/teamLogoSources': { getBundledTeamLogoSource: () => ({ bundled: 'team-a' }) },
      },
    ).default;
    harness.mount(() => TeamLogo(props));
    assert.equal(findNode(harness.output, (node) => node.type === 'Image')!.props.style[1].backgroundColor, 'rgba(255,255,255,0.06)');

    props.transparentBacking = true;
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.type === 'Image')!.props.style[2].backgroundColor, 'transparent');
  });
});
