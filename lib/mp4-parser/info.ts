import fs from 'fs';
import { readInit } from './init';

export async function readFirstNBytes(path: fs.PathLike, n: number = 1 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of fs.createReadStream(path, { start: 0, end: n - 1 })) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const getMp4Info = async (filepath: string) => {
  const data = await readFirstNBytes(filepath, 1 * 1024 * 1024); // 1MB
  const info = await readInit(data);
  return info;
};
