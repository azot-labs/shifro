import { decrypt } from './lib/decrypt';
import { processStream } from './lib/stream';
import { EncryptionScheme, processEncryptedSegment, type SubsampleParams } from './lib/process';
import { parseHex } from './lib/buffer';

export const decryptWithKey = async (key: Uint8Array, params: SubsampleParams) => {
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
  transformSubsampleData: (params: SubsampleParams) => Promise<Uint8Array | null>;
};

export type DecryptParams = DecryptWithKey | DecryptWithCallback;

const decryptSegment = async (segment: Uint8Array, params: DecryptParams) => {
  const hasKey = 'key' in params;
  const key = new Uint8Array(parseHex(hasKey ? params.key : ''));
  const decryptFn = async (subsampleParams: SubsampleParams) =>
    decryptWithKey(key, {
      encryptionScheme: 'encryptionScheme' in params ? params.encryptionScheme : undefined,
      ...subsampleParams,
    });
  const transformSubsampleData = hasKey ? decryptFn : params.transformSubsampleData;
  return processEncryptedSegment(segment, transformSubsampleData);
};

const decryptStream = async (readable: ReadableStream, writable: WritableStream, params: DecryptParams) => {
  const hasKey = 'key' in params;
  const key = new Uint8Array(parseHex(hasKey ? params.key : ''));
  const decryptFn = async (params: SubsampleParams) => decryptWithKey(key, params);
  const transformSubsampleData = hasKey ? decryptFn : params.transformSubsampleData;
  await processStream(readable, writable, transformSubsampleData);
};

export type { SubsampleParams };
export { decryptSegment, decryptStream };
