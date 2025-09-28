import { AllRegisteredBoxes, ISOFile, Sample } from 'mp4box';
import { DataViewReader } from './data-view-reader';

export type Frma = AllRegisteredBoxes['frma'];
export type Schm = AllRegisteredBoxes['schm'];
export type Schi = AllRegisteredBoxes['schi'] & { tenc: AllRegisteredBoxes['tenc'] };
export type Sinf = AllRegisteredBoxes['sinf'] & { frma: Frma; schm: Schm; schi: Schi };
export type Encv = AllRegisteredBoxes['encv'] & { sinf: Sinf };

export const getSampleDescription = (sample: Sample) => {
  const sampleDescription = sample.description as Encv;
  const sinf = sampleDescription.sinf;
  const frma = sinf.frma;
  const dataFormat = frma.data_format;
  const schm = sinf.schm;
  const schemeType = schm.scheme_type as 'cenc' | 'cbcs';
  const schemeVersion = schm.scheme_version;
  const schi = sinf.schi;
  const tenc = schi.tenc;
  const defaultKID = tenc.default_KID;
  const defaultPerSampleIVSize = tenc.default_Per_Sample_IV_Size;
  return { dataFormat, schemeType, schemeVersion, defaultKID, defaultPerSampleIVSize };
};

export const getSenc = (mp4: ISOFile, moofIndex: number, perSampleIvSize: number) => {
  const moof = mp4.moofs[moofIndex];
  const traf = moof.trafs[0];
  const trun = traf.truns[0];
  const senc = traf.senc; // XXX: is trafs[0] always correct?

  const reader = new DataViewReader(senc.data);
  const sampleCount = reader.readUint32();
  senc.samples = [];
  for (let i = 0; i < sampleCount; i++) {
    const sampleSize = trun.sample_size[i];
    const sampleDuration = trun.sample_duration[i];
    const sample: Record<string, any> = {};
    const iv = new Uint8Array(16);
    iv.set(reader.readBytes(perSampleIvSize));
    sample.InitializationVector = iv;
    if (senc.flags & 0x2) {
      sample.subsamples = [];
      const subsampleCount = reader.readUint16();
      for (let j = 0; j < subsampleCount; j++) {
        let subsample: Record<string, any> = {};
        subsample.BytesOfClearData = reader.readUint16();
        subsample.BytesOfProtectedData = reader.readUint32();
        sample.subsamples.push(subsample);
      }
    }
    senc.samples.push(sample);
  }

  return { moof, traf, trun, senc };
};
