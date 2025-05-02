import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Mp4Parser } from './core/parser';
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

        let moofStart: number | null = null;
        let mdatEnd: number | null = null;

        await new Promise((resolve) => {
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
            .box('moof', (box) => {
              // Look for moof box to identify media segment boundary
              if (moofStart === null) moofStart = box.start;
            })
            .box('mdat', (box) => {
              // Find corresponding mdat
              if (mdatEnd !== null) return resolve(mdatEnd);
              mdatEnd = box.start + box.size;
              resolve(mdatEnd);
            })
            .parse(this.buffer, true, true);
        });

        if (moofStart === null || mdatEnd === null) break;

        // Process complete media segment (from moof start to mdat end)
        const segmentBuffer = this.buffer.subarray(moofStart, mdatEnd);

        const processedSegment = await processEncryptedSegment(segmentBuffer, this.options.subsampleHandler);

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
