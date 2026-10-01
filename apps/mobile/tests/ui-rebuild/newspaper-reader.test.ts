import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

describe('superseded newspaper browser bridge', () => {
  it('keeps the replacement contract free of automatic OS, Safari-view, browser-modal, and PDF controls', () => {
    const loader = readFileSync(fileURLToPath(new URL('../../src/lib/newspaperReader.ts', import.meta.url).href), 'utf8');
    const screen = readFileSync(fileURLToPath(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url).href), 'utf8');
    const edition = readFileSync(fileURLToPath(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url).href), 'utf8');
    assert.doesNotMatch(loader + screen + edition, /expo-web-browser|openBrowserAsync|SafariView|WebView|\.pdf\b|Zoom out|Zoom in|Download|Print/);
    assert.match(screen, /loadPublishedNewspaperEdition/);
    assert.match(screen, /NativeNewspaperEdition/);
  });
});
