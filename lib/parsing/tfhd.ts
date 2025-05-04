import { DataViewReader } from '../data-view-reader';

export type ParsedTfhd = ReturnType<typeof parseTfhdBox>;

export const parseTfhdBox = (reader: DataViewReader, flags: number) => {
  let defaultSampleDuration: number | undefined;
  let defaultSampleSize: number | undefined;
  let baseDataOffset: number | undefined;
  let sampleDescriptionIndex: number | undefined;

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
