import { expect, test } from 'vitest';
import { readFirstNBytes } from '../lib/utils';
import { getEncryptionScheme } from '../lib/parser/scheme';

test('parsing encryption scheme from encrypted mp4', async () => {
  const input = './test/bitmovin.enc.mp4';
  const data = await readFirstNBytes(input);
  const scheme = await getEncryptionScheme(data);
  expect(scheme).toBe('cenc');
});
