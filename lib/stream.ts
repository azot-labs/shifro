import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { processEncryptedSegment, SubsampleHandler } from './process';
import { parseMpegBoxes, findMpegBoxByName } from './box';

class Mp4SegmentTransform extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private isProcessingInit = true;

  constructor(private options: { subsampleHandler: SubsampleHandler }) {
    super();
  }

  async _transform(chunk: Buffer, encoding: string, callback: Function) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);

      while (this.buffer.length >= 8) {
        const root = parseMpegBoxes(this.buffer);

        if (this.isProcessingInit) {
          // Look for moov box (initialization segment)
          const moov = findMpegBoxByName(this.buffer, root, 'moov');
          if (!moov) {
            break;
          }

          // Process initialization segment
          const initSegment = this.buffer.subarray(0, moov.end);
          const processedInit = await processEncryptedSegment(initSegment, this.options.subsampleHandler);

          this.push(processedInit);
          this.buffer = this.buffer.subarray(moov.end);
          this.isProcessingInit = false;
          continue;
        }

        // Look for moof box to identify media segment boundary
        const moof = findMpegBoxByName(this.buffer, root, 'moof');
        if (!moof) {
          break;
        }

        // Find corresponding mdat
        const mdat = findMpegBoxByName(this.buffer, root, 'mdat');
        if (!mdat) {
          break;
        }

        // Process complete media segment (from moof start to mdat end)
        const segmentBuffer = this.buffer.subarray(moof.headerStart, mdat.end);

        const processedSegment = await processEncryptedSegment(segmentBuffer, this.options.subsampleHandler);

        this.push(processedSegment);
        this.buffer = this.buffer.subarray(mdat.end);
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
