import { createHash } from 'node:crypto';
import { createReadStream, type PathLike } from 'node:fs';

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
