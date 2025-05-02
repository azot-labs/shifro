import { expect, test } from 'vitest';
import { readFirstNBytes } from '../lib/utils';
import { getInfo } from '../lib/parser/info';

test('parse encrypted mp4 info', async () => {
  const input = './test/bitmovin.enc.mp4';
  const data = await readFirstNBytes(input);
  const info = await getInfo(data);
  expect(info.kid).toBe('eb676abbcb345e96bbcf616630f1a3da');
  expect(info.scheme).toBe('cenc');
  expect(info.psshList.length).toBe(2);
});
