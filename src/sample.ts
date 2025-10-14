import { AllRegisteredBoxes, BoxParser, DataStream, ISOFile, MP4BoxBuffer, MultiBufferStream, Sample } from 'mp4box';
import { DataViewReader } from './data-view-reader';
import { concatUint8Array } from './buffer';
import { TransformSampleFn } from './stream';

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

const processSampleGroup = async ({
  input,
  samples,
  transform,
}: {
  input: ISOFile;
  samples: Sample[];
  transform?: TransformSampleFn;
}) => {
  const trackId = samples[0].track_id;
  const moof = input.moofs[samples[0].moof_number! - 1];
  const traf = moof.trafs[0];

  for (const sample of samples) {
    const { schemeType, defaultKID, defaultPerSampleIVSize } = getSampleDescription(sample);
    const moofIndex = sample.moof_number! - 1;
    const { senc } = getSenc(input, moofIndex, defaultPerSampleIVSize);
    const sencSample = senc.samples[sample.number_in_traf!];

    const encryptedParts = [];
    let sampleOffset = 0;
    for (const subsample of sencSample.subsamples) {
      encryptedParts.push(
        sample.data!.subarray(
          sampleOffset + subsample.BytesOfClearData,
          sampleOffset + subsample.BytesOfClearData + subsample.BytesOfProtectedData
        )
      );
      sampleOffset += subsample.BytesOfClearData + subsample.BytesOfProtectedData;
    }

    const encryptedData = concatUint8Array(encryptedParts);

    const transformResult = await transform?.({
      data: encryptedData,
      iv: sencSample.InitializationVector,
      timestamp: sample.cts!, // TODO: Check if this is correct
      encryptionScheme: schemeType,
      kid: defaultKID,
    });

    const decrypted = transformResult!;

    const decryptedParts = [];
    let sample_idx = 0;
    let pt_idx = 0;
    for (const subsample of sencSample.subsamples) {
      decryptedParts.push(sample.data!.subarray(sample_idx, sample_idx + subsample.BytesOfClearData));
      sample_idx += subsample.BytesOfClearData + subsample.BytesOfProtectedData;
      decryptedParts.push(decrypted.subarray(pt_idx, pt_idx + subsample.BytesOfProtectedData));
      pt_idx += subsample.BytesOfProtectedData;
    }
    const decryptedSample = concatUint8Array(decryptedParts);

    sample.data = decryptedSample;
    sample.size = decryptedSample.byteLength;
  }

  traf.boxes = traf.boxes?.filter(
    (box) =>
      box.box_name !== 'PiffSampleEncryptionBox' &&
      box.box_name !== 'SampleEncryptionBox' &&
      box.box_name !== 'SampleAuxiliaryInformationOffsetsBox' &&
      box.box_name !== 'SampleAuxiliaryInformationSizesBox'
  );

  const stream = new DataStream();

  moof.write(stream);
  moof.trafs[0].truns[0].data_offset = moof.size + 8;
  stream.adjustUint32(moof.trafs[0].truns[0].data_offset_position, moof.trafs[0].truns[0].data_offset);

  const mdat = new BoxParser.box.mdat();
  const samplesWithData = samples.filter((s) => !!s.data);
  const samplesData = concatUint8Array(samplesWithData.map((s) => s.data!));
  const samplesMp4Buffer = MP4BoxBuffer.fromArrayBuffer(samplesData.buffer, 0);
  mdat.stream = new MultiBufferStream(samplesMp4Buffer);
  mdat.write(stream);

  const segment = new Uint8Array(stream.buffer);

  const moofNumbers = samples.map((s) => s.moof_number!);
  const maxMoofNumber = Math.max(...moofNumbers);
  const lastSampleNum = maxMoofNumber;
  const nextSampleNum = lastSampleNum + 1; // TODO: Check if this really next sample number

  return { data: segment, trackId, nextSampleNum };
};

export const processSamples = async ({
  input,
  samples,
  transform,
}: {
  input: ISOFile;
  samples: Sample[];
  transform?: TransformSampleFn;
}) => {
  const groupedSamples = Object.groupBy(samples, (sample) => sample.moof_number!);
  let trackId = samples[0].track_id;
  let data = new Uint8Array();
  let nextSampleNum = 0;
  for (const moofNumber in groupedSamples) {
    const samples = groupedSamples[moofNumber]!;
    const sampleGroup = await processSampleGroup({ input, samples, transform });
    data = concatUint8Array([data, sampleGroup.data]);
    nextSampleNum = sampleGroup.nextSampleNum;
  }
  return { data, nextSampleNum, trackId };
};
