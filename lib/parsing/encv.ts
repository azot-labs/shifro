import { DataViewReader } from '../data-view-reader';

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
