import { concatUint8Array, parseHex } from './buffer';
import { DecryptStream, TransformSampleParams } from './stream';
import { decrypt } from './crypto';
import * as nodeAlias from './node';

const node =
  typeof nodeAlias !== 'undefined'
    ? nodeAlias // Aliasing it prevents some bundler warnings
    : undefined!;

export class FilePathSource {
  public readable: ReadableStream;

  constructor(public filePath: string) {
    const readStream = node.fs.createReadStream(filePath);
    this.readable = node.stream.Readable.toWeb(readStream) as ReadableStream;
  }
}

export class FilePathTarget {
  public writable: WritableStream;

  constructor(public filePath: string) {
    const writeStream = node.fs.createWriteStream(filePath);
    this.writable = node.stream.Writable.toWeb(writeStream);
  }
}

export class StreamSource {
  constructor(public readable: ReadableStream) {}
}

export class StreamTarget {
  constructor(public writable: WritableStream) {}
}

export class BufferSource {
  public readable: ReadableStream;

  constructor(public buffer: Uint8Array) {
    this.readable = new ReadableStream({
      start(controller) {
        controller.enqueue(buffer);
        controller.close();
      },
    });
  }
}

export class BufferTarget {
  public writable: WritableStream;
  public buffer: Uint8Array | null = null;

  constructor() {
    const chunks: Uint8Array[] = [];
    this.writable = new WritableStream({
      start: () => {},
      write: (chunk) => {
        chunks.push(chunk);
      },
      abort: (reason) => {
        console.error('WritableStream aborted:', reason);
      },
      close: () => {
        this.buffer = concatUint8Array(chunks);
      },
    });
  }
}

export type InputSource = FilePathSource | StreamSource | BufferSource;

export type InputOptions = { source: InputSource };

export class Input {
  public source: InputSource;

  constructor(options: InputOptions) {
    this.source = options.source;
  }
}

export type OutputTarget = FilePathTarget | StreamTarget | BufferTarget;

export type OutputOptions = { target: OutputTarget };

export class Output {
  public target: OutputTarget;

  constructor(options: OutputOptions) {
    this.target = options.target;
  }
}

export type DecryptionOptions = {
  input: Input;
  output: Output;
  keys: { kid?: string; key: string }[];
  onProgress?: (bytesProcessed: number) => void;
};

export class Decryption {
  private decrypt: DecryptStream;
  public input: Input;
  public output: Output;

  static async init(options: DecryptionOptions) {
    const decryption = new Decryption(options);
    await decryption.#init();
    return decryption;
  }

  constructor(options: DecryptionOptions) {
    this.input = options.input;
    this.output = options.output;

    // TODO: Support multiple keys
    const key = new Uint8Array(parseHex(options.keys[0].key));

    const decryptFn = async ({ iv, data, encryptionScheme }: TransformSampleParams) => {
      if (encryptionScheme === 'cbcs') {
        return decrypt({ key, iv, data, algorithm: 'AES-CBC' });
      } else {
        // CENC
        return decrypt({ key, iv, data, algorithm: 'AES-CTR' });
      }
    };

    this.decrypt = new DecryptStream({
      transformSample: decryptFn,
      onProgress: options.onProgress,
    });
  }

  async #init() {}

  async execute() {
    const readable = this.input.source.readable;
    const writable = this.output.target.writable;
    const decrypt = this.decrypt;
    await readable.pipeThrough(decrypt).pipeTo(writable);
  }
}
