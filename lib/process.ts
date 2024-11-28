import { decryptInitChunk, isInitializationSegment } from './initialization';
import { findMpegBoxByName, parseMpegBoxes, replaceBoxName, tryParseSenc, tryParseTfhd, tryParseTrun } from './box';

export type EncryptionScheme = 'cenc' | 'cbcs';

export type SubsampleParams = {
  encryptionScheme: EncryptionScheme;
  data: Buffer;
  // Initialization Vector (IV) of sample
  iv: Buffer;
  // Presentation timestamp (PTS) of sample in the media timeline
  timestamp: number;
};

export type SubsampleHandler = (params: SubsampleParams) => Promise<Buffer | null>;

const processEncryptedSegment = async (segment: Buffer, subsampleHandler: SubsampleHandler) => {
  const isInit = isInitializationSegment(segment);
  if (isInit) return decryptInitChunk(segment);

  const root = parseMpegBoxes(segment);
  const senc = findMpegBoxByName(segment, root, 'senc');
  const trun = findMpegBoxByName(segment, root, 'trun');
  const tfhd = findMpegBoxByName(segment, root, 'tfhd');
  const mdat = findMpegBoxByName(segment, root, 'mdat');

  if (!senc) throw new Error("Couldn't find senc box");
  if (!trun) throw new Error("Couldn't find trun box");
  if (!tfhd) throw new Error("Couldn't find tfhd box");
  if (!mdat) throw new Error("Couldn't find mdat box");

  const mdatOffset = mdat.payloadStart;

  let sencSamples = tryParseSenc(segment, senc);
  if (sencSamples === null) {
    sencSamples = tryParseSenc(segment, senc, 16);
  }
  if (sencSamples === null) {
    throw new Error('failed to parse senc box');
  }

  const trunSamples = tryParseTrun(segment, trun);
  if (trunSamples === null) {
    throw new Error('failed to parse trun box');
  }
  if (sencSamples.length !== trunSamples.length) {
    throw new Error(`sample count mismatch: trun has ${trunSamples.length}, senc has ${sencSamples.length}`);
  }

  const header = tryParseTfhd(segment, tfhd);
  if (header === null) {
    throw new Error('failed to parse tfhd box');
  }

  let position = 0;
  let time = 0;
  for (let i = 0; i < sencSamples.length; i++) {
    const sencSample = sencSamples[i];
    const trunSample = trunSamples[i];
    const expectedSize = trunSamples[i].size || header.defaultSize || 0;

    // If no subsamples defined, treat entire sample as encrypted
    if (!sencSample.subSamples.length) {
      sencSample.subSamples.push({
        clearDataBytes: 0,
        encryptedDataBytes: expectedSize,
      });
    }

    // Check if any subsample has encrypted data
    const hasEncrypted = sencSample.subSamples.some((subsample: any) => subsample.encryptedDataBytes > 0);

    if (hasEncrypted) {
      let offset = 0;
      // First collect all encrypted parts
      const encryptedParts: Buffer[] = [];
      for (const subSample of sencSample.subSamples) {
        offset += subSample.clearDataBytes;
        if (subSample.encryptedDataBytes > 0) {
          const encryptedData = segment.subarray(
            mdatOffset + position + offset,
            mdatOffset + position + offset + subSample.encryptedDataBytes
          );
          encryptedParts.push(encryptedData);
        }
        offset += subSample.encryptedDataBytes;
      }

      // Decrypt all encrypted parts at once
      const encryptedData = Buffer.concat(encryptedParts);
      const subsampleParams: SubsampleParams = {
        encryptionScheme: 'cenc',
        iv: sencSample.iv,
        data: encryptedData,
        timestamp: time,
      };
      const decryptedData = await subsampleHandler(subsampleParams);

      if (decryptedData) {
        // Reconstruct the sample with clear and decrypted parts
        offset = 0;
        let decryptedOffset = 0;
        const decryptedSampleParts: Buffer[] = [];

        for (const subSample of sencSample.subSamples) {
          if (subSample.clearDataBytes > 0) {
            const clearData = segment.subarray(
              mdatOffset + position + offset,
              mdatOffset + position + offset + subSample.clearDataBytes
            );
            decryptedSampleParts.push(clearData);
            offset += subSample.clearDataBytes;
          }

          if (subSample.encryptedDataBytes > 0) {
            const decryptedPart = decryptedData.subarray(
              decryptedOffset,
              decryptedOffset + subSample.encryptedDataBytes
            );
            decryptedSampleParts.push(decryptedPart);
            decryptedOffset += subSample.encryptedDataBytes;
            offset += subSample.encryptedDataBytes;
          }
        }

        const decryptedSample = Buffer.concat(decryptedSampleParts);
        decryptedSample.copy(segment, mdatOffset + position);
      }
    }

    position += expectedSize;
    time += trunSample.duration || header.defaultDuration || 0;
  }

  replaceBoxName(segment, root, 'senc', 'skip');

  return segment;
};

export { processEncryptedSegment };
