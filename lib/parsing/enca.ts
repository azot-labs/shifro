import { DataViewReader } from '../data-view-reader';

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
