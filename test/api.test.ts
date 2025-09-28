import fs from 'node:fs';
import { expect, test } from 'vitest';
import { ASSET_DATA, getHash } from './utils';
import { Input, FilePathSource, Output, FilePathTarget, Decryption } from '../src/api';

test('decrypting with new api', async () => {
  if (fs.existsSync(ASSET_DATA.outputPath)) fs.unlinkSync(ASSET_DATA.outputPath);

  const input = new Input({ source: new FilePathSource(ASSET_DATA.inputPath) });
  const output = new Output({ target: new FilePathTarget(ASSET_DATA.outputPath) });
  const decryption = await Decryption.init({
    input,
    output,
    keys: [{ kid: ASSET_DATA.keyId, key: ASSET_DATA.keyValue }],
  });
  await decryption.execute();

  const actualHash = await getHash(ASSET_DATA.outputPath);
  const expectedHash = '2c67ffe1ac57c28b276fb3a9499d48245b990cd65647d0bde76f37f26adfc39c';
  expect(actualHash).toBe(expectedHash);
});
