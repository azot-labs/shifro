import { decrypt } from './lib/decrypt';
import { processStream, ProcessStreamOptions } from './lib/stream';
import { EncryptionScheme, processEncryptedSegment, type TransformSampleParams } from './lib/process';
import { parseHex } from './lib/buffer';

export const decryptWithKey = async (key: Uint8Array, params: TransformSampleParams) => {
  const scheme = params.encryptionScheme;
  const iv = params.iv;
  const data = params.data;
  if (scheme === 'cbcs') {
    return decrypt({ key, iv, data, algorithm: 'AES-CBC' });
  } else {
    return decrypt({ key, iv, data, algorithm: 'AES-CTR' });
  }
};

type DecryptWithKey = {
  key: string;
  keyId?: string;
  encryptionScheme?: EncryptionScheme;
};

type DecryptWithCallback = {
  keyId?: string;
  transformSample: (params: TransformSampleParams) => Promise<Uint8Array | null>;
};

export type DecryptParams = DecryptWithKey | DecryptWithCallback;

const decryptSegment = async (segment: Uint8Array, params: DecryptParams) => {
  const hasKey = 'key' in params;
  const key = new Uint8Array(parseHex(hasKey ? params.key : ''));
  const decryptFn = async (subsampleParams: TransformSampleParams) =>
    decryptWithKey(key, {
      encryptionScheme: 'encryptionScheme' in params ? params.encryptionScheme : undefined,
      ...subsampleParams,
    });
  const transformSample = hasKey ? decryptFn : params.transformSample;
  return processEncryptedSegment(segment, transformSample);
};

const decryptStream = async (
  readable: ReadableStream,
  writable: WritableStream,
  { preventClose, onProgress, ...params }: DecryptParams & Omit<ProcessStreamOptions, 'transformSample'>
) => {
  const hasKey = 'key' in params;
  const key = new Uint8Array(parseHex(hasKey ? params.key : ''));
  const decryptFn = async (params: TransformSampleParams) => decryptWithKey(key, params);
  const transformSample = hasKey ? decryptFn : params.transformSample;
  await processStream(readable, writable, { preventClose, onProgress, transformSample });
};

export type { TransformSampleParams, ProcessStreamOptions };
export { decryptSegment, decryptStream };
export * from './lib/api';
