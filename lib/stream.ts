import { Mp4Parser } from './parser';
import { EncryptionScheme, processEncryptedSegment, TransformSampleFn, TransformSampleParams } from './process';
import { isInitData, parseInit, processInit } from './initialization';
import { concatUint8Array } from './buffer';

const findInit = (buffer: Uint8Array) => {
  let moovEnd: number | null = null;
  new Mp4Parser()
    .box('moov', (box) => {
      moovEnd = box.start + box.size;
    })
    .parse(buffer, true, true);
  const init = moovEnd ? buffer.subarray(0, moovEnd) : null;
  return { moovEnd, init };
};

const findSegment = (buffer: Uint8Array) => {
  let moofStart: number | null = null;
  let mdatEnd: number | null = null;

  new Mp4Parser()
    .box('moof', (box) => {
      if (moofStart === null) moofStart = box.start;
    })
    .box('mdat', (box) => {
      if (mdatEnd === null) mdatEnd = box.start + box.size;
    })
    .parse(buffer, true, true);

  const hasSegment = moofStart !== null && mdatEnd !== null;

  const segment = hasSegment ? buffer.subarray(moofStart!, mdatEnd!) : null;

  return { segment, moofStart, mdatEnd };
};

class Mp4SegmentTransformer {
  private buffer = new Uint8Array();
  private isProcessingInit = true;
  private scheme: string | null = null;

  constructor(private options: { transformSample: TransformSampleFn }) {}

  async transform(chunk: Uint8Array, controller: TransformStreamDefaultController) {
    try {
      this.buffer = concatUint8Array([this.buffer, chunk]);

      let shouldContinue = true;
      while (shouldContinue) {
        if (this.isProcessingInit) {
          const { init, moovEnd } = findInit(this.buffer);
          if (!moovEnd || this.buffer.length < moovEnd) {
            break;
          }
          if (init && moovEnd && isInitData(init)) {
            const initInfo = parseInit(init);
            this.scheme = initInfo.schemeType;
            const processedInit = await processInit(init);
            controller.enqueue(processedInit);
            this.buffer = this.buffer.subarray(moovEnd);
            this.isProcessingInit = false;
            continue;
          }
        }

        const { moofStart, mdatEnd, segment } = findSegment(this.buffer);

        if (moofStart === null || mdatEnd === null || !segment || this.buffer.length < mdatEnd) {
          break;
        }

        const onSubsampleData = (params: TransformSampleParams) => {
          params.encryptionScheme = this.scheme as EncryptionScheme;
          return this.options.transformSample(params);
        };
        const processedSegment = await processEncryptedSegment(segment, onSubsampleData);

        controller.enqueue(processedSegment);
        this.buffer = this.buffer.subarray(mdatEnd);
        shouldContinue = this.buffer.length >= 8;
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

export interface ProcessStreamOptions {
  transformSample: TransformSampleFn;
  preventClose?: boolean;
}

export const processStream = async (
  readable: ReadableStream,
  writable: WritableStream,
  { transformSample, preventClose }: ProcessStreamOptions
) => {
  const transformer = new Mp4SegmentTransformer({ transformSample });
  const transform = new TransformStream({
    transform: (chunk, controller) => transformer.transform(chunk, controller),
    flush: (controller) => transformer.flush(controller),
  });
  await readable.pipeThrough(transform).pipeTo(writable, { preventClose });
};
