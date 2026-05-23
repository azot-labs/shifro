import type { MaybePromise, PsshBox } from 'mediabunny';

export type KeyId = string;
export type Key = string;
export type KeyMap = Map<KeyId, Key>;

export type EncryptionScheme = 'cenc' | 'cens' | 'cbcs';

export type SubsampleEncryption = {
  /** Number of clear bytes that appear before the protected bytes in this subsample. */
  clearLen: number;
  /** Number of encrypted bytes in this subsample. */
  protectedLen: number;
};

export type EncryptionPattern = {
  /** Number of consecutive 16-byte blocks that are encrypted in each pattern step. */
  cryptByteBlock: number;
  /** Number of consecutive 16-byte blocks that are skipped in each pattern step. */
  skipByteBlock: number;
};

export type EncryptionInfo = {
  /** Key ID from the track encryption metadata. */
  keyId: string;
  /** PSSH boxes associated with this key/sample and useful for DRM-specific key resolution. */
  psshBoxes: PsshBox[];
  /** Sample encryption scheme. */
  scheme: EncryptionScheme;
  /** Per-sample IV resolved from container metadata. */
  iv: Uint8Array;
  /** Presentation timestamp of the sample in microseconds. */
  timestamp: number;
  /** Subsample layout describing which parts of `data` are clear vs protected, or `null` for whole-sample encryption. */
  subsamples: SubsampleEncryption[] | null;
  /** Pattern encryption parameters, or `null` when no pattern is used. */
  pattern: EncryptionPattern | null;
};

/**
 * Options passed to {@link DecryptSample}.
 *
 * This is the advanced callback contract. `data` contains the full sample bytes exactly as they appear in the
 * container, including any clear regions. `subsamples` and `pattern` describe which parts of `data` are protected.
 *
 * Use this callback when the decryption backend needs the original sample layout, or when working with content
 * that cannot be safely represented as a single flattened protected-byte stream, such as patterned `cbcs`
 * subsample encryption.
 */
export type EncryptedSample = EncryptionInfo & {
  /** Full sample bytes as stored in the container. Clear and protected regions are both present in this buffer. */
  data: Uint8Array;
};

/**
 * Options passed to {@link decryptBytes}.
 *
 * `data` contains only the bytes that still need decryption. When the helper has flattened clear or skipped regions
 * out of the original sample, `subsamples` and `pattern` are normalized to describe this callback buffer instead of
 * the original sample layout.
 */
export type EncryptedPacket = EncryptionInfo & {
  /** Only the encrypted bytes that should be decrypted. Clear sample bytes are not included. */
  data: Uint8Array;
};

/**
 * Advanced sample decryption callback.
 *
 * The callback receives the full encrypted sample layout and must return the fully decrypted sample bytes with the
 * exact same length. This is the most general integration point and should be used when a backend needs explicit
 * subsample and pattern metadata.
 */
export type DecryptSample = (options: EncryptedSample) => MaybePromise<Uint8Array>;

/** Raw byte decryption callback used by {@link decryptBytes}. */
export type DecryptBytesCallback = (options: EncryptedPacket) => MaybePromise<Uint8Array>;

type ByteRange = {
  offset: number;
  length: number;
};

type ByteRangeGroup = {
  iv: Uint8Array;
  ranges: ByteRange[];
};

const AES_BLOCK_SIZE = 16;

const isUint8Array = (value: unknown): value is Uint8Array => value instanceof Uint8Array;

const normalizeSubsamples = (
  subsamples: SubsampleEncryption[] | null,
  protectedLength: number,
): SubsampleEncryption[] | null => {
  if (!subsamples) return null;
  return [{ clearLen: 0, protectedLen: protectedLength }];
};

const normalizePattern = (
  scheme: EncryptionScheme,
  pattern: EncryptionPattern | null,
): EncryptionPattern | null => {
  if (!pattern || scheme !== 'cbcs') return null;
  return { cryptByteBlock: 1, skipByteBlock: 0 };
};

const collectProtectedRanges = (
  offset: number,
  protectedLen: number,
  pattern: EncryptionPattern | null,
  fullBlocksOnly: boolean,
) => {
  if (!pattern) {
    const length = fullBlocksOnly ? protectedLen - (protectedLen % AES_BLOCK_SIZE) : protectedLen;

    return length > 0 ? [{ offset, length }] : [];
  }

  if (pattern.cryptByteBlock <= 0) {
    return [];
  }

  const ranges: ByteRange[] = [];
  const cryptLen = AES_BLOCK_SIZE * pattern.cryptByteBlock;
  const skipLen = AES_BLOCK_SIZE * pattern.skipByteBlock;

  let remaining = protectedLen;
  let position = offset;
  while (remaining > 0) {
    if (remaining < cryptLen) {
      break;
    }

    ranges.push({ offset: position, length: cryptLen });
    position += cryptLen;
    remaining -= cryptLen;

    const currentSkipLen = Math.min(skipLen, remaining);
    position += currentSkipLen;
    remaining -= currentSkipLen;
  }

  return ranges;
};

const collectCtrRanges = (options: EncryptedSample) => {
  if (!options.subsamples) {
    return [{ offset: 0, length: options.data.byteLength }];
  }

  const ranges: ByteRange[] = [];
  let cursor = 0;
  for (const subsample of options.subsamples) {
    cursor += subsample.clearLen;
    ranges.push(...collectProtectedRanges(cursor, subsample.protectedLen, options.pattern, false));
    cursor += subsample.protectedLen;
  }

  return ranges;
};

const collectCbcsGroups = (options: EncryptedSample): ByteRangeGroup[] => {
  if (!options.subsamples) {
    return [
      {
        iv: options.iv.slice(),
        ranges: [
          {
            offset: 0,
            length: options.data.byteLength - (options.data.byteLength % AES_BLOCK_SIZE),
          },
        ],
      },
    ];
  }

  if (!options.pattern) {
    throw new Error(
      'decryptBytes does not support cbcs subsample encryption without pattern encryption.',
    );
  }

  const groups: ByteRangeGroup[] = [];
  let cursor = 0;
  for (const subsample of options.subsamples) {
    cursor += subsample.clearLen;
    groups.push({
      iv: options.iv.slice(),
      ranges: collectProtectedRanges(cursor, subsample.protectedLen, options.pattern, true),
    });
    cursor += subsample.protectedLen;
  }

  return groups;
};

const getRangeData = (data: Uint8Array, ranges: ByteRange[]) => {
  let totalLength = 0;
  for (const range of ranges) {
    totalLength += range.length;
  }

  const protectedData = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const range of ranges) {
    protectedData.set(data.subarray(range.offset, range.offset + range.length), writeOffset);
    writeOffset += range.length;
  }

  return protectedData;
};

const mergeRangeData = (target: Uint8Array, decryptedData: Uint8Array, ranges: ByteRange[]) => {
  let readOffset = 0;
  for (const range of ranges) {
    target.set(decryptedData.subarray(readOffset, readOffset + range.length), range.offset);
    readOffset += range.length;
  }
};

const decryptGroups = async (
  options: EncryptedSample,
  groups: ByteRangeGroup[],
  decryptBytesCallback: DecryptBytesCallback,
) => {
  const decryptedSample = new Uint8Array(options.data);

  for (const group of groups) {
    const encryptedData = getRangeData(options.data, group.ranges);
    if (encryptedData.byteLength === 0) {
      continue;
    }

    const decryptedData = await decryptBytesCallback({
      data: encryptedData,
      keyId: options.keyId,
      psshBoxes: options.psshBoxes,
      scheme: options.scheme,
      iv: group.iv.slice(),
      timestamp: options.timestamp,
      subsamples: normalizeSubsamples(options.subsamples, encryptedData.byteLength),
      pattern: normalizePattern(options.scheme, options.pattern),
    });

    if (!isUint8Array(decryptedData)) {
      throw new TypeError('decryptBytes callback must return a Uint8Array.');
    }
    if (decryptedData.byteLength !== encryptedData.byteLength) {
      throw new Error(
        'decryptBytes callback must return the same number of bytes as the encrypted input.',
      );
    }

    mergeRangeData(decryptedSample, decryptedData, group.ranges);
  }

  return decryptedSample;
};

export const decryptBytes =
  (decryptBytesCallback: DecryptBytesCallback): DecryptSample =>
  async (options) => {
    if (options.scheme === 'cbcs') {
      return decryptGroups(options, collectCbcsGroups(options), decryptBytesCallback);
    }

    return decryptGroups(
      options,
      [{ iv: options.iv.slice(), ranges: collectCtrRanges(options) }],
      decryptBytesCallback,
    );
  };
