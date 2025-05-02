import fs from 'node:fs';

export const readFirstNBytes = async (path: fs.PathLike, n: number = 1 * 1024 * 1024): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of fs.createReadStream(path, { start: 0, end: n - 1 })) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};
