import { findMpegBoxByName, MpegBox, parseMpegBoxes } from './box';
import { bufferReplaceAll } from './buffer';
import { Mp4Parser } from './core/parser';

// Define all known codec markers
const VIDEO_CODECS = [
  'avc1', // H.264/AVC
  'avc2', // H.264/AVC
  'avc3', // H.264/AVC
  'avc4', // H.264/AVC
  'hev1', // H.265/HEVC
  'hvc1', // H.265/HEVC
  'av01', // AV1
  'vp08', // VP8
  'vp09', // VP9
  'mp4v', // MPEG-4 Visual
  'mvc1', // Multiview coding
  'mvc2', // Multiview coding
  'svq3', // Sorenson Video 3
  'drac', // Dirac
  'rpza', // Apple Video
  'mjp2', // Motion JPEG 2000
  'wmv3', // Windows Media Video 9
  'dvh1', // Dolby Vision HEVC
  'dvhe', // Dolby Vision HEVC
  'dvav', // Dolby Vision AVC
  'dva1', // Dolby Vision AVC
  'vvc1', // H.266/VVC
  'vvi1', // H.266/VVC
];

const AUDIO_CODECS = [
  'mp4a', // AAC, MP3, etc.
  'alac', // Apple Lossless
  'ac-3', // Dolby Digital
  'ec-3', // Dolby Digital Plus
  'ac-4', // Dolby AC-4
  'dtsc', // DTS Digital Surround
  'dtsh', // DTS-HD High Resolution
  'dtsl', // DTS-HD Master Audio
  'dtse', // DTS Express
  'dtsx', // DTS:X
  'samr', // AMR Narrow Band
  'sawb', // AMR Wide Band
  'sawp', // AMR-WB+
  'sevc', // EVRC Voice
  'sqcp', // 13K Voice
  'fLaC', // FLAC
  'Opus', // Opus
  'twos', // Linear PCM
  'sowt', // Linear PCM
  'lpcm', // Linear PCM
  'alaw', // G.711 a-law
  'ulaw', // G.711 μ-law
  'raw ', // Raw audio
  'vorbis', // Vorbis
];

export const isInitializationSegment = (chunk: Buffer): boolean => {
  try {
    const root = parseMpegBoxes(chunk);
    // debugPrintBoxStructure(root);
    // Init segments typically contain 'moov' box
    const hasMoov = findMpegBoxByName(chunk, root, 'moov') !== null;
    // Media segments typically contain 'moof' box
    const hasMoof = findMpegBoxByName(chunk, root, 'moof') !== null;
    // If it has 'moov' and doesn't have 'moof', it's likely an init segment
    return hasMoov && !hasMoof;
  } catch (e) {
    console.log(e);
    return false;
  }
};

const getOriginalCodec = (chunk: Buffer, root: MpegBox): string | null => {
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
  const root = parseMpegBoxes(chunk);

  // Get original codec from encryption metadata
  const originalCodec = getOriginalCodec(chunk, root);

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
