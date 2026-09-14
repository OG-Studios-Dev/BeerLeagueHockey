/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free native branding contract. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { inflateSync } = require('node:zlib');

const mobileRoot = join(__dirname, '..', '..');
const assetPath = (name) => join(mobileRoot, 'assets', name);
const readJson = (name) => JSON.parse(readFileSync(join(mobileRoot, name), 'utf8'));

const OLD_ASSET_HASHES = new Set([
  '99c58be8d6caa318205965b4562ad1a3f318cbc91f6c8fa46ef7f2b42fa80777',
  'b4a6ad3387acbcf021b473a3e18b9a4722692d928f3caa4a8c2100c0d7c536ec',
  'f078083decd2d91b1ce26bb8ce3dc04e3a4152f68ec7aa52e324b2e7d6002174',
  '008a7b4471105d38017bc2623d49674fef70a68686fb2b8ecd6133d135bc6a1b',
]);

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(name) {
  const bytes = readFileSync(assetPath(name));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} must be PNG`);
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const compressed = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      assert.equal(data[12], 0, `${name} cannot be interlaced`);
    } else if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  assert.equal(bitDepth, 8, `${name} must use 8-bit channels`);
  assert.ok(colorType === 2 || colorType === 6, `${name} must be RGB or RGBA`);
  const channels = colorType === 6 ? 4 : 3;
  const rowLength = width * channels;
  const filtered = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(width * height * channels);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++];
    const rowOffset = y * rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const raw = filtered[sourceOffset++];
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const above = y > 0 ? pixels[rowOffset + x - rowLength] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[rowOffset + x - rowLength - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : filter === 4 ? paeth(left, above, upperLeft)
                : assert.fail(`${name} has unsupported PNG filter ${filter}`);
      pixels[rowOffset + x] = (raw + predictor) & 255;
    }
  }
  const pixel = (x, y) => {
    const index = (y * width + x) * channels;
    return [pixels[index], pixels[index + 1], pixels[index + 2], channels === 4 ? pixels[index + 3] : 255];
  };
  return { bytes, width, height, colorType, channels, pixels, pixel };
}

function alphaBounds(image, threshold = 8) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.pixel(x, y)[3] <= threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

function markBounds(image, background = [17, 23, 23], threshold = 24) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = image.pixel(x, y);
      const delta = Math.max(...background.map((channel, index) => Math.abs(pixel[index] - channel)));
      if (delta <= threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

test('uses Hockey Life for the display identity while freezing technical identity and counters', () => {
  const { expo } = readJson('app.json');
  assert.equal(expo.name, 'Hockey Life');
  assert.equal(expo.slug, 'beer-league-hockey');
  assert.equal(expo.scheme, 'blh');
  assert.equal(expo.version, '1.0.0');
  assert.equal(expo.ios.buildNumber, '25');
  assert.equal(expo.ios.bundleIdentifier, 'ca.beerleaguehockey.app');
  assert.equal(expo.android.package, 'ca.beerleaguehockey.app');
  assert.equal(expo.android.versionCode, 1);
  assert.equal(expo.owner, 'nickgrossi');
  assert.equal(expo.extra.eas.projectId, 'ed35ed7d-c5a3-415c-a7d1-ee0366a77dc3');
});

test('uses Hockey Life in app-owned iOS permission explanations', () => {
  const permissionCopy = Object.values(readJson('app.json').expo.ios.infoPlist)
    .filter((value) => typeof value === 'string');
  assert.ok(permissionCopy.length >= 4);
  for (const value of permissionCopy) {
    assert.match(value, /^Hockey Life\b/);
    assert.doesNotMatch(value, /\bBLH\b|Beer League Hockey/);
  }
});

test('ships an opaque square 1024px iOS icon with the supplied dark background', () => {
  const icon = decodePng('icon.png');
  assert.deepEqual([icon.width, icon.height, icon.colorType], [1024, 1024, 2]);
  assert.deepEqual(icon.pixel(0, 0), [17, 23, 23, 255]);
  const bounds = markBounds(icon);
  assert.ok(bounds.width >= 680 && bounds.width <= 760, JSON.stringify(bounds));
  assert.ok(bounds.height >= 470 && bounds.height <= 540, JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.width / bounds.height - 206 / 144) < 0.04, JSON.stringify(bounds));
});

test('keeps every adaptive-icon mark pixel inside the Android 66/108 safe circle', () => {
  const adaptive = decodePng('adaptive-icon.png');
  assert.deepEqual([adaptive.width, adaptive.height, adaptive.colorType], [1024, 1024, 6]);
  assert.equal(adaptive.pixel(0, 0)[3], 0);
  const bounds = alphaBounds(adaptive);
  assert.ok(bounds.width >= 480 && bounds.width <= 560, JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.width / bounds.height - 206 / 144) < 0.04, JSON.stringify(bounds));
  const center = (adaptive.width - 1) / 2;
  const safeRadius = adaptive.width * 33 / 108;
  for (let y = 0; y < adaptive.height; y += 1) {
    for (let x = 0; x < adaptive.width; x += 1) {
      if (adaptive.pixel(x, y)[3] <= 8) continue;
      assert.ok(Math.hypot(x - center, y - center) <= safeRadius, `unsafe adaptive pixel at ${x},${y}`);
    }
  }
});

test('uses transparent proportional derivatives for shared and native splash marks', () => {
  for (const [name, size, minimumWidth, maximumWidth] of [
    ['hockey-life-logo.png', 512, 430, 470],
    ['splash.png', 1024, 520, 600],
  ]) {
    const image = decodePng(name);
    assert.deepEqual([image.width, image.height, image.colorType], [size, size, 6]);
    assert.equal(image.pixel(0, 0)[3], 0);
    const bounds = alphaBounds(image);
    assert.ok(bounds.width >= minimumWidth && bounds.width <= maximumWidth, `${name}: ${JSON.stringify(bounds)}`);
    assert.ok(Math.abs(bounds.width / bounds.height - 206 / 144) < 0.04, `${name}: ${JSON.stringify(bounds)}`);
  }
});

test('keeps app-owned assets distinct from the preserved BLH platform sponsor', () => {
  assert.equal(createHash('sha256').update(readFileSync(assetPath('blh-logo.png'))).digest('hex'), 'f078083decd2d91b1ce26bb8ce3dc04e3a4152f68ec7aa52e324b2e7d6002174');
  const favicon = decodePng('favicon.png');
  assert.deepEqual([favicon.width, favicon.height, favicon.colorType], [48, 48, 2]);
  assert.deepEqual(favicon.pixel(0, 0), [17, 23, 23, 255]);
  for (const name of ['icon.png', 'adaptive-icon.png', 'splash.png', 'hockey-life-logo.png', 'favicon.png']) {
    const hash = createHash('sha256').update(readFileSync(assetPath(name))).digest('hex');
    assert.equal(OLD_ASSET_HASHES.has(hash), false, `${name} still contains an old BLH crest asset`);
  }
});
