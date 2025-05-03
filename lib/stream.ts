import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Mp4Parser } from './core/parser';
import { getEncryptionScheme } from './parser/scheme';
import { EncryptionScheme, processEncryptedSegment, SubsampleHandler, SubsampleParams } from './process';
import { isInitializationSegment, decryptInitChunk } from './initialization';

class Mp4SegmentTransform extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private isProcessingInit = true;
  private scheme: string | null = null;

  constructor(private options: { subsampleHandler: SubsampleHandler }) {
    super();
  }

  async _transform(chunk: Buffer, encoding: string, callback: Function) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);

      while (this.buffer.length >= 8) {
        if (this.isProcessingInit) {
          let moovEnd: number | null = null;
          new Mp4Parser()
            .box('moov', (box) => {
              // Look for moov box (initialization segment)
              moovEnd = box.start + box.size;
            })
            .parse(this.buffer, true, true);

          if (!moovEnd) {
            break;
          }

          // Process initialization segment
          const initSegment = this.buffer.subarray(0, moovEnd);
          this.scheme = await getEncryptionScheme(initSegment);
          const isInit = isInitializationSegment(initSegment);
          if (isInit) {
            const processedInit = await decryptInitChunk(initSegment);
            this.push(processedInit);
            this.buffer = this.buffer.subarray(moovEnd);
            this.isProcessingInit = false;
            continue;
          }
        }

        let moofStart: number | null = null;
        let mdatEnd: number | null = null;

        new Mp4Parser()
          .box('moof', (box) => {
            // Look for moof box to identify media segment boundary
            if (moofStart === null) moofStart = box.start;
          })
          .box('mdat', (box) => {
            // Find corresponding mdat
            if (mdatEnd !== null) return;
            mdatEnd = box.start + box.size;
          })
          .parse(this.buffer, true, true);

        if (moofStart === null || mdatEnd === null) break;

        // Process complete media segment (from moof start to mdat end)
        const segmentBuffer = this.buffer.subarray(moofStart, mdatEnd);

        const onSubsampleData = (params: SubsampleParams) => {
          params.encryptionScheme = this.scheme as EncryptionScheme;
          return this.options.subsampleHandler(params);
        };

        const processedSegment = await processEncryptedSegment(segmentBuffer, onSubsampleData);

        this.push(processedSegment);
        this.buffer = this.buffer.subarray(mdatEnd);
      }

      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback: Function) {
    if (this.buffer.length > 0) {
      this.push(this.buffer);
    }
    callback();
  }
}

export const processEncryptedFileStream = async (
  inputPath: string,
  outputPath: string,
  subsampleHandler: SubsampleHandler
) => {
  const readStream = createReadStream(inputPath, {
    highWaterMark: 1024 * 1024 * 10, // 10MB chunks for better box detection
  });

  const writeStream = createWriteStream(outputPath);
  const transform = new Mp4SegmentTransform({ subsampleHandler });

  try {
    await pipeline(readStream, transform, writeStream);
    console.log('File processing completed successfully');
  } catch (error) {
    console.error('Error processing file:', error);
    throw error;
  }
};
