import { ParsedBox } from '../parser';

// Protection System Specific Header (PSSH)
export const parsePsshBox = (box: ParsedBox) => {
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
