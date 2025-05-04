import { createHash } from 'node:crypto';
import { createWriteStream, createReadStream, type PathLike } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { decryptStream } from '../../shifro';

export const readFirstNBytes = async (path: PathLike, n: number = 1 * 1024 * 1024): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path, { start: 0, end: n - 1 })) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export const getHash = (path: string) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const rs = createReadStream(path);
    rs.on('error', reject);
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
  });

export const decryptFile = async (
  inputPath: string,
  outputPath: string,
  params: Parameters<typeof decryptStream>[2]
) => {
  const inputInfo = await stat(inputPath);
  const inputNodeStream = createReadStream(inputPath, { highWaterMark: 1024 * 1024 * 10 });
  const inputWebStream = Readable.toWeb(inputNodeStream) as ReadableStream;

  const outputNodeStream = createWriteStream(outputPath);
  const outputWebStream = Writable.toWeb(outputNodeStream);

  await decryptStream(inputWebStream, outputWebStream, {
    key: 'key' in params ? params.key : '',
    keyId: params.keyId,
    onProgress: (progress) => {
      process.stdout.write(`\rDecrypting... [${progress}/${inputInfo.size}]`);
      if (progress === inputInfo.size) {
        process.stdout.write('\n');
      }
    },
  });
};
