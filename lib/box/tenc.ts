import { DataViewReader } from '../core/data-view-reader';

// Track Encryption Box (TENC)
export const parseTencBox = (reader: DataViewReader) => {
  reader.readUint8(); // reserved
  reader.readUint8();
  reader.readUint8(); // default_isProtected
  reader.readUint8(); // default_Per_Sample_IV_Size
  const defaultKID = Buffer.from(reader.readBytes(16)).toString('hex');
  return { defaultKID };
};
