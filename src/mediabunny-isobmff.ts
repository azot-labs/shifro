import type { EncodedPacket, PacketRetrievalOptions, PsshBox } from 'mediabunny';
import type { EncryptionPattern, IsobmffScheme, SubsampleEncryption } from './decrypt-sample';

type SampleTimingEntry = {
  startIndex: number;
  count: number;
  delta: number;
  startDecodeTimestamp: number;
};

type SampleCompositionTimeOffsetEntry = {
  startIndex: number;
  count: number;
  offset: number;
};

type SampleToChunkEntry = {
  startSampleIndex: number;
  startChunkIndex: number;
  samplesPerChunk: number;
};

type SampleTable = {
  sampleTimingEntries: SampleTimingEntry[];
  sampleCompositionTimeOffsets: SampleCompositionTimeOffsetEntry[];
  sampleSizes: number[];
  keySampleIndices: number[] | null;
  chunkOffsets: number[];
  sampleToChunk: SampleToChunkEntry[];
  presentationTimestamps:
    | {
        presentationTimestamp: number;
        sampleIndex: number;
      }[]
    | null;
  presentationTimestampIndexMap: number[] | null;
};

type TrackEncryptionInfo = {
  scheme: IsobmffScheme;
  defaultKid: string | null;
  defaultIsProtected: boolean | null;
  defaultPerSampleIvSize: number | null;
  defaultConstantIv: Uint8Array | null;
  defaultCryptByteBlock: number | null;
  defaultSkipByteBlock: number | null;
};

export type SampleEncryptionInfo = {
  iv: Uint8Array;
  subsamples: SubsampleEncryption[] | null;
};

type SampleEncryptionAuxInfo = {
  defaultSampleInfoSize: number;
  sampleSizes: number[] | null;
  sampleCount: number;
  offset: number | null;
  resolved: SampleEncryptionInfo[] | null;
};

type FragmentTrackSample = {
  byteOffset: number;
  byteSize: number;
  encryption: SampleEncryptionInfo | null;
};

type FragmentTrackData = {
  samples: FragmentTrackSample[];
};

export type Fragment = {
  trackData: Map<number, FragmentTrackData>;
  psshBoxes: PsshBox[];
};

export type ProtectedDataLayout = {
  data: Uint8Array;
  merge: (decryptedData: Uint8Array) => Uint8Array;
};

type FileSliceLike = {
  bytes: Uint8Array;
  view: DataView;
  bufferPos: number;
};

type InternalTrack = {
  id: number;
  demuxer: {
    psshBoxes: PsshBox[];
    reader: {
      requestSlice: (
        start: number,
        length: number,
      ) => FileSliceLike | Promise<FileSliceLike | null> | null;
    };
    getSampleTableForTrack: (track: InternalTrack) => SampleTable;
  };
  encryptionInfo: TrackEncryptionInfo | null;
  encryptionAuxInfo: SampleEncryptionAuxInfo | null;
};

export type IsobmffTrackBacking = {
  internalTrack: InternalTrack;
  packetToSampleIndex: WeakMap<EncodedPacket, number>;
  packetToFragmentLocation: WeakMap<
    EncodedPacket,
    {
      fragment: Fragment;
      sampleIndex: number;
    }
  >;
  getFirstPacket: (options: PacketRetrievalOptions) => Promise<EncodedPacket | null>;
  getPacket: (timestamp: number, options: PacketRetrievalOptions) => Promise<EncodedPacket | null>;
  getNextPacket: (
    packet: EncodedPacket,
    options: PacketRetrievalOptions,
  ) => Promise<EncodedPacket | null>;
  getKeyPacket: (
    timestamp: number,
    options: PacketRetrievalOptions,
  ) => Promise<EncodedPacket | null>;
  getNextKeyPacket: (
    packet: EncodedPacket,
    options: PacketRetrievalOptions,
  ) => Promise<EncodedPacket | null>;
};

type SampleInfo = {
  presentationTimestamp: number;
  duration: number;
  sampleOffset: number;
  sampleSize: number;
  chunkOffset: number;
  chunkSize: number;
  isKeyFrame: boolean;
};

const binarySearchLessOrEqual = <T>(items: T[], needle: number, getValue: (item: T) => number) => {
  let low = 0;
  let high = items.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const value = getValue(items[middle]!);

    if (value <= needle) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
};

const binarySearchExact = <T>(items: T[], needle: number, getValue: (item: T) => number) => {
  let low = 0;
  let high = items.length - 1;

  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const value = getValue(items[middle]!);

    if (value === needle) {
      return middle;
    }
    if (value < needle) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return -1;
};

const readBytes = (slice: FileSliceLike, length: number) => {
  const bytes = slice.bytes.slice(slice.bufferPos, slice.bufferPos + length);
  slice.bufferPos += length;
  return bytes;
};

const readU16Be = (slice: FileSliceLike) => {
  const value = slice.view.getUint16(slice.bufferPos, false);
  slice.bufferPos += 2;
  return value;
};

const readU32Be = (slice: FileSliceLike) => {
  const value = slice.view.getUint32(slice.bufferPos, false);
  slice.bufferPos += 4;
  return value;
};

const readSampleBytes = async (
  internalTrack: InternalTrack,
  byteOffset: number,
  byteLength: number,
) => {
  let slice = internalTrack.demuxer.reader.requestSlice(byteOffset, byteLength);
  if (slice instanceof Promise) {
    slice = await slice;
  }

  if (!slice) {
    throw new Error('Failed to read encrypted sample bytes.');
  }

  return readBytes(slice, byteLength);
};

const resolveEncryptionAuxInfo = async (
  internalTrack: InternalTrack,
  auxInfo: SampleEncryptionAuxInfo,
) => {
  if (auxInfo.resolved) {
    return auxInfo.resolved;
  }

  const encryptionInfo = internalTrack.encryptionInfo;
  if (!encryptionInfo || encryptionInfo.defaultPerSampleIvSize === null) {
    throw new Error('Missing track encryption info.');
  }
  if (auxInfo.offset === null || auxInfo.sampleCount === 0) {
    throw new Error('Incomplete saiz/saio info; cannot resolve encryption data.');
  }
  if (auxInfo.defaultSampleInfoSize === 0 && !auxInfo.sampleSizes) {
    throw new Error(
      'Invalid auxiliary encryption info: auxInfo.sampleSizes is required when'
      + ' auxInfo.defaultSampleInfoSize is 0.',
    );
  }

  let totalSize = 0;
  if (auxInfo.defaultSampleInfoSize > 0) {
    totalSize = auxInfo.defaultSampleInfoSize * auxInfo.sampleCount;
  } else if (auxInfo.sampleSizes) {
    for (const size of auxInfo.sampleSizes) {
      totalSize += size;
    }
  }

  let slice = internalTrack.demuxer.reader.requestSlice(auxInfo.offset, totalSize);
  if (slice instanceof Promise) {
    slice = await slice;
  }

  if (!slice) {
    throw new Error('Failed to read auxiliary encryption info.');
  }

  const entries: SampleEncryptionInfo[] = [];
  const ivSize = encryptionInfo.defaultPerSampleIvSize;
  for (let i = 0; i < auxInfo.sampleCount; i++) {
    const entrySize =
      auxInfo.defaultSampleInfoSize > 0
        ? auxInfo.defaultSampleInfoSize
        : (auxInfo.sampleSizes?.[i] ?? 0);

    const iv = new Uint8Array(16);
    if (ivSize > 0) {
      iv.set(readBytes(slice, ivSize), 0);
    } else if (encryptionInfo.defaultConstantIv) {
      iv.set(encryptionInfo.defaultConstantIv, 0);
    }

    let subsamples: SubsampleEncryption[] | null = null;
    if (entrySize > ivSize) {
      const subsampleCount = readU16Be(slice);
      subsamples = [];
      for (let j = 0; j < subsampleCount; j++) {
        subsamples.push({
          clearLen: readU16Be(slice),
          protectedLen: readU32Be(slice),
        });
      }
    }

    entries.push({ iv, subsamples });
  }

  auxInfo.resolved = entries;
  return entries;
};

const getSampleInfo = (sampleTable: SampleTable, sampleIndex: number): SampleInfo | null => {
  const timingEntryIndex = binarySearchLessOrEqual(
    sampleTable.sampleTimingEntries,
    sampleIndex,
    (entry) => entry.startIndex,
  );
  const timingEntry = sampleTable.sampleTimingEntries[timingEntryIndex];
  if (!timingEntry || timingEntry.startIndex + timingEntry.count <= sampleIndex) {
    return null;
  }

  const decodeTimestamp =
    timingEntry.startDecodeTimestamp + (sampleIndex - timingEntry.startIndex) * timingEntry.delta;
  let presentationTimestamp = decodeTimestamp;

  const offsetEntryIndex = binarySearchLessOrEqual(
    sampleTable.sampleCompositionTimeOffsets,
    sampleIndex,
    (entry) => entry.startIndex,
  );
  const offsetEntry = sampleTable.sampleCompositionTimeOffsets[offsetEntryIndex];
  if (offsetEntry && sampleIndex - offsetEntry.startIndex < offsetEntry.count) {
    presentationTimestamp += offsetEntry.offset;
  }

  const sampleSize =
    sampleTable.sampleSizes[Math.min(sampleIndex, sampleTable.sampleSizes.length - 1)];
  if (sampleSize === undefined) {
    return null;
  }

  const chunkEntryIndex = binarySearchLessOrEqual(
    sampleTable.sampleToChunk,
    sampleIndex,
    (entry) => entry.startSampleIndex,
  );
  const chunkEntry = sampleTable.sampleToChunk[chunkEntryIndex];
  if (!chunkEntry) {
    return null;
  }

  const chunkIndex =
    chunkEntry.startChunkIndex +
    Math.floor((sampleIndex - chunkEntry.startSampleIndex) / chunkEntry.samplesPerChunk);
  const chunkOffset = sampleTable.chunkOffsets[chunkIndex];
  if (chunkOffset === undefined) {
    return null;
  }

  const startSampleIndexOfChunk =
    chunkEntry.startSampleIndex +
    (chunkIndex - chunkEntry.startChunkIndex) * chunkEntry.samplesPerChunk;

  let chunkSize = 0;
  let sampleOffset = chunkOffset;
  if (sampleTable.sampleSizes.length === 1) {
    sampleOffset += sampleSize * (sampleIndex - startSampleIndexOfChunk);
    chunkSize += sampleSize * chunkEntry.samplesPerChunk;
  } else {
    for (
      let i = startSampleIndexOfChunk;
      i < startSampleIndexOfChunk + chunkEntry.samplesPerChunk;
      i++
    ) {
      const currentSampleSize = sampleTable.sampleSizes[i];
      if (currentSampleSize === undefined) {
        return null;
      }

      if (i < sampleIndex) {
        sampleOffset += currentSampleSize;
      }
      chunkSize += currentSampleSize;
    }
  }

  let duration = timingEntry.delta;
  if (sampleTable.presentationTimestamps && sampleTable.presentationTimestampIndexMap) {
    const presentationIndex = sampleTable.presentationTimestampIndexMap[sampleIndex];
    if (
      presentationIndex !== undefined &&
      presentationIndex < sampleTable.presentationTimestamps.length - 1
    ) {
      const nextEntry = sampleTable.presentationTimestamps[presentationIndex + 1];
      if (nextEntry) {
        duration = nextEntry.presentationTimestamp - presentationTimestamp;
      }
    }
  }

  const isKeyFrame = sampleTable.keySampleIndices
    ? binarySearchExact(sampleTable.keySampleIndices, sampleIndex, (value) => value) !== -1
    : true;

  return {
    presentationTimestamp,
    duration,
    sampleOffset,
    sampleSize,
    chunkOffset,
    chunkSize,
    isKeyFrame,
  };
};

const psshBoxesAreEqual = (left: PsshBox, right: PsshBox) => {
  if (left.systemId !== right.systemId) {
    return false;
  }
  if (left.data.byteLength !== right.data.byteLength) {
    return false;
  }

  for (let i = 0; i < left.data.byteLength; i++) {
    if (left.data[i] !== right.data[i]) {
      return false;
    }
  }

  return true;
};

const collectCryptRanges = (
  subsamples: SubsampleEncryption[],
  cryptByteBlock: number,
  skipByteBlock: number,
) => {
  const ranges: { offset: number; length: number }[] = [];
  const hasPattern = cryptByteBlock !== 0 || skipByteBlock !== 0;

  let cursor = 0;
  for (const subsample of subsamples) {
    cursor += subsample.clearLen;

    if (!hasPattern) {
      if (subsample.protectedLen > 0) {
        ranges.push({ offset: cursor, length: subsample.protectedLen });
      }
      cursor += subsample.protectedLen;
      continue;
    }

    let remaining = subsample.protectedLen;
    let position = cursor;
    while (remaining > 0) {
      if (remaining < 16 * cryptByteBlock) {
        break;
      }

      const cryptLength = 16 * cryptByteBlock;
      ranges.push({ offset: position, length: cryptLength });
      position += cryptLength;
      remaining -= cryptLength;

      const skipLength = Math.min(16 * skipByteBlock, remaining);
      position += skipLength;
      remaining -= skipLength;
    }

    cursor += subsample.protectedLen;
  }

  return ranges;
};

export const cloneSubsamples = (
  subsamples: SubsampleEncryption[] | null,
): SubsampleEncryption[] | null => {
  if (!subsamples) {
    return null;
  }

  return subsamples.map((subsample) => ({
    clearLen: subsample.clearLen,
    protectedLen: subsample.protectedLen,
  }));
};

export const getPattern = (encryptionInfo: TrackEncryptionInfo): EncryptionPattern | null => {
  const cryptByteBlock = encryptionInfo.defaultCryptByteBlock ?? 0;
  const skipByteBlock = encryptionInfo.defaultSkipByteBlock ?? 0;

  if (cryptByteBlock === 0 && skipByteBlock === 0) {
    return null;
  }

  return { cryptByteBlock, skipByteBlock };
};

export const createProtectedDataLayout = (
  data: Uint8Array,
  encryptionInfo: TrackEncryptionInfo,
  sampleEncryption: SampleEncryptionInfo,
): ProtectedDataLayout | null => {
  if (!sampleEncryption.subsamples) {
    return {
      data,
      merge: (decryptedData) => new Uint8Array(decryptedData),
    };
  }

  if (encryptionInfo.scheme === 'cbcs') {
    return null;
  }

  const cryptRanges = collectCryptRanges(
    sampleEncryption.subsamples,
    encryptionInfo.defaultCryptByteBlock ?? 0,
    encryptionInfo.defaultSkipByteBlock ?? 0,
  );

  let totalCryptLength = 0;
  for (const range of cryptRanges) {
    totalCryptLength += range.length;
  }

  const protectedData = new Uint8Array(totalCryptLength);
  let writeOffset = 0;
  for (const range of cryptRanges) {
    protectedData.set(data.subarray(range.offset, range.offset + range.length), writeOffset);
    writeOffset += range.length;
  }

  return {
    data: protectedData,
    merge: (decryptedData) => {
      const merged = new Uint8Array(data);
      let readOffset = 0;
      for (const range of cryptRanges) {
        merged.set(
          decryptedData.subarray(readOffset, readOffset + range.length),
          range.offset,
        );
        readOffset += range.length;
      }
      return merged;
    },
  };
};

export const isUint8Array = (value: unknown): value is Uint8Array => value instanceof Uint8Array;

export const isIsobmffTrackBacking = (backing: unknown): backing is IsobmffTrackBacking => {
  if (!backing || typeof backing !== 'object') {
    return false;
  }

  const maybeBacking = backing as Partial<IsobmffTrackBacking>;
  const internalTrack = maybeBacking.internalTrack;

  return Boolean(
    internalTrack &&
    internalTrack.demuxer &&
    typeof internalTrack.demuxer.getSampleTableForTrack === 'function' &&
    maybeBacking.packetToSampleIndex instanceof WeakMap &&
    maybeBacking.packetToFragmentLocation instanceof WeakMap,
  );
};

export const getTrackEncryptionInfo = (backing: IsobmffTrackBacking) =>
  backing.internalTrack.encryptionInfo;

export const getKeyId = (backing: IsobmffTrackBacking) =>
  backing.internalTrack.encryptionInfo?.defaultKid ?? null;

export const getEncryptedSample = async (
  backing: IsobmffTrackBacking,
  packet: EncodedPacket,
): Promise<{
  data: Uint8Array;
  sampleEncryption: SampleEncryptionInfo;
  fragment: Fragment | null;
} | null> => {
  const internalTrack = backing.internalTrack;

  const fragmentLocation = backing.packetToFragmentLocation.get(packet);
  if (fragmentLocation) {
    const fragment = fragmentLocation.fragment;
    const trackData = fragment.trackData.get(internalTrack.id);
    const sample = trackData?.samples[fragmentLocation.sampleIndex];
    if (!sample?.encryption) {
      return null;
    }

    return {
      data: await readSampleBytes(internalTrack, sample.byteOffset, sample.byteSize),
      sampleEncryption: sample.encryption,
      fragment,
    };
  }

  const sampleIndex = backing.packetToSampleIndex.get(packet);
  if (sampleIndex === undefined) {
    return null;
  }

  const sampleTable = internalTrack.demuxer.getSampleTableForTrack(internalTrack);
  const sampleInfo = getSampleInfo(sampleTable, sampleIndex);
  if (!sampleInfo) {
    return null;
  }

  const auxInfo = internalTrack.encryptionAuxInfo;
  if (!auxInfo) {
    return null;
  }

  const encryptionEntries = await resolveEncryptionAuxInfo(internalTrack, auxInfo);
  const sampleEncryption = encryptionEntries[sampleIndex];
  if (!sampleEncryption) {
    return null;
  }

  return {
    data: await readSampleBytes(internalTrack, sampleInfo.sampleOffset, sampleInfo.sampleSize),
    sampleEncryption,
    fragment: null,
  };
};

export const getPsshBoxes = (
  backing: IsobmffTrackBacking,
  keyId: string,
  fragment: Fragment | null,
) => {
  const { psshBoxes } = backing.internalTrack.demuxer;
  if (!fragment) {
    return psshBoxes;
  }

  const boxes = [...psshBoxes, ...fragment.psshBoxes].filter(
    (psshBox) => psshBox.keyIds === null || psshBox.keyIds.includes(keyId),
  );

  for (let i = 0; i < boxes.length - 1; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (psshBoxesAreEqual(boxes[i]!, boxes[j]!)) {
        boxes.splice(j, 1);
        j--;
      }
    }
  }

  return boxes;
};
