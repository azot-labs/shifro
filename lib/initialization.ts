import { bufferReplaceAll } from './buffer';
import { Mp4Parser } from './core/parser';

export const isInitializationSegment = (chunk: Buffer): boolean => {
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

export const decryptInitChunk = async (chunk: Buffer) => {
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
