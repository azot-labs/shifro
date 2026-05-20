import * as fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { expect, test } from 'vitest';
import { ALL_FORMATS, EncodedPacketSink, Input as MediabunnyInput } from 'mediabunny';
import { ASSET_DATA, getHash } from './utils';
import { Decryption, FilePathSource, FilePathTarget, Input, Output } from '../src';
import type {
  IsobmffDecryptProtectedDataOptions,
  Key,
  KeyId,
} from '../src';

const EXPECTED_PACKET_HASH = '485d59c0721708160acb249687ef155a61008717a0ab8a63c252c8bd8b1bc390';

const decryptCtrProtectedData = async (
  options: IsobmffDecryptProtectedDataOptions,
  key: string,
) => {
  const counter = new Uint8Array(16);
  counter.set(options.iv, 0);

  const cryptoKey = await webcrypto.subtle.importKey(
    'raw',
    Buffer.from(key, 'hex'),
    { name: 'AES-CTR' },
    false,
    ['decrypt'],
  );

  const cryptApply = async (input: Uint8Array) => {
    const plaintext = await webcrypto.subtle.decrypt(
      { name: 'AES-CTR', counter, length: 64 },
      cryptoKey,
      Buffer.from(input),
    );
    return new Uint8Array(plaintext);
  };

  return cryptApply(options.data);
};

const getPacketHash = async (path: string) => {
  const input = new MediabunnyInput({
    source: new FilePathSource(path),
    formats: ALL_FORMATS,
  });
  const [track] = await input.getTracks();
  const sink = new EncodedPacketSink(track!);
  const hash = createHash('sha256');

  for await (const packet of sink.packets(undefined, undefined, {})) {
    hash.update(packet.data);
  }

  return hash.digest('hex');
};

test('decrypting file', async () => {
  if (fs.existsSync(ASSET_DATA.outputPath)) fs.unlinkSync(ASSET_DATA.outputPath);

  const decryption = await Decryption.init({
    input: new Input({
      source: new FilePathSource(ASSET_DATA.inputPath),
      keys: new Map<KeyId, Key>([[ASSET_DATA.keyId, ASSET_DATA.keyValue]]),
    }),
    output: new Output({ target: new FilePathTarget(ASSET_DATA.outputPath) }),
  });

  await decryption.execute();

  expect(await getHash(ASSET_DATA.outputPath)).not.toBe('');
  expect(await getPacketHash(ASSET_DATA.outputPath)).toBe(EXPECTED_PACKET_HASH);
});

test('decrypting file with decryptProtectedData callback', async () => {
  const outputPath = './test/assets/bitmovin.dec.callback.mp4';
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  const seenOptions: IsobmffDecryptProtectedDataOptions[] = [];
  const decryption = await Decryption.init({
    input: new Input({
      source: new FilePathSource(ASSET_DATA.inputPath),
      decryptProtectedData: async (options) => {
        seenOptions.push(options);

        expect(options.keyId).toBe(ASSET_DATA.keyId);
        expect(options.scheme).toBe('cenc');
        expect(options.subsamples).toEqual([
          {
            clearLen: 0,
            protectedLen: options.data.byteLength,
          },
        ]);
        expect(options.pattern).toBeNull();

        return decryptCtrProtectedData(options, ASSET_DATA.keyValue);
      },
    }),
    output: new Output({ target: new FilePathTarget(outputPath) }),
  });

  await decryption.execute();

  expect(seenOptions.length).toBeGreaterThan(0);

  expect(await getHash(outputPath)).not.toBe('');
  expect(await getPacketHash(outputPath)).toBe(EXPECTED_PACKET_HASH);
});
