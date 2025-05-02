import { DataViewReader } from '../core/data-view-reader';

export interface SencSubsample {
  bytesOfClearData: number;
  bytesOfEncryptedData: number;
}

export interface SencSample {
  iv: Buffer;
  subsamples: SencSubsample[];
}

export interface ParsedSenc {
  samples: SencSample[];
}

export const parseSencBox = (reader: DataViewReader, flags: number | null): ParsedSenc => {
  if (flags && flags & 1) {
    const algorithmId = reader.readUint8(); // TODO: uint24
    const ivSize = reader.readUint8();
    const kid = reader.readBytes(16);
  }
  const sampleCount = reader.readUint32();
  const samples: ParsedSenc['samples'] = [];
  for (let i = 0; i < sampleCount; i++) {
    const ivSize = 8;
    const iv = Buffer.alloc(16);
    iv.set(reader.readBytes(ivSize));
    const sample: ParsedSenc['samples'][number] = { iv, subsamples: [] };
    const hasSubsamples = flags && flags & 2;
    if (hasSubsamples) {
      const subsampleCount = reader.readUint16();
      for (let j = 0; j < subsampleCount; j++) {
        const bytesOfClearData = reader.readUint16();
        const bytesOfEncryptedData = reader.readUint32();
        sample.subsamples.push({
          bytesOfClearData,
          bytesOfEncryptedData,
        });
      }
    }
    samples.push(sample);
  }
  return { samples };
};
