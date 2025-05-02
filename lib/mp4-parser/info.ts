import fs from 'fs';
import { readInit } from './init';
import { Mp4Parser } from './parser';
import { parseTENC } from './box-parsers';

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

export const getDefaultKid = (data: Uint8Array) => {
  return new Promise((resolve) => {
    new Mp4Parser()
      .box('moov', Mp4Parser.children)
      .box('trak', Mp4Parser.children)
      .box('mdia', Mp4Parser.children)
      .box('minf', Mp4Parser.children)
      .box('stbl', Mp4Parser.children)
      .fullBox('stsd', Mp4Parser.sampleDescription)
      .box('encv', Mp4Parser.visualSampleEntry)
      .box('enca', Mp4Parser.audioSampleEntry)
      .box('sinf', Mp4Parser.children)
      .box('schi', Mp4Parser.children)
      .fullBox('tenc', (box) => {
        const { defaultKID } = parseTENC(box.reader);
        resolve(defaultKID);
      })
      .parse(data, true);
  });
};
