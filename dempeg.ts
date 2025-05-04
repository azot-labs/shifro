import { createDecipheriv } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { processStream } from './lib/stream';
import { EncryptionScheme, processEncryptedSegment, type SubsampleHandler, type SubsampleParams } from './lib/process';
import { $ } from './lib/node/shell';
import { getHash } from './lib/node/utils';

export const decryptWithKey = async (key: Buffer, params: SubsampleParams) => {
  const scheme = params.encryptionScheme;
  if (scheme === 'cbcs') {
    const decipher = createDecipheriv('aes-128-cbc', key, params.iv);
    decipher.setAutoPadding(false); // Padding is handled by the CENC/CBCS spec, not the block cipher mode
    const decrypted = Buffer.concat([decipher.update(params.data), decipher.final()]);
    return decrypted;
  } else {
    // Default to CENC
    const decipher = createDecipheriv('aes-128-ctr', key, params.iv);
    decipher.setAutoPadding(false); // CTR is a stream cipher, no padding needed
    const decrypted = Buffer.concat([decipher.update(params.data), decipher.final()]);
    return decrypted;
  }
};

type DecryptWithKey = {
  key: string;
  keyId?: string;
  encryptionScheme?: EncryptionScheme;
};

type DecryptWithCallback = {
  keyId?: string;
  transformSubsampleData: (params: SubsampleParams) => Promise<Buffer | null>;
};

type DecryptParams = DecryptWithKey | DecryptWithCallback;

const decryptSegment = async (segment: Buffer, params: DecryptParams) => {
  const hasKey = 'key' in params;
  const key = Buffer.from(hasKey ? params.key : '', 'hex');
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
  const key = Buffer.from(hasKey ? params.key : '', 'hex');
  const decryptFn = async (params: SubsampleParams) => decryptWithKey(key, params);
  const transformSubsampleData = hasKey ? decryptFn : params.transformSubsampleData;
  await processStream(readable, writable, transformSubsampleData);
};

export const processEncryptedFileStream = async (
  inputPath: string,
  outputPath: string,
  subsampleHandler: SubsampleHandler
) => {
  const nodeReadable = createReadStream(inputPath, { highWaterMark: 1024 * 1024 * 10 });
  const readableStream = Readable.toWeb(nodeReadable) as ReadableStream;

  const nodeWritable = createWriteStream(outputPath);
  const writableStream = Writable.toWeb(nodeWritable) as WritableStream;

  try {
    await processStream(readableStream, writableStream, subsampleHandler);
    console.log('File processing completed successfully');
  } catch (error) {
    console.error('Error processing file:', error);
    throw error;
  }
};

const decryptFile = async (inputPath: string, outputPath: string, params: DecryptParams) => {
  if ('transformSubsampleData' in params)
    return processEncryptedFileStream(inputPath, outputPath, params.transformSubsampleData);
  const keyBuffer = Buffer.from(params.key, 'hex');
  const decryptFn = async (params: SubsampleParams) => decryptWithKey(keyBuffer, params);
  return processEncryptedFileStream(inputPath, outputPath, decryptFn);
};

export type { SubsampleParams };
export { decryptSegment, decryptStream, decryptFile, $, getHash };
