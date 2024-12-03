import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const getHash = (path: string) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const rs = createReadStream(path);
    rs.on('error', reject);
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
  });
