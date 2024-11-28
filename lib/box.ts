export interface MpegBox {
  $uid?: number;
  name: string;
  headerStart: number;
  payloadStart: number;
  end: number;
  children?: any[];
  version?: number;
  flags?: number;
}

const createIndex = (s: any) =>
  s.reduce((a: any, b: any) => {
    a[b] = true;
    return a;
  }, {});

const KNOWN_FULL_BOXES = createIndex([
  'mvhd',
  'tkhd',
  'mdhd',
  'hdlr',
  'vmhd',
  'smhd',
  'hmhd',
  'nmhd',
  'url ',
  'urn ',
  'dref',
  'stts',
  'ctts',
  'stsd',
  'stsz',
  'stsc',
  'stco',
  'co64',
  'stss',
  'stsh',
  'stdp',
  'padb',
  'elst',
  'cprt',
  'mehd',
  'trex',
  'mfhd',
  'tfhd',
  'trun',
  'tfra',
  'mfro',
  'sdtp',
  'sbgp',
  'sgpd',
  'stsl',
  'subs',
  'pdin',
  'meta',
  'xml ',
  'bxml',
  'iloc',
  'pitm',
  'ipro',
  'infe',
  'iinf',
  'imif',
  'ipmc',
  'schm',
  'srpp',
  'elng',
  'cslg',
  'saiz',
  'saio',
  'tfdt',
  'leva',
  'trep',
  'assp',
  'tsel',
  'kind',
  'mere',
  'iref',
  'fiin',
  'fpar',
  'fecr',
  'gitn',
  'fire',
  'stri',
  'stsg',
  'stvi',
  'sidx',
  'ssix',
  'prft',
  'srpp',
  'srat',
  'chnl',
  'dmix',
  'txtC',
  'uri ',
  'uriI',
  'sthd',
  'senc',
  // and maybe some more
]);

const KNOWN_HAVE_CHILDREN = createIndex([
  'moov', // Movie container
  'trak', // Track container
  'edts', // Edit container
  'mdia', // Media container
  'minf', // Media information container
  'dinf', // Data information container
  'stbl', // Sample table container
  'mvex', // Movie extends container
  'moof', // Movie fragment
  'traf', // Track fragment
  'mfra', // Movie fragment random access
  'skip', // Free space
  'meta', // Metadata container
  'sinf', // Protection scheme information
  'schi', // Scheme information
  'encv', // Encrypted video container
  'enca', // Encrypted audio container
  'stsd', // Sample descriptions (codec types, initialization data)
]);

const BOX_NAMES = {
  ROOT: '$root',
  SENC: 'senc',
  TRUN: 'trun',
  TFHD: 'tfhd',
  MDAT: 'mdat',
} as const;

const parseStsdBox = (data: Buffer, box: MpegBox) => {
  try {
    let offset = box.payloadStart;

    // Skip reserved bytes
    offset += 4;

    // Read entry count
    const entryCount = data.readUInt32BE(offset);
    offset += 4;

    box.children = [];

    // Try to find encv/enca directly
    const encvMatch = data.indexOf('encv', offset);
    const encaMatch = data.indexOf('enca', offset);

    if (encvMatch >= 0 && encvMatch < box.end) {
      // Found encv box
      const entryBox: MpegBox = {
        name: 'encv',
        headerStart: encvMatch - 4,
        payloadStart: encvMatch + 4,
        end: box.end, // Use stsd box end since size might be corrupted
      };
      box.children.push(entryBox);
    } else if (encaMatch >= 0 && encaMatch < box.end) {
      // Found enca box
      const entryBox: MpegBox = {
        name: 'enca',
        headerStart: encaMatch - 4,
        payloadStart: encaMatch + 4,
        end: box.end, // Use stsd box end since size might be corrupted
      };
      box.children.push(entryBox);
    }
  } catch (e) {
    console.warn('Error parsing stsd box:', e);
  }
};

const parseSingleMpegBox = (data: Buffer, offset: number, forceFull = false) => {
  const start = offset;

  try {
    if (offset + 8 > data.length) {
      throw new Error('Not enough data to read box header');
    }

    let size = data.readUInt32BE(offset);
    offset += 4;
    const name = data.toString('ascii', offset, offset + 4);
    offset += 4;

    if (!/^[\x20-\x7E]{4}$/.test(name)) {
      throw new Error(`Invalid box name: ${name}`);
    }

    const ret: MpegBox = {
      name,
      headerStart: start,
      payloadStart: offset,
      end: start + size,
    };

    if (size === 0) {
      ret.end = data.length;
    } else if (size === 1) {
      if (offset + 8 > data.length) {
        throw new Error('Not enough data to read extended size');
      }
      const highBits = data.readUInt32BE(offset);
      const lowBits = data.readUInt32BE(offset + 4);
      offset += 8;
      const largeSize = highBits * 0x100000000 + lowBits;
      ret.end = start + largeSize;
      ret.payloadStart = offset;
    }

    if (forceFull || KNOWN_FULL_BOXES[name]) {
      if (offset + 4 > data.length) {
        throw new Error('Not enough data to read version and flags');
      }
      const version = data[offset++];
      const flags = data.readUIntBE(offset, 3);
      offset += 3;
      ret.payloadStart = offset;
      ret.version = version;
      ret.flags = flags;
    }

    if (ret.end > data.length) {
      const boxInfo = {
        name,
        start,
        calculatedEnd: ret.end,
        bufferLength: data.length,
        size: ret.end - start,
        payloadStart: ret.payloadStart,
      };
      console.warn('Box boundary error:', boxInfo);
      throw new Error(`Box extends beyond buffer: ${JSON.stringify(boxInfo)}`);
    }

    return ret;
  } catch (e: any) {
    console.warn(`Error parsing box at offset ${offset}:`, e.message);
    throw e;
  }
};

const parseBoxes = (data: Buffer, parentBox: MpegBox, startOffset: number) => {
  let pos = startOffset;

  while (pos < parentBox.end) {
    try {
      const box = parseSingleMpegBox(data, pos);
      if (!box) break;

      parentBox.children?.push(box);

      if (box.name === 'stsd') {
        // Special handling for stsd box
        parseStsdBox(data, box);
      } else if (KNOWN_HAVE_CHILDREN[box.name]) {
        box.children = [];
        parseBoxes(data, box, box.payloadStart);
      }

      pos = box.end;
    } catch (e) {
      console.warn('Error parsing box at position', pos, e);
      break;
    }
  }
};

export const parseMpegBoxes = (data: Buffer) => {
  const root: MpegBox = {
    name: BOX_NAMES.ROOT,
    headerStart: 0,
    payloadStart: 0,
    end: data.length,
    children: [],
  };

  parseBoxes(data, root, 0);
  return root;
};

export const findMpegBoxesByName = (data: Buffer, rootBox: MpegBox, boxName: string, limit = Infinity) => {
  const ret = [];

  const stack = [rootBox];
  const searchPositions: Record<number, any> = {};
  const addedToRet: Record<number, any> = {};
  let nextUid = 1;

  while (stack.length) {
    if (!stack[0].$uid) stack[0].$uid = nextUid++;

    if (stack[0].name === boxName && !addedToRet[stack[0].$uid]) {
      addedToRet[stack[0].$uid] = true;
      ret.push(stack[0]);
      if (ret.length >= limit) return ret;
    }

    if (stack[0].children) {
      if (!searchPositions[stack[0].$uid]) searchPositions[stack[0].$uid] = 0;

      if (searchPositions[stack[0].$uid] >= stack[0].children.length) {
        stack.shift();
        continue;
      }

      stack.unshift(stack[0].children[searchPositions[stack[0].$uid]++]);
    } else {
      stack.shift();
    }
  }

  return ret;
};

export const findMpegBoxByName = (data: Buffer, rootBox: MpegBox, boxName: string): MpegBox | null => {
  // Use a queue for breadth-first search instead of stack
  const queue: MpegBox[] = [rootBox];

  while (queue.length > 0) {
    const currentBox = queue.shift()!;

    // Check current box
    if (currentBox.name === boxName) {
      return currentBox;
    }

    // Add children to queue
    if (currentBox.children && currentBox.children.length > 0) {
      queue.push(...currentBox.children);
    }
  }

  return null;
};

export const replaceBoxName = (data: Buffer, rootBox: MpegBox, from: string, to: string) => {
  for (const { headerStart } of findMpegBoxesByName(data, rootBox, from)) {
    data.write(to, headerStart + 4);
  }
};

export const tryParseSenc = (buf: Buffer, box: MpegBox, ivSize = 8) => {
  const ret: any[] = [];

  if (box.name !== BOX_NAMES.SENC) return null;
  const hasSubSamples = box.flags && box.flags & 0x000002;

  let offset = box.payloadStart;

  const sampleCount = buf.readUInt32BE(offset);
  offset += 4;
  for (let i = 0; i < sampleCount; i++) {
    const iv = Buffer.alloc(16);
    buf.copy(iv, 0, offset, offset + ivSize);
    offset += ivSize;

    const it: any = {
      iv,
      subSamples: [],
    };

    if (hasSubSamples) {
      const subSampleCount = buf.readUInt16BE(offset);
      offset += 2;

      for (let j = 0; j < subSampleCount; j++) {
        const clearDataBytes = buf.readUInt16BE(offset);
        const encryptedDataBytes = buf.readUInt32BE(offset + 2);
        offset += 6;
        it.subSamples.push({
          clearDataBytes,
          encryptedDataBytes,
        });
      }
    }

    ret.push(it);
  }

  if (offset !== box.end) return null;
  return ret;
};

export const tryParseTrun = (buf: Buffer, box: MpegBox) => {
  try {
    const ret: any[] = [];

    if (box.name !== BOX_NAMES.TRUN) return null;
    let offset = box.payloadStart;

    const sampleCount = buf.readUInt32BE(offset);
    offset += 4;

    if (/* data‐offset‐present */ box.flags && box.flags & 0x0001) {
      offset += 4;
    }
    if (/* first‐sample‐flags‐present */ box.flags && box.flags & 0x0004) {
      offset += 4;
    }

    for (let i = 0; i < sampleCount; i++) {
      const s: any = {};

      if (/* sample‐duration‐present */ box.flags && box.flags & 0x0100) {
        s.duration = buf.readUInt32BE(offset);
        offset += 4;
      }
      if (/* sample‐size‐present */ box.flags && box.flags & 0x0200) {
        s.size = buf.readUInt32BE(offset);
        offset += 4;
      }
      if (/* sample‐flags‐present */ box.flags && box.flags & 0x0400) {
        offset += 4;
      }
      if (/* sample‐composition‐time‐offsets‐present */ box.flags && box.flags & 0x0800) {
        offset += 4;
      }

      ret.push(s);
    }

    if (offset !== box.end) return null;
    return ret;
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
};

export const tryParseTfhd = (buf: Buffer, box: MpegBox) => {
  try {
    const ret: any = {};

    if (box.name !== BOX_NAMES.TFHD) return null;
    let offset = box.payloadStart;

    // track_id
    offset += 4;

    if (/* base‐data‐offset‐present */ box.flags && box.flags & 0x000001) {
      offset += 8;
    }
    if (/* sample‐description‐index‐present */ box.flags && box.flags & 0x000002) {
      offset += 4;
    }
    if (/* default‐sample‐duration‐present */ box.flags && box.flags & 0x000008) {
      ret.defaultDuration = buf.readUInt32BE(offset);
      offset += 4;
    }
    if (/* default‐sample‐size‐present */ box.flags && box.flags & 0x000010) {
      ret.defaultSize = buf.readUInt32BE(offset);
      offset += 4;
    }
    if (/* default‐sample‐flags‐present */ box.flags && box.flags & 0x000020) {
      offset += 4;
    }
    if (/* duration‐is‐empty */ box.flags && box.flags & 0x010000) {
      ret.defaultDuration = 0;
      offset += 4;
    }

    if (offset !== box.end) return null;
    return ret;
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
};
