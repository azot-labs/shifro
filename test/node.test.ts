import { test, expect } from 'vitest';
import { getHash } from '../lib/node/utils';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { decryptStream } from '../dempeg';

// https://bitmovin.com/demos/drm

const KEY = 'eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb';

const highWaterMarks = [1024 * 1024 * 10, 65536];

test('decrypt file using Node.js streams', async () => {
  const [id, value] = KEY.split(':');

  for (const highWaterMark of highWaterMarks) {
    const input = './test/bitmovin.enc.mp4';
    const readStream = createReadStream(input, { highWaterMark });
    const readable = Readable.toWeb(readStream) as ReadableStream;

    const output = './test/bitmovin.dec.mp4';
    const writeStream = createWriteStream(output);
    const writable = Writable.toWeb(writeStream);

    await decryptStream(readable, writable, { key: value, keyId: id, encryptionScheme: 'cenc' });

    const actualHash = await getHash(output);
    const expectedHash = 'b79dbaa6c688486de0f2a6bae50b1bbfb7396563e061e75bb8142d5e1a2e9205';
    expect(actualHash, `HighWaterMark is ${highWaterMark}`).toBe(expectedHash);
  }
});
