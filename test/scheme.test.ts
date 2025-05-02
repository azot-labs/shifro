import { expect, test } from 'vitest';
import { getEncryptionScheme } from '../lib/mp4-parser/scheme';
import { readFirstNBytes } from '../lib/mp4-parser/utils';

test('parsing encryption scheme from encrypted mp4', async () => {
  const input = './test/bitmovin.enc.mp4';
  const data = await readFirstNBytes(input);
  const scheme = await getEncryptionScheme(data);
  expect(scheme).toBe('cenc');
});
