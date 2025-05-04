import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { test, expect } from 'vitest';
import { decryptStream } from '../shifro';
import { getHash } from '../lib/node/utils';
import { ASSET_DATA } from './utils';

const highWaterMarks = [1024 * 1024 * 10, 65536];

test('decrypt file using Node.js streams', async () => {
  for (const highWaterMark of highWaterMarks) {
    const input = ASSET_DATA.inputPath;
    const readStream = createReadStream(input, { highWaterMark });
    const readable = Readable.toWeb(readStream) as ReadableStream;

    const output = ASSET_DATA.outputPath;
    const writeStream = createWriteStream(output);
    const writable = Writable.toWeb(writeStream);

    await decryptStream(readable, writable, {
      key: ASSET_DATA.keyValue,
      keyId: ASSET_DATA.keyId,
      encryptionScheme: 'cenc',
    });

    const actualHash = await getHash(output);
    const expectedHash = 'b79dbaa6c688486de0f2a6bae50b1bbfb7396563e061e75bb8142d5e1a2e9205';
    expect(actualHash, `HighWaterMark is ${highWaterMark}`).toBe(expectedHash);
  }
});
