import { expect, test } from 'vitest';
import { getInfo } from '../lib/mp4-parser/info';
import { readFirstNBytes } from '../lib/mp4-parser/utils';

test('parse encrypted mp4 info', async () => {
  const input = './test/bitmovin.enc.mp4';
  const data = await readFirstNBytes(input);
  const info = await getInfo(data);
  expect(info.kid).toBe('eb676abbcb345e96bbcf616630f1a3da');
  expect(info.scheme).toBe('cenc');
  expect(info.psshList.length).toBe(2);
});
