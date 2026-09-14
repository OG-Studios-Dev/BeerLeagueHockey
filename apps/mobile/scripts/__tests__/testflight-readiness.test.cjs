/* eslint-disable @typescript-eslint/no-require-imports -- This dependency-free check intentionally uses Node CommonJS. */
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const mobileRoot = join(__dirname, '..', '..');
const readJson = (filename) =>
  JSON.parse(readFileSync(join(mobileRoot, filename), 'utf8'));

const appJson = readJson('app.json');
const easJson = readJson('eas.json');
const packageJson = readJson('package.json');

const IOS_IMAGE = 'macos-tahoe-26.5-xcode-26.6';

const assertBuildNumber = (buildNumber) => {
  assert.match(buildNumber, /^[1-9][0-9]*$/);
  assert.equal(buildNumber, buildNumber.trim());
};

test('keeps EAS configuration rooted in apps/mobile', () => {
  const repositoryRoot = join(mobileRoot, '..', '..');

  assert.equal(existsSync(join(repositoryRoot, 'app.json')), false);
  assert.equal(existsSync(join(repositoryRoot, 'eas.json')), false);
});

test('keeps the existing Expo, Apple, and package identity exact', () => {
  const expo = appJson.expo;

  assert.equal(packageJson.name, '@hockey-life/mobile');
  assert.equal(packageJson.version, '1.0.0');
  assert.equal(packageJson.dependencies.expo, '^54.0.33');
  assert.equal(packageJson.dependencies['react-native'], '0.81.5');

  assert.equal(expo.name, 'Hockey Life');
  assert.equal(expo.slug, 'beer-league-hockey');
  assert.equal(expo.owner, 'nickgrossi');
  assert.equal(expo.scheme, 'blh');
  assert.equal(expo.version, '1.0.0');
  assert.equal(expo.ios.bundleIdentifier, 'ca.beerleaguehockey.app');
  assertBuildNumber(expo.ios.buildNumber);
  assert.equal(
    expo.extra.eas.projectId,
    'ed35ed7d-c5a3-415c-a7d1-ee0366a77dc3',
  );
});

test('accepts incremented or reconciled positive integer build counters', () => {
  // Format-only fixtures; the next upload-safe counter requires live history.
  for (const buildNumber of ['1', '2', '42', '123']) {
    assert.doesNotThrow(() => assertBuildNumber(buildNumber));
  }
});

test('rejects malformed build counters', () => {
  for (const buildNumber of [
    '', '0', '-1', '1.0', '1e2', 'abc', '01', ' 2', '2 ', '2\n',
    2, null, undefined,
  ]) {
    assert.throws(() => assertBuildNumber(buildNumber), { code: 'ERR_ASSERTION' });
  }
});

test('separates an App Store profile from an iOS Simulator profile', () => {
  const production = easJson.build.production;
  const simulator = easJson.build['ios-simulator'];

  assert.equal(easJson.cli.appVersionSource, 'local');
  assert.equal(production.autoIncrement, true);
  assert.equal(production.developmentClient ?? false, false);
  assert.equal(production.environment, 'production');
  assert.equal(simulator.environment, 'production');
  assert.equal(simulator.environment, production.environment);
  assert.equal(production.distribution, 'store');
  assert.equal(production.ios.simulator, false);
  assert.equal(production.ios.buildConfiguration, 'Release');

  assert.equal(simulator.developmentClient, false);
  assert.equal(simulator.distribution, 'internal');
  assert.equal(simulator.ios.simulator, true);
  assert.equal(simulator.ios.buildConfiguration, 'Release');
});

test('pins an Apple-upload-capable Xcode 26 image for every iOS profile', () => {
  for (const [profileName, profile] of Object.entries(easJson.build)) {
    assert.equal(
      profile.ios?.image,
      IOS_IMAGE,
      `${profileName} must use the reviewed Xcode 26.6 image`,
    );
  }
});

test('uses the existing App Store Connect app and Apple team', () => {
  const submit = easJson.submit.production.ios;

  assert.equal(submit.appleId, 'nick@bridg3.io');
  assert.equal(submit.ascAppId, '6759818670');
  assert.equal(submit.appleTeamId, 'C88U8Q3SMR');
});

test('does not embed build environment values or credentials in tracked config', () => {
  const trackedConfig = JSON.stringify({ appJson, easJson });
  const forbiddenValuePatterns = [
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    /sk_(?:live|test)_[A-Za-z0-9]+/i,
    /whsec_[A-Za-z0-9]+/i,
    /sbp_[A-Za-z0-9]+/i,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  ];

  for (const [profileName, profile] of Object.entries(easJson.build)) {
    assert.equal(profile.env, undefined, `${profileName} must not embed env values`);
  }
  assert.equal(easJson.submit.production.ios.ascApiKeyPath, undefined);
  assert.doesNotMatch(trackedConfig, /EXPO_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
  for (const pattern of forbiddenValuePatterns) {
    assert.doesNotMatch(trackedConfig, pattern);
  }
});
