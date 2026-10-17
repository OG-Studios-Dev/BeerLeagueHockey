/* eslint-disable @typescript-eslint/no-require-imports -- Tests exercise the Node CommonJS tooling directly. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { verifyManifest } = require('../verify-rebuild-manifest.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-manifest-'));
  fs.mkdirSync(path.join(root, 'src/screens'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/navigation'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/screens/HomeScreen.tsx'), 'export default function HomeScreen() {}\n');
  fs.writeFileSync(path.join(root, 'src/screens/DetailScreen.tsx'), 'export default function DetailScreen() {}\n');
  fs.writeFileSync(path.join(root, 'src/navigation/index.tsx'), `
    import HomeScreen from '../screens/HomeScreen';
    import DetailScreen from '../screens/DetailScreen';
    <Tab.Screen name="Home" component={HomeScreen} />
    <Stack.Screen name="Detail" component={DetailScreen} />
  `);
  return {
    root,
    manifest: {
      schemaVersion: 1,
      screens: [
        { id: 'home', file: 'src/screens/HomeScreen.tsx', status: 'pending', evidence: { sourceImplemented: false, browserReviewed: false, iosDeviceAccepted: false } },
        { id: 'detail', file: 'src/screens/DetailScreen.tsx', status: 'review', evidence: { sourceImplemented: true, browserReviewed: true, iosDeviceAccepted: false } },
      ],
      routes: [
        { navigator: 'Tab', name: 'Home', component: 'HomeScreen' },
        { navigator: 'Stack', name: 'Detail', component: 'DetailScreen' },
      ],
    },
  };
}

test('accepts complete filesystem and route coverage', () => {
  const value = fixture();
  assert.deepEqual(verifyManifest(value.root, value.manifest), []);
});

test('fails when a screen is removed from the manifest', () => {
  const value = fixture();
  value.manifest.screens.pop();
  assert.match(verifyManifest(value.root, value.manifest).join('\n'), /missing screen manifest entry/i);
});

test('fails when a route is removed from the manifest', () => {
  const value = fixture();
  value.manifest.routes.pop();
  assert.match(verifyManifest(value.root, value.manifest).join('\n'), /missing route manifest entry/i);
});

test('fails when a registered route is removed from source', () => {
  const value = fixture();
  const navigation = path.join(value.root, 'src/navigation/index.tsx');
  fs.writeFileSync(navigation, fs.readFileSync(navigation, 'utf8').replace('    <Stack.Screen name="Detail" component={DetailScreen} />\n', ''));
  assert.match(verifyManifest(value.root, value.manifest).join('\n'), /stale route manifest entry/i);
});

test('fails when a screen file is removed from source', () => {
  const value = fixture();
  fs.unlinkSync(path.join(value.root, 'src/screens/DetailScreen.tsx'));
  assert.match(verifyManifest(value.root, value.manifest).join('\n'), /stale screen manifest entry/i);
});

test('fails duplicate screen ids and route identities', () => {
  const value = fixture();
  value.manifest.screens.push({ ...value.manifest.screens[0] });
  value.manifest.routes.push({ ...value.manifest.routes[0] });
  assert.match(verifyManifest(value.root, value.manifest).join('\n'), /duplicate/i);
});

test('fails stale accepted or inconsistent review status', () => {
  const value = fixture();
  value.manifest.screens[0].status = 'accepted';
  value.manifest.screens[1].evidence.browserReviewed = false;
  const errors = verifyManifest(value.root, value.manifest).join('\n');
  assert.match(errors, /accepted.*iOS device evidence/i);
  assert.match(errors, /review.*browser review evidence/i);
});
