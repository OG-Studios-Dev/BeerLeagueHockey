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

function assertCanonicalPositiveDecimalCounter(counter) {
  assert.equal(typeof counter, 'string');
  assert.match(counter, /^[1-9][0-9]*$/);
  assert.equal(counter, counter.trim());
}

function assertPositiveIntegerCounter(counter) {
  assert.equal(Number.isSafeInteger(counter), true);
  assert.ok(counter > 0);
}

const OLD_ASSET_HASHES = new Set([
  '99c58be8d6caa318205965b4562ad1a3f318cbc91f6c8fa46ef7f2b42fa80777',
  'b4a6ad3387acbcf021b473a3e18b9a4722692d928f3caa4a8c2100c0d7c536ec',
  'f078083decd2d91b1ce26bb8ce3dc04e3a4152f68ec7aa52e324b2e7d6002174',
  '008a7b4471105d38017bc2623d49674fef70a68686fb2b8ecd6133d135bc6a1b',
]);

const APPROVED_THREE_STAR_ASSET_HASHES = {
  'hockey-life-logo.png': 'c71e4711db012fd483bee340812464317fe7bbbeb12320c24017889fcb74ae47',
  'icon.png': 'd2fc79d089ae36aaa246b3c3007cc6e023185c2213ef0c5b9f89c37accbb32da',
  'splash.png': 'b929003606d55ce882ea079c5ff61392c2b492f56f8e501b769285ba95c7ac80',
  'adaptive-icon.png': 'ad0885af7a8e8409d8c44b9b803d48f3830cbc3c8cbd2591fb7e127fd6b84481',
  'favicon.png': 'a582d641fcf830f23931ab77b0cc603146075f03f2bd1f9be9c4c6d811c9f804',
};

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

function alphaComponents(image, threshold = 8) {
  const visited = new Uint8Array(image.width * image.height);
  const components = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const start = y * image.width + x;
      if (visited[start] || image.pixel(x, y)[3] <= threshold) continue;
      const queue = [[x, y]];
      visited[start] = 1;
      let count = 0;
      let top = y;
      let bottom = y;
      for (let index = 0; index < queue.length; index += 1) {
        const [currentX, currentY] = queue[index];
        count += 1;
        top = Math.min(top, currentY);
        bottom = Math.max(bottom, currentY);
        for (const [nextX, nextY] of [[currentX - 1, currentY], [currentX + 1, currentY], [currentX, currentY - 1], [currentX, currentY + 1]]) {
          if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) continue;
          const next = nextY * image.width + nextX;
          if (visited[next] || image.pixel(nextX, nextY)[3] <= threshold) continue;
          visited[next] = 1;
          queue.push([nextX, nextY]);
        }
      }
      components.push({ count, top, bottom });
    }
  }
  return components;
}

test('uses Hockey Life for the display identity while freezing technical identity and validating counters', () => {
  const { expo } = readJson('app.json');
  assert.equal(expo.name, 'Hockey Life');
  assert.equal(expo.slug, 'beer-league-hockey');
  assert.equal(expo.scheme, 'blh');
  assert.equal(expo.version, '1.0.0');
  assertCanonicalPositiveDecimalCounter(expo.ios.buildNumber);
  assert.equal(expo.ios.bundleIdentifier, 'ca.beerleaguehockey.app');
  assert.equal(expo.android.package, 'ca.beerleaguehockey.app');
  assertPositiveIntegerCounter(expo.android.versionCode);
  assert.equal(expo.owner, 'nickgrossi');
  assert.equal(expo.extra.eas.projectId, 'ed35ed7d-c5a3-415c-a7d1-ee0366a77dc3');
});

test('accepts release-independent canonical counters and rejects malformed values', () => {
  for (const value of ['1', '26', '407']) assert.doesNotThrow(() => assertCanonicalPositiveDecimalCounter(value));
  for (const value of ['', '0', '-1', '01', '1.0', '1e2', ' 2', '2 ', 2, null, undefined]) {
    assert.throws(() => assertCanonicalPositiveDecimalCounter(value), { code: 'ERR_ASSERTION' });
  }
  for (const value of [1, 26, 407]) assert.doesNotThrow(() => assertPositiveIntegerCounter(value));
  for (const value of [0, -1, 1.5, '26', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertPositiveIntegerCounter(value), { code: 'ERR_ASSERTION' });
  }
});

test('uses Hockey Life in app-owned iOS permission explanations', () => {
  const infoPlist = readJson('app.json').expo.ios.infoPlist;
  const permissionCopy = Object.values(infoPlist)
    .filter((value) => typeof value === 'string');
  assert.equal(permissionCopy.length, 1);
  for (const value of permissionCopy) {
    assert.match(value, /^Hockey Life\b/);
    assert.doesNotMatch(value, /\bBLH\b|Beer League Hockey/);
  }
  assert.equal(infoPlist.NSLocationWhenInUseUsageDescription, undefined);
  assert.equal(infoPlist.NSCameraUsageDescription, undefined);
  assert.equal(infoPlist.NSPhotoLibraryUsageDescription, undefined);
  assert.match(infoPlist.NSCalendarsUsageDescription, /calendar/i);
});

test('ships an opaque square 1024px iOS icon with the supplied dark background', () => {
  const icon = decodePng('icon.png');
  assert.deepEqual([icon.width, icon.height, icon.colorType], [1024, 1024, 2]);
  assert.deepEqual(icon.pixel(0, 0), [17, 23, 23, 255]);
  const bounds = markBounds(icon);
  assert.ok(bounds.width >= 680 && bounds.width <= 760, JSON.stringify(bounds));
  assert.ok(bounds.height >= 600 && bounds.height <= 650, JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.width / bounds.height - 661 / 570) < 0.04, JSON.stringify(bounds));
});

test('keeps every adaptive-icon mark pixel inside the Android 66/108 safe circle', () => {
  const adaptive = decodePng('adaptive-icon.png');
  assert.deepEqual([adaptive.width, adaptive.height, adaptive.colorType], [1024, 1024, 6]);
  assert.equal(adaptive.pixel(0, 0)[3], 0);
  const bounds = alphaBounds(adaptive);
  assert.ok(bounds.width >= 450 && bounds.width <= 480, JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.width / bounds.height - 661 / 570) < 0.04, JSON.stringify(bounds));
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
    assert.ok(Math.abs(bounds.width / bounds.height - 661 / 570) < 0.04, `${name}: ${JSON.stringify(bounds)}`);
  }
});

test('freezes the reviewed official three-star derivatives by digest and visible mark structure', () => {
  for (const [name, expectedHash] of Object.entries(APPROVED_THREE_STAR_ASSET_HASHES)) {
    const actualHash = createHash('sha256').update(readFileSync(assetPath(name))).digest('hex');
    assert.equal(actualHash, expectedHash, `${name} must be regenerated from the approved official source`);
  }

  const sharedMark = decodePng('hockey-life-logo.png');
  const bounds = alphaBounds(sharedMark);
  const starComponents = alphaComponents(sharedMark)
    .filter((component) => component.count >= 1000 && component.bottom < bounds.top + bounds.height * 0.22);
  assert.equal(starComponents.length, 3, 'the shared Hockey Life mark must retain exactly three separated stars');
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
