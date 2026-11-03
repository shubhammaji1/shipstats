import { deflateSync } from 'node:zlib';

// Valid, deterministic PNG bytes for the export-bridge tests, not a visual card fixture.
export function cardPng(width = 1200, height = 630): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length, 0); result.write(type, 4); data.copy(result, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
