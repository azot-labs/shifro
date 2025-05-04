import { Mp4Parser } from './core/parser';
import { getEncryptionScheme } from './parser/scheme';
import { EncryptionScheme, processEncryptedSegment, SubsampleHandler, SubsampleParams } from './process';
import { isInitializationSegment, decryptInitChunk } from './initialization';

class Mp4SegmentTransformer {
  private buffer: Buffer = Buffer.alloc(0);
  private isProcessingInit = true;
  private scheme: string | null = null;

  constructor(private options: { subsampleHandler: SubsampleHandler }) {}

  async transform(chunk: Uint8Array, controller: TransformStreamDefaultController) {
    try {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);

      while (this.buffer.length >= 8) {
        if (this.isProcessingInit) {
          let moovEnd: number | null = null;
          new Mp4Parser()
            .box('moov', (box) => {
              moovEnd = box.start + box.size;
            })
            .parse(this.buffer, true, true);

          if (!moovEnd) break;

          const initSegment = this.buffer.subarray(0, moovEnd);
          this.scheme = await getEncryptionScheme(initSegment);
          if (isInitializationSegment(initSegment)) {
            const processedInit = await decryptInitChunk(initSegment);
            controller.enqueue(processedInit);
            this.buffer = this.buffer.subarray(moovEnd);
            this.isProcessingInit = false;
            continue;
          }
        }

        let moofStart: number | null = null;
        let mdatEnd: number | null = null;

        new Mp4Parser()
          .box('moof', (box) => {
            if (moofStart === null) moofStart = box.start;
          })
          .box('mdat', (box) => {
            if (mdatEnd === null) mdatEnd = box.start + box.size;
          })
          .parse(this.buffer, true, true);

        if (moofStart === null || mdatEnd === null) break;

        const segmentBuffer = this.buffer.subarray(moofStart, mdatEnd);
        const onSubsampleData = (params: SubsampleParams) => {
          params.encryptionScheme = this.scheme as EncryptionScheme;
          return this.options.subsampleHandler(params);
        };

        const processedSegment = await processEncryptedSegment(segmentBuffer, onSubsampleData);
        controller.enqueue(processedSegment);
        this.buffer = this.buffer.subarray(mdatEnd);
      }
    } catch (error) {
      controller.error(error);
    }
  }

  async flush(controller: TransformStreamDefaultController) {
    if (this.buffer.length > 0) {
      controller.enqueue(this.buffer);
    }
  }
}

export const processStream = async (
  readable: ReadableStream,
  writable: WritableStream,
  onSubsampleData: SubsampleHandler
) => {
  const transformer = new Mp4SegmentTransformer({ subsampleHandler: onSubsampleData });
  const transform = new TransformStream({
    transform: (chunk, controller) => transformer.transform(chunk, controller),
    flush: (controller) => transformer.flush(controller),
  });
  await readable.pipeThrough(transform).pipeTo(writable, { preventClose: true });
};
