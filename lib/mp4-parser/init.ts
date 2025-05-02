import { Mp4Parser } from './parser';

const ZERO_KID = '00000000000000000000000000000000';

const SYSTEM_ID_WIDEVINE = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed'.replaceAll('-', '');

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
      const version = box.version ?? 0;
      if (version !== 0 && version !== 1) throw new Error('PSSH version can only be 0 or 1');
      const systemIdBytes = box.reader.readBytes(16);
      const systemIdHex = Buffer.from(systemIdBytes).toString('hex');
      const systemId = [
        systemIdHex.slice(0, 8),
        systemIdHex.slice(8, 12),
        systemIdHex.slice(12, 16),
        systemIdHex.slice(16, 20),
        systemIdHex.slice(20),
      ].join('-');
      info.systemId = systemId;

      const dataView = box.reader.getDataView();
      const pssh = new Uint8Array(dataView.buffer, dataView.byteOffset - 12, box.size);
      info.pssh = Buffer.from(pssh).toString('base64');

      const cencKeyIds: string[] = [];
      if (version >= 1) {
        const kidCount = box.reader.readUint32();
        for (let i = 0; i < kidCount; i++) {
          cencKeyIds.push(Buffer.from(box.reader.readBytes(16)).toString('hex'));
        }
      }

      const dataSize = box.reader.readUint32();
      const systemData = box.reader.readBytes(dataSize);
      const isWidevine = systemIdHex === SYSTEM_ID_WIDEVINE;

      if (isWidevine) {
        // Extract KID from psshData (bytes 2-18)
        const kidBytes = systemData.subarray(2, 18);
        const kidHex = Buffer.from(kidBytes).toString('hex');
        info.kid = kidHex;

        if (info.kid !== ZERO_KID) return;
        info.isMultiDrm = true;
      }
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
