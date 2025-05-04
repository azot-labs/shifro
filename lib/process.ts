import { Mp4Parser } from './parser';
import { parseSencBox, type ParsedSenc } from './parsing/senc';
import { parseTrunBox, type ParsedTrun } from './parsing/trun';
import { parseTfhdBox, type ParsedTfhd } from './parsing/tfhd';
import { processInit, isInitData } from './initialization';
import { concatUint8Array, copyUint8Array, writeUint8Array } from './buffer';

export type EncryptionScheme = 'cenc' | 'cbcs';

export type TransformSampleParams = {
  encryptionScheme?: EncryptionScheme;
  data: Uint8Array;
  // Initialization Vector (IV) of sample
  iv: Uint8Array;
  // Presentation timestamp (PTS) of sample in the media timeline
  timestamp: number;
};

export type TransformSampleFn = (params: TransformSampleParams) => Promise<Uint8Array | null>;

const processEncryptedSegment = async (segment: Uint8Array, transformSample: TransformSampleFn) => {
  const isInit = isInitData(segment);
  if (isInit) return processInit(segment);

  let sencInfo!: ParsedSenc;
  let trunInfo!: ParsedTrun;
  let tfhdInfo!: ParsedTfhd;
  let mdatOffset!: number;

  new Mp4Parser()
    .box('moof', Mp4Parser.children)
    .box('traf', Mp4Parser.children)
    .fullBox('tfhd', (box) => {
      tfhdInfo = parseTfhdBox(box.reader, box.flags!);
    })
    .fullBox('trun', (box) => {
      trunInfo = parseTrunBox(box.reader, box.flags!, box.version!);
    })
    .fullBox('senc', (box) => {
      sencInfo = parseSencBox(box.reader, box.flags);
    })
    .parse(segment, true, true);

  mdatOffset = trunInfo.dataOffset!;

  if (sencInfo.samples.length !== trunInfo.samples.length) {
    throw new Error(`sample count mismatch: trun has ${trunInfo.samples.length}, senc has ${sencInfo.samples.length}`);
  }

  let position = 0;
  let time = 0;
  for (let i = 0; i < sencInfo.samples.length; i++) {
    const sencSample = sencInfo.samples[i];
    const trunSample = trunInfo.samples[i];
    const expectedSize = trunInfo.samples[i].size || tfhdInfo.defaultSampleSize || 0;

    // If no subsamples defined, treat entire sample as encrypted
    if (!sencSample.subsamples.length) {
      sencSample.subsamples.push({
        bytesOfClearData: 0,
        bytesOfEncryptedData: expectedSize,
      });
    }

    // Check if any subsample has encrypted data
    const hasEncrypted = sencSample.subsamples.some((subsample) => subsample.bytesOfEncryptedData > 0);

    if (hasEncrypted) {
      let offset = 0;
      // First collect all encrypted parts
      const encryptedParts: Uint8Array[] = [];
      for (const subsample of sencSample.subsamples) {
        offset += subsample.bytesOfClearData;
        if (subsample.bytesOfEncryptedData > 0) {
          const encryptedData = segment.subarray(
            mdatOffset + position + offset,
            mdatOffset + position + offset + subsample.bytesOfEncryptedData
          );
          encryptedParts.push(encryptedData);
        }
        offset += subsample.bytesOfEncryptedData;
      }

      // Decrypt all encrypted parts at once
      const encryptedData = concatUint8Array(encryptedParts);
      const subsampleParams: TransformSampleParams = {
        iv: sencSample.iv,
        data: encryptedData,
        timestamp: time,
      };
      const decryptedData = await transformSample(subsampleParams);

      if (decryptedData) {
        // Reconstruct the sample with clear and decrypted parts
        offset = 0;
        let decryptedOffset = 0;
        const decryptedSampleParts: Uint8Array[] = [];

        for (const subsample of sencSample.subsamples) {
          if (subsample.bytesOfClearData > 0) {
            const clearData = segment.subarray(
              mdatOffset + position + offset,
              mdatOffset + position + offset + subsample.bytesOfClearData
            );
            decryptedSampleParts.push(clearData);
            offset += subsample.bytesOfClearData;
          }

          if (subsample.bytesOfEncryptedData > 0) {
            const decryptedPart = decryptedData.subarray(
              decryptedOffset,
              decryptedOffset + subsample.bytesOfEncryptedData
            );
            decryptedSampleParts.push(decryptedPart);
            decryptedOffset += subsample.bytesOfEncryptedData;
            offset += subsample.bytesOfEncryptedData;
          }
        }

        const decryptedSample = concatUint8Array(decryptedSampleParts);
        copyUint8Array(decryptedSample, segment, mdatOffset + position);
      }
    }

    position += expectedSize;
    time += trunSample.duration || tfhdInfo.defaultSampleDuration || 0;
  }

  new Mp4Parser()
    .box('moof', Mp4Parser.children)
    .box('traf', Mp4Parser.children)
    .box('senc', (box) => {
      const newName = 'skip';
      const offset = box.start + newName.length;
      writeUint8Array(segment, newName, offset);
    })
    .parse(segment, true, true);

  return segment;
};

export { processEncryptedSegment };
