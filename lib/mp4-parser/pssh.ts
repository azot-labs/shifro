import { parsePSSH } from './box-parsers';
import { Mp4Parser } from './parser';

type PsshInfo = ReturnType<typeof parsePSSH>;

export const getPsshList = async (data: Uint8Array) => {
  return new Promise<PsshInfo[]>((resolve) => {
    const results: PsshInfo[] = [];
    new Mp4Parser()
      .box('moov', Mp4Parser.children)
      .box('trak', Mp4Parser.children)
      .box('mdia', Mp4Parser.children)
      .box('minf', Mp4Parser.children)
      .box('stbl', Mp4Parser.children)
      .fullBox('stsd', Mp4Parser.sampleDescription)
      .fullBox('pssh', (box) => results.push(parsePSSH(box)))
      .parse(data, false, true);
    resolve(results);
  });
};
