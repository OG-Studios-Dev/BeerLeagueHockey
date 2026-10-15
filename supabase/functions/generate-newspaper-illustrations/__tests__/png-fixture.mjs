import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  Buffer.from(data).copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length);
  return result;
}

/** A real, completely encoded 1024x1024 RGB PNG with synthetic solid pixels. */
export function syntheticPng1024(marker = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1024, 0);
  header.writeUInt32BE(1024, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc((1024 * 3 + 1) * 1024);
  for (let row = 0; row < 1024; row += 1) {
    const start = row * (1024 * 3 + 1);
    scanlines[start] = 0;
    for (let column = 0; column < 1024; column += 1) {
      const pixel = start + 1 + column * 3;
      scanlines[pixel] = marker;
      scanlines[pixel + 1] = 40;
      scanlines[pixel + 2] = 80;
    }
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
