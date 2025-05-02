import { parsePSSH } from './box-parsers';
import { Mp4Parser } from './parser';

export interface ParsedMp4Info {
  pssh?: string;
  kid?: string;
  scheme?: string;
  systemId?: string;
  isMultiDrm?: boolean;
}

function readBox(data: Uint8Array, info: ParsedMp4Info): void {
  // Find 'schm' box
  const schmBytes = new Uint8Array([0x73, 0x63, 0x68, 0x6d]);
  let schmIndex = -1;

  // Search for schm pattern
  for (let i = 0; i < data.length - 4; i++) {
    if (
      data[i] === schmBytes[0] &&
      data[i + 1] === schmBytes[1] &&
      data[i + 2] === schmBytes[2] &&
      data[i + 3] === schmBytes[3]
    ) {
      schmIndex = i;
      break;
    }
  }

  // Extract scheme if found
  if (schmIndex !== -1 && schmIndex + 12 < data.length) {
    const schemeBytes = data.subarray(schmIndex + 8, schmIndex + 12);
    info.scheme = new TextDecoder().decode(schemeBytes);
  }

  // Find 'tenc' box
  const tencBytes = new Uint8Array([0x74, 0x65, 0x6e, 0x63]);
  let tencIndex = -1;

  // Search for tenc pattern
  for (let i = 0; i < data.length - 4; i++) {
    if (
      data[i] === tencBytes[0] &&
      data[i + 1] === tencBytes[1] &&
      data[i + 2] === tencBytes[2] &&
      data[i + 3] === tencBytes[3]
    ) {
      tencIndex = i;
      break;
    }
  }

  // Extract KID if found
  if (tencIndex !== -1 && tencIndex + 28 < data.length) {
    const kidBytes = data.subarray(tencIndex + 12, tencIndex + 28);
    info.kid = Array.from(kidBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toLowerCase();
  }
}

export const readInit = async (data: Buffer) => {
  const info: ParsedMp4Info = {};

  new Mp4Parser()
    .box('moov', Mp4Parser.children)
    .box('trak', Mp4Parser.children)
    .box('mdia', Mp4Parser.children)
    .box('minf', Mp4Parser.children)
    .box('stbl', Mp4Parser.children)
    .fullBox('stsd', Mp4Parser.sampleDescription)
    .fullBox('pssh', (box) => {
      const parsedPSSHBox = parsePSSH(box);
      info.pssh = parsedPSSHBox.pssh;
      info.kid = parsedPSSHBox.cencKeyIds[0];
      info.systemId = parsedPSSHBox.systemId;
    })
    .fullBox(
      'encv',
      Mp4Parser.allData((data) => readBox(data, info))
    )
    .fullBox(
      'enca',
      Mp4Parser.allData((data) => readBox(data, info))
    )
    .fullBox(
      'enct',
      Mp4Parser.allData((data) => readBox(data, info))
    )
    .fullBox(
      'encs',
      Mp4Parser.allData((data) => readBox(data, info))
    )
    .parse(data, false, true);

  return info;
};
