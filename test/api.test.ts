import fs from 'node:fs';
import { expect, test } from 'vitest';
import { ASSET_DATA, getHash } from './utils';
import { Input, FilePathSource, Output, FilePathTarget, Decryption, KeyId, Key } from '../src/main';

test('decrypting file', async () => {
  if (fs.existsSync(ASSET_DATA.outputPath)) fs.unlinkSync(ASSET_DATA.outputPath);

  const decryption = await Decryption.init({
    input: new Input({
      source: new FilePathSource(ASSET_DATA.inputPath),
      keys: new Map<KeyId, Key>([
        [ASSET_DATA.keyId, ASSET_DATA.keyValue],
      ])
    }),
    output: new Output({ target: new FilePathTarget(ASSET_DATA.outputPath) }),
  });

  await decryption.execute();

  const actualHash = await getHash(ASSET_DATA.outputPath);
  const expectedHash = '2a493ad6c16fe42afc1ae2258881dc9dad3b129f993cf818e8f0cebdd47c1b80'; // TODO: Fix
  expect(actualHash).toBe(expectedHash);
});
