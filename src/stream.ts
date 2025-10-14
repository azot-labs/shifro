import { ISOFile, Movie, MP4BoxBuffer } from 'mp4box';
import { concatUint8Array } from './buffer';
import { processSamples } from './sample';
import { createFiles, processInit } from './init';

export type EncryptionScheme = 'cenc' | 'cbcs';

export type TransformSampleParams = {
  data: Uint8Array;
  encryptionScheme?: EncryptionScheme;
  kid?: string;
  // Initialization Vector (IV) of sample
  iv: Uint8Array;
  // Presentation timestamp (PTS) of sample in the media timeline
  timestamp: number;
};

export type TransformSampleFn = (params: TransformSampleParams) => Promise<Uint8Array | null>;

type DecryptTransformerOptions = {
  transformSample?: TransformSampleFn;
  onProgress?: (bytesProcessed: number) => void;
};

class DecryptTransformer {
  private input: ISOFile;
  private inputReady: Promise<Movie>;
  private output: ISOFile;

  private buffer = new Uint8Array();
  private bytesRead = 0;
  private processedBytes = 0;
  private samplesProcessingQueue: Promise<{ data: Uint8Array; trackId: number; nextSampleNum: number }>[] = [];

  constructor(private options: DecryptTransformerOptions = {}) {
    const { input, ready, output } = createFiles();
    this.input = input;
    this.inputReady = ready;
    this.output = output;
    this.init();
  }

  async init() {
    const info = await this.inputReady;
    const input = this.input;
    const output = this.output;
    const { init } = await processInit({ input, info, output });
    this.buffer = concatUint8Array([this.buffer, init]);
    this.input.onSamples = (_id, _user, samples) => {
      this.samplesProcessingQueue.push(
        processSamples({
          input: this.input,
          samples,
          transform: this.options.transformSample,
        })
      );
    };
    this.input.start();
  }

  async transform(chunk: Uint8Array, controller: TransformStreamDefaultController) {
    try {
      const boxBuffer = MP4BoxBuffer.fromArrayBuffer(chunk.buffer, this.bytesRead);
      this.input.appendBuffer(boxBuffer);
      this.output.appendBuffer(boxBuffer);
      this.bytesRead += chunk.length;
      await this.flush(controller);
    } catch (error) {
      controller.error(error);
    }
  }

  async flush(controller: TransformStreamDefaultController) {
    while (this.samplesProcessingQueue.length > 0) {
      const segment = await this.samplesProcessingQueue.shift();
      if (!segment) continue;
      this.buffer = concatUint8Array([this.buffer, segment.data]);
      this.input.releaseUsedSamples(segment.trackId, segment.nextSampleNum);
    }
    if (this.buffer.length > 0) {
      controller.enqueue(this.buffer);
      this.updateProgress(this.buffer.byteLength);
      this.buffer = new Uint8Array();
    }
  }

  private updateProgress(bytes: number) {
    this.processedBytes += bytes;
    if (this.options.onProgress) {
      this.options.onProgress(this.processedBytes);
    }
  }
}

export class DecryptStream extends TransformStream {
  constructor(options: DecryptTransformerOptions = {}) {
    const transformer = new DecryptTransformer(options);
    super({
      transform: (chunk, controller) => transformer.transform(chunk, controller),
      flush: (controller) => transformer.flush(controller),
    });
  }
}
