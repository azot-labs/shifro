import { createDecipheriv } from 'node:crypto';
import { processEncryptedSegment, type SubsampleParams } from './lib/process';
import { processEncryptedFileStream } from './lib/stream';
import { $ } from './lib/shell';
import { getHash } from './lib/hash';

const decryptWithKey = async (key: Buffer, params: SubsampleParams) => {
  const decipher = createDecipheriv('aes-128-ctr', key, params.iv);
  const decrypted = Buffer.concat([decipher.update(params.data), decipher.final()]);
  return decrypted;
};

type DecryptWithKey = {
  key: string;
  keyId?: string;
};

type DecryptWithCallback = {
  keyId?: string;
  decryptSubsampleFn: (params: SubsampleParams) => Promise<Buffer | null>;
};

type DecryptParams = DecryptWithKey | DecryptWithCallback;

const decryptSegment = async (segment: Buffer, params: DecryptParams) => {
  if ('decryptSubsampleFn' in params) return processEncryptedSegment(segment, params.decryptSubsampleFn);
  const keyBuffer = Buffer.from(params.key, 'hex');
  const decryptFn = async (params: SubsampleParams) => decryptWithKey(keyBuffer, params);
  return processEncryptedSegment(segment, decryptFn);
};

const decryptFile = async (inputPath: string, outputPath: string, params: DecryptParams) => {
  if ('decryptSubsampleFn' in params)
    return processEncryptedFileStream(inputPath, outputPath, params.decryptSubsampleFn);
  const keyBuffer = Buffer.from(params.key, 'hex');
  const decryptFn = async (params: SubsampleParams) => decryptWithKey(keyBuffer, params);
  return processEncryptedFileStream(inputPath, outputPath, decryptFn);
};

export type { SubsampleParams };
export { decryptSegment, decryptFile, $, getHash };
