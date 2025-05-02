import { test, expect } from 'vitest';
import { getDefaultKid } from '../lib/mp4-parser/kid';
import { readFirstNBytes } from '../lib/mp4-parser/utils';

test('parsing default kid from encrypted mp4', async () => {
  const input = './test/bitmovin.enc.mp4';
  const data = await readFirstNBytes(input);
  const kid = await getDefaultKid(data);
  expect(kid).toBe('eb676abbcb345e96bbcf616630f1a3da');
});
