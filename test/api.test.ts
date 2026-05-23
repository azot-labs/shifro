import * as fs from 'node:fs';
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { ALL_FORMATS, EncodedPacketSink, Input as MediabunnyInput } from 'mediabunny';
import { ASSET_DATA, getHash } from './utils';
import { decryptBytes, Decryption, FilePathSource, FilePathTarget, Input, Output } from '../src';
import type {
  EncryptionPattern,
  DecryptBytesCallback,
  EncryptedPacket,
  EncryptedSample,
  Key,
  KeyId,
  SubsampleEncryption,
} from '../src';

const EXPECTED_PACKET_HASH = '485d59c0721708160acb249687ef155a61008717a0ab8a63c252c8bd8b1bc390';
const AES_BLOCK_SIZE = 16;

const decryptCtrBytes = async (options: EncryptedPacket, key: string) => {
  const decipher = createDecipheriv(
    'aes-128-ctr',
    Buffer.from(key, 'hex'),
    Buffer.from(options.iv),
  );

  return new Uint8Array(
    Buffer.concat([decipher.update(Buffer.from(options.data)), decipher.final()]),
  );
};

const encryptCtrBytes = (data: Uint8Array, key: string, iv: Uint8Array) => {
  const cipher = createCipheriv('aes-128-ctr', Buffer.from(key, 'hex'), Buffer.from(iv));

  return new Uint8Array(Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]));
};

const decryptCbcsBytes = async (options: EncryptedPacket, key: string) => {
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from(key, 'hex'),
    Buffer.from(options.iv),
  );
  decipher.setAutoPadding(false);

  return new Uint8Array(
    Buffer.concat([decipher.update(Buffer.from(options.data)), decipher.final()]),
  );
};

const encryptCbcsBytes = (data: Uint8Array, key: string, iv: Uint8Array) => {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'hex'), Buffer.from(iv));
  cipher.setAutoPadding(false);

  return new Uint8Array(Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]));
};

const collectCryptSegments = (subsamples: SubsampleEncryption[], pattern: EncryptionPattern) => {
  const segments: { offset: number; length: number }[][] = [];
  let cursor = 0;

  for (const subsample of subsamples) {
    cursor += subsample.clearLen;

    const perSubsample: { offset: number; length: number }[] = [];
    let remaining = subsample.protectedLen;
    let position = cursor;
    while (remaining > 0) {
      const cryptLen = AES_BLOCK_SIZE * pattern.cryptByteBlock;
      if (remaining < cryptLen) {
        break;
      }

      perSubsample.push({ offset: position, length: cryptLen });
      position += cryptLen;
      remaining -= cryptLen;

      const skipLen = Math.min(AES_BLOCK_SIZE * pattern.skipByteBlock, remaining);
      position += skipLen;
      remaining -= skipLen;
    }

    segments.push(perSubsample);
    cursor += subsample.protectedLen;
  }

  return segments;
};

const encryptCbcsSample = (
  sample: Uint8Array,
  key: string,
  iv: Uint8Array,
  subsamples: SubsampleEncryption[],
  pattern: EncryptionPattern,
) => {
  const output = new Uint8Array(sample);
  for (const perSubsample of collectCryptSegments(subsamples, pattern)) {
    let totalLength = 0;
    for (const segment of perSubsample) {
      totalLength += segment.length;
    }
    if (totalLength === 0) {
      continue;
    }

    const encryptedInput = new Uint8Array(totalLength);
    let writeOffset = 0;
    for (const segment of perSubsample) {
      encryptedInput.set(
        sample.subarray(segment.offset, segment.offset + segment.length),
        writeOffset,
      );
      writeOffset += segment.length;
    }

    const encrypted = encryptCbcsBytes(encryptedInput, key, iv);
    let readOffset = 0;
    for (const segment of perSubsample) {
      output.set(encrypted.subarray(readOffset, readOffset + segment.length), segment.offset);
      readOffset += segment.length;
    }
  }

  return output;
};

const encryptCtrSample = (
  sample: Uint8Array,
  key: string,
  iv: Uint8Array,
  subsamples: SubsampleEncryption[],
) => {
  const output = new Uint8Array(sample);
  let totalLength = 0;
  for (const subsample of subsamples) {
    totalLength += subsample.protectedLen;
  }

  const encryptedInput = new Uint8Array(totalLength);
  let cursor = 0;
  let writeOffset = 0;
  for (const subsample of subsamples) {
    cursor += subsample.clearLen;
    encryptedInput.set(sample.subarray(cursor, cursor + subsample.protectedLen), writeOffset);
    cursor += subsample.protectedLen;
    writeOffset += subsample.protectedLen;
  }

  const encrypted = encryptCtrBytes(encryptedInput, key, iv);
  cursor = 0;
  let readOffset = 0;
  for (const subsample of subsamples) {
    cursor += subsample.clearLen;
    output.set(encrypted.subarray(readOffset, readOffset + subsample.protectedLen), cursor);
    cursor += subsample.protectedLen;
    readOffset += subsample.protectedLen;
  }

  return output;
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

const decryptBytesWithNodeCrypto: DecryptBytesCallback = async (options) => {
  if (options.scheme === 'cbcs') {
    return decryptCbcsBytes(options, ASSET_DATA.keyValue);
  }

  return decryptCtrBytes(options, ASSET_DATA.keyValue);
};

test('decrypting file with decryptBytes helper', async () => {
  const outputPath = './test/assets/bitmovin.dec.callback.mp4';
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  const seenOptions: EncryptedPacket[] = [];
  const decryption = await Decryption.init({
    input: new Input({
      source: new FilePathSource(ASSET_DATA.inputPath),
      decryptSample: decryptBytes(async (options) => {
        seenOptions.push(options);

        expect(options.keyId).toBe(ASSET_DATA.keyId);
        expect(options.scheme).toBe('cenc');
        expect(Number.isInteger(options.timestamp)).toBe(true);
        expect(options.timestamp).toBeGreaterThanOrEqual(0);
        expect(options.data.byteLength).toBeGreaterThan(0);
        expect(options.subsamples).not.toBeUndefined();
        expect(options.pattern).not.toBeUndefined();

        return decryptBytesWithNodeCrypto(options);
      }),
    }),
    output: new Output({ target: new FilePathTarget(outputPath) }),
  });

  await decryption.execute();

  expect(seenOptions.length).toBeGreaterThan(0);
  expect(await getHash(outputPath)).not.toBe('');
  expect(await getPacketHash(outputPath)).toBe(EXPECTED_PACKET_HASH);
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
});

test('decryptBytes helper decrypts cbcs subsample pattern layouts', async () => {
  const key = '000102030405060708090a0b0c0d0e0f';
  const iv = Uint8Array.from([
    0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe, 0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01,
  ]);
  const pattern: EncryptionPattern = { cryptByteBlock: 1, skipByteBlock: 1 };
  const subsamples: SubsampleEncryption[] = [
    { clearLen: 3, protectedLen: 37 },
    { clearLen: 2, protectedLen: 48 },
    { clearLen: 1, protectedLen: 15 },
  ];
  const plaintext = Uint8Array.from({ length: 106 }, (_, index) => (index * 29) % 256);
  const encryptedSample = encryptCbcsSample(plaintext, key, iv, subsamples, pattern);

  const seenOptions: EncryptedPacket[] = [];
  const decryptSample = decryptBytes(async (options) => {
    seenOptions.push(options);
    return decryptCbcsBytes(options, key);
  });

  const decryptedSample = await decryptSample({
    data: encryptedSample,
    keyId: 'test-key-id',
    psshBoxes: [],
    scheme: 'cbcs',
    iv,
    timestamp: 123,
    subsamples,
    pattern,
  } satisfies EncryptedSample);

  expect(decryptedSample).toEqual(plaintext);
  expect(seenOptions.map((options) => options.data.byteLength)).toEqual([16, 32]);
  expect(seenOptions.every((options) => options.scheme === 'cbcs')).toBe(true);
  expect(seenOptions.map((options) => options.subsamples)).toEqual([
    [{ clearLen: 0, protectedLen: 16 }],
    [{ clearLen: 0, protectedLen: 32 }],
  ]);
  expect(seenOptions.map((options) => options.pattern)).toEqual([
    { cryptByteBlock: 1, skipByteBlock: 0 },
    { cryptByteBlock: 1, skipByteBlock: 0 },
  ]);
  expect(seenOptions.map((options) => Array.from(options.iv))).toEqual([
    Array.from(iv),
    Array.from(iv),
  ]);
});

test('decryptBytes helper normalizes subsamples for flattened ctr inputs', async () => {
  const key = '00112233445566778899aabbccddeeff';
  const iv = Uint8Array.from([
    0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x00,
  ]);
  const subsamples: SubsampleEncryption[] = [
    { clearLen: 2, protectedLen: 5 },
    { clearLen: 3, protectedLen: 7 },
  ];
  const plaintext = Uint8Array.from({ length: 17 }, (_, index) => (index * 13) % 256);
  const encryptedSample = encryptCtrSample(plaintext, key, iv, subsamples);

  const seenOptions: EncryptedPacket[] = [];
  const decryptSample = decryptBytes(async (options) => {
    seenOptions.push(options);
    return decryptCtrBytes(options, key);
  });

  const decryptedSample = await decryptSample({
    data: encryptedSample,
    keyId: 'test-key-id',
    psshBoxes: [],
    scheme: 'cenc',
    iv,
    timestamp: 789,
    subsamples,
    pattern: null,
  } satisfies EncryptedSample);

  expect(decryptedSample).toEqual(plaintext);
  expect(seenOptions).toHaveLength(1);
  expect(seenOptions[0]?.data.byteLength).toBe(12);
  expect(seenOptions[0]?.subsamples).toEqual([{ clearLen: 0, protectedLen: 12 }]);
  expect(seenOptions[0]?.pattern).toBeNull();
});

test('decryptBytes helper decrypts whole-sample cbcs data and leaves trailing bytes clear', async () => {
  const key = 'f0e0d0c0b0a090807060504030201000';
  const iv = Uint8Array.from([
    0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
  ]);
  const plaintext = Uint8Array.from({ length: 34 }, (_, index) => (index * 17) % 256);
  const encryptedSample = new Uint8Array(plaintext);
  encryptedSample.set(encryptCbcsBytes(plaintext.subarray(0, 32), key, iv), 0);

  const decryptSample = decryptBytes(async (options) => decryptCbcsBytes(options, key));
  const decryptedSample = await decryptSample({
    data: encryptedSample,
    keyId: 'test-key-id',
    psshBoxes: [],
    scheme: 'cbcs',
    iv,
    timestamp: 456,
    subsamples: null,
    pattern: null,
  } satisfies EncryptedSample);

  expect(decryptedSample).toEqual(plaintext);
});
