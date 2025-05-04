import { expect, test } from 'vitest';
import { parseInit } from '../lib/initialization';
import { readFirstNBytes, ASSET_DATA } from './utils';

test('parse mp4 initialization data', async () => {
  const data = await readFirstNBytes(ASSET_DATA.inputPath);
  const info = parseInit(data);

  expect(info.defaultKID).toBe(ASSET_DATA.keyId);
  expect(info.schemeType).toBe('cenc');
  expect(info.psshList.length).toBe(2);

  const playready = info.psshList[0];
  expect(playready.version).toBe(0);
  expect(playready.systemId).toBe('9a04f079-9840-4286-ab92-e65be0885f95');
  expect(playready.pssh).toBe(ASSET_DATA.pssh.playready);

  const widevine = info.psshList[1];
  expect(widevine.version).toBe(0);
  expect(widevine.systemId).toBe('edef8ba9-79d6-4ace-a3c8-27dcd51d21ed');
  expect(widevine.pssh).toBe(ASSET_DATA.pssh.widevine);
});
