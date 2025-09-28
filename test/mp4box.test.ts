import { expect, test } from 'vitest';
import { ASSET_DATA } from './utils';
import { getHash } from '../lib/node/utils';
import { decrypt } from '../lib/mp4box';

test('decrypting with mp4box.js', async () => {
  const output = await decrypt({
    inputPath: ASSET_DATA.inputPath,
    outputPath: ASSET_DATA.outputPath,
    key: ASSET_DATA.keyValue,
    keyId: ASSET_DATA.keyId,
  });
  const actualHash = await getHash(output);
  const expectedHash = '2c67ffe1ac57c28b276fb3a9499d48245b990cd65647d0bde76f37f26adfc39c';
  expect(actualHash).toBe(expectedHash);
});
