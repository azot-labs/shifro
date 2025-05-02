import { DataViewReader } from '../core/data-view-reader';

export interface TrunSample {
  duration?: number;
  size?: number;
  compositionTimeOffset?: number;
}

export interface ParsedTrun {
  samples: TrunSample[];
  dataOffset: number | null;
}

export const parseTrunBox = (reader: DataViewReader, flags: number, version: number): ParsedTrun => {
  const sampleCount = reader.readUint32();
  const samples: ParsedTrun['samples'] = [];
  let dataOffset: number | null = null;

  // "data_offset"
  if (flags & 0x000001) {
    dataOffset = reader.readInt32();
  }

  // Skip "first_sample_flags" if present.
  if (flags & 0x000004) {
    reader.skip(4);
  }

  for (let i = 0; i < sampleCount; i++) {
    const sample: ParsedTrun['samples'][number] = {};

    // Read "sample duration" if present.
    if (flags & 0x000100) {
      sample.duration = reader.readUint32();
    }

    // Read "sample_size" if present.
    if (flags & 0x000200) {
      sample.size = reader.readUint32();
    }

    // Skip "sample_flags" if present.
    if (flags & 0x000400) {
      reader.skip(4);
    }

    // Read "sample_time_offset" if present.
    if (flags & 0x000800) {
      sample.compositionTimeOffset = version == 0 ? reader.readUint32() : reader.readInt32();
    }

    samples.push(sample);
  }

  return {
    samples,
    dataOffset,
  };
};
