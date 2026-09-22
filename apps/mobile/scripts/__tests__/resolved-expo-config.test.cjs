/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free Node contract test. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { describe, it } = require('node:test');

const projectRoot = require('node:path').resolve(__dirname, '../..');

function resolvedPrebuildConfig() {
  const output = execFileSync(
    process.execPath,
    [require.resolve('expo/bin/cli'), 'config', '--type', 'prebuild', '--json'],
    { cwd: projectRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

describe('resolved Expo native permissions', () => {
  it('keeps calendar access while excluding Android broad-storage permissions', () => {
    const config = resolvedPrebuildConfig();
    const permissions = new Set(config.android?.permissions ?? []);

    assert.equal(permissions.has('android.permission.READ_CALENDAR'), true);
    assert.equal(permissions.has('android.permission.WRITE_CALENDAR'), true);
    assert.equal(permissions.has('android.permission.READ_EXTERNAL_STORAGE'), false);
    assert.equal(permissions.has('android.permission.WRITE_EXTERNAL_STORAGE'), false);
  });

  it('does not resolve photo-library access after public avatar editing is removed', () => {
    const config = resolvedPrebuildConfig();

    assert.equal(config.ios?.infoPlist?.NSPhotoLibraryUsageDescription, undefined);
    assert.equal(config._internal?.autolinkedModules?.includes('expo-image-picker'), false);
  });
});
