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

const approvedRemoteLogos = [
  ['453d62d9-80b4-4f26-a2ee-861f0c063402', 'https://auth.beerleaguehockey.ca/storage/v1/object/public/team-logos/team-logos/453d62d9-80b4-4f26-a2ee-861f0c063402-first-general-approved-20260928.webp'],
  ['e4be829d-952c-4531-8376-215907fab3b7', 'https://auth.beerleaguehockey.ca/storage/v1/object/public/team-logos/team-logos/e4be829d-952c-4531-8376-215907fab3b7-flyers-approved-20260928.webp'],
  ['346833e0-2780-492d-86db-94df0b0cb3e1', 'https://auth.beerleaguehockey.ca/storage/v1/object/public/team-logos/team-logos/346833e0-2780-492d-86db-94df0b0cb3e1-liuna-approved-20260928.webp'],
  ['093f611c-0cdc-4509-afde-9c661b5833c9', 'https://auth.beerleaguehockey.ca/storage/v1/object/public/team-logos/team-logos/093f611c-0cdc-4509-afde-9c661b5833c9-bad-bunny-approved-20260928.webp'],
] as const;

const legacyFirstGeneralUrl = 'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/team-logos/team-logos/453d62d9-80b4-4f26-a2ee-861f0c063402-manual-flat.png';

function loadRegistry() {
  return compileCommonJs<{
    getBundledTeamLogoSource: (teamId?: string | null, logoUrl?: string | null) => unknown;
  }>(new URL('../../src/lib/teamLogoSources.ts', import.meta.url), {
    '../../assets/team-logos/first-general-london.png': { bundled: 'first-general' },
    '../../assets/team-logos/fitzrays-flyers.png': { bundled: 'flyers' },
    '../../assets/team-logos/fitzrays-premier.png': { bundled: 'liuna' },
    '../../assets/team-logos/london-eco-metal.png': { bundled: 'bad-bunny' },
  });
}

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

  it('uses all four approved current URLs instead of stale bundled artwork', () => {
    const { getBundledTeamLogoSource } = loadRegistry();
    for (const [teamId, logoUrl] of approvedRemoteLogos) {
      assert.equal(getBundledTeamLogoSource(teamId, logoUrl), null, `${teamId} must use its current remote URL`);
    }
  });

  it('only substitutes bundled artwork for an absent URL or the same team verified legacy URL', () => {
    const { getBundledTeamLogoSource } = loadRegistry();
    const firstGeneralId = '453d62d9-80b4-4f26-a2ee-861f0c063402';

    assert.deepEqual(getBundledTeamLogoSource(firstGeneralId, null), { bundled: 'first-general' });
    assert.deepEqual(getBundledTeamLogoSource(firstGeneralId, legacyFirstGeneralUrl), { bundled: 'first-general' });
    assert.deepEqual(getBundledTeamLogoSource(null, legacyFirstGeneralUrl), { bundled: 'first-general' });
    assert.equal(getBundledTeamLogoSource('unknown-team', 'https://example.test/unknown.png'), null);
    assert.equal(getBundledTeamLogoSource(firstGeneralId, 'https://example.test/current.png'), null);
    assert.equal(
      getBundledTeamLogoSource('e4be829d-952c-4531-8376-215907fab3b7', legacyFirstGeneralUrl),
      null,
      'a verified legacy URL must never substitute another team\'s artwork',
    );
  });

  it('renders a same-team current URL immediately after bundled legacy artwork and after an error', () => {
    const harness = createHookHarness();
    const currentUrl = approvedRemoteLogos[0][1];
    const props = {
      teamId: approvedRemoteLogos[0][0] as string,
      logoUrl: legacyFirstGeneralUrl as string,
      teamName: 'First General',
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
        '../lib/teamLogoSources': {
          getBundledTeamLogoSource: (teamId: string | null, logoUrl: string | null) =>
            teamId === props.teamId && logoUrl === legacyFirstGeneralUrl ? { bundled: 'first-general' } : null,
        },
      },
    ).default;

    harness.mount(() => TeamLogo(props));
    assert.deepEqual(findNode(harness.output, (node) => node.type === 'Image')!.props.source, { bundled: 'first-general' });

    props.logoUrl = currentUrl;
    harness.render();
    let image = findNode(harness.output, (node) => node.type === 'Image')!;
    assert.deepEqual(image.props.source, { uri: currentUrl });

    image.props.onError();
    harness.render();
    assert.deepEqual(findNode(harness.output, (node) => node.type === 'Image')!.props.source, { uri: 'https://example.test/fallback.png' });

    props.logoUrl = 'https://example.test/first-general-replacement.webp';
    harness.render();
    image = findNode(harness.output, (node) => node.type === 'Image')!;
    assert.deepEqual(image.props.source, { uri: props.logoUrl });
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

  it('keeps every shared team-logo image backing transparent', () => {
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
    assert.equal(findNode(harness.output, (node) => node.type === 'Image')!.props.style[1].backgroundColor, 'transparent');

    props.transparentBacking = true;
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.type === 'Image')!.props.style[2].backgroundColor, 'transparent');
  });
});
