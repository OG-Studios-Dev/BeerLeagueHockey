/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free Node contract test. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { describe, it } = require('node:test');

const projectRoot = require('node:path').resolve(__dirname, '../..');

let cachedIntrospection;
function resolvedIntrospection() {
  if (cachedIntrospection) return cachedIntrospection;
  const output = execFileSync(
    process.execPath,
    [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'],
    { cwd: projectRoot, encoding: 'utf8' },
  );
  cachedIntrospection = JSON.parse(output);
  return cachedIntrospection;
}

describe('resolved Expo native permissions', () => {
  it('keeps calendar access while excluding Android broad-storage permissions', () => {
    const config = resolvedIntrospection();
    const permissionEntries = config._internal?.modResults?.android?.manifest?.manifest?.['uses-permission'] ?? [];
    const permissions = new Set(
      permissionEntries
        .filter((entry) => entry?.$?.['tools:node'] !== 'remove')
        .map((entry) => entry?.$?.['android:name'])
        .filter(Boolean),
    );

    assert.equal(permissions.has('android.permission.READ_CALENDAR'), true);
    assert.equal(permissions.has('android.permission.WRITE_CALENDAR'), true);
    assert.equal(permissions.has('android.permission.READ_EXTERNAL_STORAGE'), false);
    assert.equal(permissions.has('android.permission.WRITE_EXTERNAL_STORAGE'), false);
    assert.equal(permissions.has('android.permission.SYSTEM_ALERT_WINDOW'), false);
    assert.equal(config.android?.blockedPermissions?.includes('android.permission.SYSTEM_ALERT_WINDOW'), true);
    assert.deepEqual(
      permissionEntries.find((entry) => entry?.$?.['android:name'] === 'android.permission.SYSTEM_ALERT_WINDOW')?.$,
      {
        'android:name': 'android.permission.SYSTEM_ALERT_WINDOW',
        'tools:node': 'remove',
      },
    );
  });

  it('keeps the calendar descriptions needed by createEventAsync without unused Reminders descriptions', () => {
    const config = resolvedIntrospection();
    const infoPlist = config._internal?.modResults?.ios?.infoPlist ?? {};

    assert.equal(infoPlist.NSCalendarsUsageDescription, 'Hockey Life adds your hockey games to your calendar.');
    assert.equal(infoPlist.NSCalendarsFullAccessUsageDescription, 'Hockey Life adds your hockey games to your calendar.');
    assert.equal(infoPlist.NSRemindersUsageDescription, undefined);
    assert.equal(infoPlist.NSRemindersFullAccessUsageDescription, undefined);
  });

  it('does not resolve photo-library access after public avatar editing is removed', () => {
    const config = resolvedIntrospection();

    assert.equal(config.ios?.infoPlist?.NSPhotoLibraryUsageDescription, undefined);
    assert.equal(config._internal?.autolinkedModules?.includes('expo-image-picker'), false);
  });
});
