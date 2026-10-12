import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

const mobileRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = path.join(mobileRoot, 'src');

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? files(absolute) : /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

describe('scroll-focus pause infrastructure removal', () => {
  it('has no production focus-pause provider, hook, lease, or context left mounted', () => {
    const findings = [path.join(mobileRoot, 'App.tsx'), ...files(sourceRoot)].flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return /FocusPause|useFocusPaused/.test(text) ? [path.relative(mobileRoot, file)] : [];
    });
    assert.deepEqual(findings, []);
  });

  it('preserves the dock modal lifecycle, keyboard hiding, layout reporting, and route reset', () => {
    const dock = readFileSync(path.join(sourceRoot, 'navigation/MobileWebDock.tsx'), 'utf8');
    assert.match(dock, /createDockModalLifecycle\(animateModal, setModal\)/);
    assert.match(dock, /if \(keyboardVisible\) reportHeight\?\.\(0\)/);
    assert.match(dock, /reportHeight\?\.\(event\.nativeEvent\.layout\.height\)/);
    assert.match(dock, /lifecycle\.reset\(\)/);
    assert.match(dock, /getMobileDockLayout\(width, insets\.bottom, height, insets\.top\)/);
    assert.match(dock, /paddingBottom:\s*layout\.safeAreaPaddingBottom/);
  });
});
