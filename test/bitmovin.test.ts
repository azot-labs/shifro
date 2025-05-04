import { test, expect } from 'vitest';
import { decryptFile } from '../dempeg';
import { getHash } from '../lib/node/utils';

// https://bitmovin.com/demos/drm

const KEY = 'eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb';

test('bitmovin decryption', async () => {
  const [id, value] = KEY.split(':');
  const input = './test/bitmovin.enc.mp4';
  const output = './test/bitmovin.dec.mp4';
  await decryptFile(input, output, { key: value });
  const actualHash = await getHash(output);
  const expectedHash = 'b79dbaa6c688486de0f2a6bae50b1bbfb7396563e061e75bb8142d5e1a2e9205';
  expect(actualHash).toBe(expectedHash);
});
