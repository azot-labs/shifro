import { Mp4Parser } from './core/parser';
import { parseSencBox, type ParsedSenc } from './box/senc';
import { parseTrunBox, type ParsedTrun } from './box/trun';
import { parseTfhdBox, type ParsedTfhd } from './box/tfhd';
import { decryptInitChunk, isInitializationSegment } from './initialization';
import { parseMpegBoxes, replaceBoxName } from './box';

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

  let sencInfo!: ParsedSenc;
  let trunInfo!: ParsedTrun;
  let tfhdInfo!: ParsedTfhd;
  let mdatOffset!: number;
  new Mp4Parser()
    .box('moov', Mp4Parser.children) // Movie container
    .box('trak', Mp4Parser.children) // Track container
    .box('edts', Mp4Parser.children) // Edit container
    .box('mdia', Mp4Parser.children) // Media container
    .box('minf', Mp4Parser.children) // Media information container
    .box('dinf', Mp4Parser.children) // Data information container
    .box('stbl', Mp4Parser.children) // Sample table container
    .box('mvex', Mp4Parser.children) // Movie extends container
    .box('moof', Mp4Parser.children) // Movie fragment
    .box('traf', Mp4Parser.children) // Track fragment
    .box('mfra', Mp4Parser.children) // Movie fragment random access
    .box('skip', Mp4Parser.children) // Free space
    .box('meta', Mp4Parser.children) // Metadata container
    .box('sinf', Mp4Parser.children) // Protection scheme information
    .box('schi', Mp4Parser.children) // Scheme information
    .box('envc', Mp4Parser.children) // Encrypted video container
    .box('enva', Mp4Parser.children) // Encrypted audio container
    .fullBox('stsd', Mp4Parser.sampleDescription) // Sample descriptions (codec types, initialization data)
    .fullBox('senc', (box) => {
      sencInfo = parseSencBox(box.reader, box.flags);
    })
    .fullBox('trun', (box) => {
      trunInfo = parseTrunBox(box.reader, box.flags!, box.version!);
    })
    .fullBox('tfhd', (box) => {
      tfhdInfo = parseTfhdBox(box.reader, box.flags!);
    })
    .parse(segment, true, true);

  mdatOffset = trunInfo.dataOffset!;

  if (sencInfo.samples.length !== trunInfo.samples.length) {
    throw new Error(`sample count mismatch: trun has ${trunInfo.samples.length}, senc has ${sencInfo.samples.length}`);
  }

  let position = 0;
  let time = 0;
  for (let i = 0; i < sencInfo.samples.length; i++) {
    const sencSampleNew = sencInfo.samples[i];
    const trunSample = trunInfo.samples[i];
    const expectedSize = trunInfo.samples[i].size || tfhdInfo.defaultSampleSize || 0;

    // If no subsamples defined, treat entire sample as encrypted
    if (!sencSampleNew.subsamples.length) {
      sencSampleNew.subsamples.push({
        bytesOfClearData: 0,
        bytesOfEncryptedData: expectedSize,
      });
    }

    // Check if any subsample has encrypted data
    const hasEncrypted = sencSampleNew.subsamples.some((subsample) => subsample.bytesOfEncryptedData > 0);

    if (hasEncrypted) {
      let offset = 0;
      // First collect all encrypted parts
      const encryptedParts: Buffer[] = [];
      for (const subsample of sencSampleNew.subsamples) {
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
      const encryptedData = Buffer.concat(encryptedParts);
      const subsampleParams: SubsampleParams = {
        encryptionScheme: 'cenc',
        iv: sencSampleNew.iv,
        data: encryptedData,
        timestamp: time,
      };
      const decryptedData = await subsampleHandler(subsampleParams);

      if (decryptedData) {
        // Reconstruct the sample with clear and decrypted parts
        offset = 0;
        let decryptedOffset = 0;
        const decryptedSampleParts: Buffer[] = [];

        for (const subsample of sencSampleNew.subsamples) {
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

        const decryptedSample = Buffer.concat(decryptedSampleParts);
        decryptedSample.copy(segment, mdatOffset + position);
      }
    }

    position += expectedSize;
    time += trunSample.duration || tfhdInfo.defaultSampleDuration || 0;
  }

  replaceBoxName(segment, root, 'senc', 'skip');

  return segment;
};

export { processEncryptedSegment };
