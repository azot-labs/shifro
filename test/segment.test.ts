import { test, expect } from 'vitest';
import { decryptSegment } from '../mp4unbox';
import { getHash } from '../lib/node/utils';
import { appendFile, readFile, rm } from 'node:fs/promises';

// https://bitmovin.com/demos/drm

const KEY = 'eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb';

test('decrypt segment', async () => {
  const inputs = ['./test/assets/segments/_init.mp4'];
  for (let i = 0; i < 3; i++) {
    const input = `./test/assets/segments/${i.toString().padStart(2, '0')}.m4s`;
    inputs.push(input);
  }
  const output = './test/assets/bitmovin.dec.mp4';
  await rm(output, { force: true });
  const [id, value] = KEY.split(':');
  for (const input of inputs) {
    const encrypted = await readFile(input);
    const decrypted = await decryptSegment(encrypted, { keyId: id, key: value, encryptionScheme: 'cenc' });
    await appendFile(output, decrypted);
  }
  const actualHash = await getHash(output);
  const expectedHash = '888f557d88c651131b0c60f167e74a1213988ca305ed0cd89f819ac0fbba959d';
  expect(actualHash).toBe(expectedHash);
});
