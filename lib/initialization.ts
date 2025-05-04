import { bufferReplaceAll } from './node/buffer';
import { Mp4Parser } from './parser';
import { parseTencBox } from './parsing/tenc';
import { parsePsshBox } from './parsing/pssh';

export const isInitData = (chunk: Buffer): boolean => {
  try {
    let hasMoov = false;
    let hasMoof = false;
    new Mp4Parser()
      .box('moov', () => {
        // Init segments typically contain 'moov' box
        hasMoov = true;
      })
      .box('moof', () => {
        // Media segments typically contain 'moof' box
        hasMoof = true;
      })
      .parse(chunk, true, true);
    // If it has 'moov' and doesn't have 'moof', it's likely an init segment
    return hasMoov && !hasMoof;
  } catch (e) {
    console.log(e);
    return false;
  }
};

const getOriginalCodec = (chunk: Buffer): string | null => {
  let format: string | null = null;
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
    .box('frma', (box) => {
      const bytes = box.reader.readBytes(4);
      format = Buffer.from(bytes).toString('ascii');
    })
    .parse(chunk, true, true);
  return format;
};

export const processInit = async (chunk: Buffer) => {
  // Get original codec from encryption metadata
  const originalCodec = getOriginalCodec(chunk);

  // Replace encryption-related boxes with 'skip'
  bufferReplaceAll(chunk, 'sinf', 'skip');
  bufferReplaceAll(chunk, 'pssh', 'skip');

  if (originalCodec) {
    // Replace encrypted codec box with original codec
    bufferReplaceAll(chunk, 'encv', originalCodec);
    bufferReplaceAll(chunk, 'enca', originalCodec);
  } else {
    // Fallback to default codecs if detection fails
    console.warn('Could not detect original codec, using fallback values');
    const contentType = chunk.includes('encv') ? 'video' : 'audio';
    if (contentType === 'video') {
      bufferReplaceAll(chunk, 'encv', 'avc1');
    } else {
      bufferReplaceAll(chunk, 'enca', 'mp4a');
    }
  }

  return chunk;
};

type PsshInfo = ReturnType<typeof parsePsshBox>;

export const parseInit = (data: Uint8Array) => {
  const initInfo = {
    schemeType: '',
    defaultKID: '',
    psshList: [] as PsshInfo[],
  };
  new Mp4Parser()
    .box('moov', Mp4Parser.children)
    .box('trak', Mp4Parser.children)
    .box('mdia', Mp4Parser.children)
    .box('minf', Mp4Parser.children)
    .box('stbl', Mp4Parser.children)
    .fullBox('stsd', Mp4Parser.sampleDescription)
    .fullBox('pssh', (box) => initInfo.psshList.push(parsePsshBox(box)))
    .box('encv', Mp4Parser.visualSampleEntry)
    .box('enca', Mp4Parser.audioSampleEntry)
    .box('sinf', Mp4Parser.children)
    .box('schi', Mp4Parser.children)
    .fullBox('schm', (box) => {
      initInfo.schemeType = Buffer.from(box.reader.readBytes(4)).toString('ascii');
    })
    .fullBox('tenc', (box) => {
      const { defaultKID } = parseTencBox(box.reader);
      initInfo.defaultKID = defaultKID;
    })
    .parse(data, false, true);
  return initInfo;
};
