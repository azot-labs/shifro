import { createHash } from 'node:crypto';
import { createReadStream, type PathLike } from 'node:fs';
import { decryptStream, Input, Output, FilePathSource, FilePathTarget, Decryption } from '../../shifro';

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
  console.time('\nDone!');

  const input = new Input({ source: new FilePathSource(inputPath) });
  const output = new Output({ target: new FilePathTarget(outputPath) });
  const decryption = await Decryption.init({
    input,
    output,
    keys: [{ kid: params.keyId, key: 'key' in params ? params.key : '' }],
    onProgress: (progress) => process.stdout.write(`\rDecrypting... [${progress}]`),
  });
  await decryption.execute();

  console.timeEnd('\nDone!');
};
