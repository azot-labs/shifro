import { Writable, Readable } from 'node:stream';
import fs from 'node:fs';
import { DecryptStream } from './decrypt-transformer';
import { parseHex } from './buffer';
import { decryptWithKey, TransformSampleParams } from '../shifro';

async function decrypt(params: { inputPath: string; outputPath: string; key: string; keyId: string }) {
  const inputStream = fs.createReadStream(params.inputPath);
  const outputStream = fs.createWriteStream(params.outputPath);

  const readable = Readable.toWeb(inputStream) as ReadableStream;
  const writable = Writable.toWeb(outputStream);

  const key = new Uint8Array(parseHex(params.key));
  const decryptFn = async (params: TransformSampleParams) => decryptWithKey(key, params);

  const decrypt = new DecryptStream({ transformSample: decryptFn });

  await readable.pipeThrough(decrypt).pipeTo(writable);

  return params.outputPath;
}

export { decrypt };
