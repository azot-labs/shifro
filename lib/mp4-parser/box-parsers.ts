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
    // Need to use Protobuf to parse Widevine PSSH
  }

  return { version, systemId: systemIdUuid, pssh: psshBase64, cencKeyIds, systemData };
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
