import { appendFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { decryptSegment } from '../shifro';
import { getHash } from '../lib/node/utils';
import { ASSET_DATA } from './utils';

test('decrypt segment', async () => {
  const inputs = [join(ASSET_DATA.dir, '_init.mp4')];
  for (let i = 0; i < 3; i++) {
    inputs.push(join(ASSET_DATA.dir, `${i.toString().padStart(2, '0')}.m4s`));
  }
  const output = ASSET_DATA.outputPath;
  await rm(output, { force: true });
  for (const input of inputs) {
    const encrypted = await readFile(input);
    const decrypted = await decryptSegment(encrypted, {
      keyId: ASSET_DATA.keyId,
      key: ASSET_DATA.keyValue,
      encryptionScheme: 'cenc',
    });
    await appendFile(output, decrypted);
  }
  const actualHash = await getHash(output);
  const expectedHash = '888f557d88c651131b0c60f167e74a1213988ca305ed0cd89f819ac0fbba959d';
  expect(actualHash).toBe(expectedHash);
});
