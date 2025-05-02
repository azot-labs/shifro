import { DataViewReader } from './data-view-reader';
import { ParsedBox } from './parser';

// Protection System Specific Header (PSSH)
export const parsePSSH = (box: ParsedBox) => {
  const SYSTEM_ID_WIDEVINE = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed'.replaceAll('-', '');
  const version = box.version ?? 0;
  if (version !== 0 && version !== 1) throw new Error('PSSH version can only be 0 or 1');
  const systemIdBytes = box.reader.readBytes(16);
  const systemIdHex = Buffer.from(systemIdBytes).toString('hex');
  const systemIdUuid = [
    systemIdHex.slice(0, 8),
    systemIdHex.slice(8, 12),
    systemIdHex.slice(12, 16),
    systemIdHex.slice(16, 20),
    systemIdHex.slice(20),
  ].join('-');

  const dataView = box.reader.getDataView();
  const pssh = new Uint8Array(dataView.buffer, dataView.byteOffset - 12, box.size);
  const psshBase64 = Buffer.from(pssh).toString('base64');

  const keyIds: string[] = [];
  if (version >= 1) {
    const kidCount = box.reader.readUint32();
    for (let i = 0; i < kidCount; i++) {
      keyIds.push(Buffer.from(box.reader.readBytes(16)).toString('hex'));
    }
  }

  const dataSize = box.reader.readUint32();
  const systemData = box.reader.readBytes(dataSize);
  const isWidevine = systemIdHex === SYSTEM_ID_WIDEVINE;

  if (isWidevine) {
    // Need to use Protobuf to parse Widevine PSSH
  }

  return { version, systemId: systemIdUuid, pssh: psshBase64, keyIds, systemData };
};

// Track Encryption Box (TENC)
export const parseTENC = (reader: DataViewReader) => {
  reader.readUint8(); // reserved
  reader.readUint8();
  reader.readUint8(); // default_isProtected
  reader.readUint8(); // default_Per_Sample_IV_Size
  const defaultKID = Buffer.from(reader.readBytes(16)).toString('hex');
  return { defaultKID };
};

export const visualSampleEntry = (reader: DataViewReader) => {
  // Skip 6 reserved bytes.
  // Skip 2-byte data reference index.
  // Skip 16 more reserved bytes.
  reader.skip(24);
  // 4 bytes for width/height.
  const width = reader.readUint16();
  const height = reader.readUint16();
  // Skip 8 bytes for horizontal/vertical resolution.
  // Skip 4 more reserved bytes (0)
  // Skip 2-byte frame count.
  // Skip 32-byte compressor name (length byte, then name, then 0-padding).
  // Skip 2-byte depth.
  // Skip 2 more reserved bytes (0xff)
  reader.skip(50);
  return { width, height };
};

export const audioSampleEntry = (reader: DataViewReader) => {
  reader.skip(6); // Skip "reserved"
  reader.skip(2); // Skip "data_reference_index"
  reader.skip(8); // Skip "reserved"
  const channelCount = reader.readUint16();
  reader.skip(2); // Skip "sample_size"
  reader.skip(2); // Skip "pre_defined"
  reader.skip(2); // Skip "reserved"
  const sampleRate = reader.readUint16() + reader.readUint16() / 65536;

  return { channelCount, sampleRate };
};

export const parseTFHD = (reader: DataViewReader, flags: number) => {
  let defaultSampleDuration: number | null = null;
  let defaultSampleSize: number | null = null;
  let baseDataOffset: number | null = null;
  let sampleDescriptionIndex: number | null = null;

  const trackId = reader.readUint32(); // Read "track_ID"

  // Read "base_data_offset" if present.
  if (flags & 0x000001) {
    baseDataOffset = reader.readUint64();
  }

  // Read "sample_description_index" if present.
  if (flags & 0x000002) {
    sampleDescriptionIndex = reader.readUint32();
  }

  // Read "default_sample_duration" if present.
  if (flags & 0x000008) {
    defaultSampleDuration = reader.readUint32();
  }

  // Read "default_sample_size" if present.
  if (flags & 0x000010) {
    defaultSampleSize = reader.readUint32();
  }

  return {
    trackId,
    defaultSampleDuration,
    defaultSampleSize,
    baseDataOffset,
    sampleDescriptionIndex,
  };
};

type ParsedTrun = {
  sampleCount: number;
  sampleData: {
    sampleDuration: number | null;
    sampleSize: number | null;
    sampleCompositionTimeOffset: number | null;
  }[];
  dataOffset: number | null;
};

export const parseTRUN = (reader: DataViewReader, flags: number, version: number): ParsedTrun => {
  const sampleCount = reader.readUint32();
  const sampleData = [];
  let dataOffset = null;

  // "data_offset"
  if (flags & 0x000001) {
    dataOffset = reader.readInt32();
  }

  // Skip "first_sample_flags" if present.
  if (flags & 0x000004) {
    reader.skip(4);
  }

  for (let i = 0; i < sampleCount; i++) {
    const sample: ParsedTrun['sampleData'][number] = {
      sampleDuration: null,
      sampleSize: null,
      sampleCompositionTimeOffset: null,
    };

    // Read "sample duration" if present.
    if (flags & 0x000100) {
      sample.sampleDuration = reader.readUint32();
    }

    // Read "sample_size" if present.
    if (flags & 0x000200) {
      sample.sampleSize = reader.readUint32();
    }

    // Skip "sample_flags" if present.
    if (flags & 0x000400) {
      reader.skip(4);
    }

    // Read "sample_time_offset" if present.
    if (flags & 0x000800) {
      sample.sampleCompositionTimeOffset = version == 0 ? reader.readUint32() : reader.readInt32();
    }

    sampleData.push(sample);
  }

  return {
    sampleCount,
    sampleData,
    dataOffset,
  };
};

type ParsedSenc = {
  samples: {
    iv: Buffer;
    subSamples: {
      clearDataBytes: number;
      encryptedDataBytes: number;
    }[];
  }[];
};

export const parseSENC = (reader: DataViewReader, flags: number | null): ParsedSenc => {
  const samplesCount = reader.readUint32();
  const hasSubSamples = flags && flags & 0x000002;
  const ivSize = 8;
  const samples: ParsedSenc['samples'] = [];
  for (let i = 0; i < samplesCount; i++) {
    const iv = Buffer.from(reader.readBytes(ivSize));
    const sample: ParsedSenc['samples'][number] = { iv, subSamples: [] };
    if (hasSubSamples) {
      const subSampleCount = reader.readUint16();
      for (let j = 0; j < subSampleCount; j++) {
        const clearDataBytes = reader.readUint16();
        const encryptedDataBytes = reader.readUint32();
        sample.subSamples.push({
          clearDataBytes,
          encryptedDataBytes,
        });
      }
    }
    samples.push(sample);
  }
  return { samples };
};
