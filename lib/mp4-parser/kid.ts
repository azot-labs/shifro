import { parseTENC } from './box-parsers';
import { Mp4Parser } from './parser';

export const getDefaultKid = (data: Uint8Array) => {
  return new Promise<string>((resolve) => {
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
