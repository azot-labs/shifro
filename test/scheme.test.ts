import { expect, test } from 'vitest';
import { getEncryptionScheme, readFirstNBytes } from '../lib/mp4-parser/info';

test('parsing encryption scheme from encrypted mp4', async () => {
  const input = './test/bitmovin.enc.mp4';
  const data = await readFirstNBytes(input);
  const scheme = await getEncryptionScheme(data);
  expect(scheme).toBe('cenc');
});
