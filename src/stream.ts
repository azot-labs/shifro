import { BoxParser, createFile, DataStream, ISOFile, Movie, MP4BoxBuffer, MultiBufferStream, Sample } from 'mp4box';
import { concatUint8Array } from './buffer';
import { DataViewReader } from './data-view-reader';

export type EncryptionScheme = 'cenc' | 'cbcs';

export type TransformSampleParams = {
  encryptionScheme?: EncryptionScheme;
  data: Uint8Array;
  // Initialization Vector (IV) of sample
  iv: Uint8Array;
  // Presentation timestamp (PTS) of sample in the media timeline
  timestamp: number;
};

export type TransformSampleFn = (params: TransformSampleParams) => Promise<Uint8Array | null>;

function getSencForMoofNumber(mp4: ISOFile, num: number) {
  const tenc = mp4.getBox('tenc');
  const isProtected = tenc.default_isProtected;
  const kid = tenc.default_KID;
  const perSampleIvSize = tenc.default_Per_Sample_IV_Size;

  const moof = mp4.moofs[num];
  const mdat = mp4.mdats[num];
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

  return { moof, mdat, traf, trun, senc };
}

type DecryptTransformerOptions = {
  transformSample?: TransformSampleFn;
  onProgress?: (bytesProcessed: number) => void;
};

class DecryptTransformer {
  private input: ISOFile;
  private inputReady: Promise<Movie>;
  private output: ISOFile;

  private buffer = new Uint8Array();
  private bytesRead = 0;
  private processedBytes = 0;
  private samplesProcessingQueue: Promise<Uint8Array>[] = [];

  constructor(private options: DecryptTransformerOptions = {}) {
    this.input = createFile(true);
    this.output = createFile(false);

    this.inputReady = new Promise<Movie>((resolve) => {
      this.input.onReady = resolve;
    });

    this.inputReady.then((info) => {
      // TODO: Handle multiple tracks
      const track = info.tracks[0];
      const totalSamples = track.nb_samples;
      this.input.setExtractionOptions(track.id, undefined, { nbSamples: totalSamples });

      const init = this.processInit();
      this.buffer = concatUint8Array([this.buffer, init]);

      this.input.onSamples = (_id, _user, samples) => {
        this.samplesProcessingQueue.push(this.processSamples(samples));
      };

      this.input.start();
    });
  }

  processInit() {
    const initStream = new DataStream();
    const ftyp = this.output.ftyp;
    const moov = this.output.moov;
    const trak = moov.traks[0];
    const stsd = trak.mdia.minf.stbl.stsd;
    type EncSampleEntry = ReturnType<typeof this.input.getBox<'encv'>>;
    const encSampleEntry = stsd.entries?.find((box) => !box.box_name) as unknown as EncSampleEntry;
    const sinf = encSampleEntry.sinf as ReturnType<typeof this.input.getBox<'sinf'>>;
    const frma = sinf.frma as ReturnType<typeof this.input.getBox<'frma'>>;
    const decSampleEntry: ReturnType<typeof this.input.getBox<'avc1'>> = new BoxParser.sampleEntry[frma.data_format]();
    for (const key of Object.keys(encSampleEntry)) {
      decSampleEntry.set(key, encSampleEntry[key]);
    }
    decSampleEntry.boxes = decSampleEntry.boxes?.filter((box) => box.box_name !== 'ProtectionSchemeInfoBox');
    stsd.addEntry(decSampleEntry);
    stsd.entries = stsd.entries?.filter((box) => !!box.box_name); // Remove encvSampleEntry, etc.
    moov.psshs = [];
    moov.boxes = this.output.moov.boxes?.filter((box) => box.box_name !== 'ProtectionSystemSpecificHeaderBox');
    ftyp.write(initStream);
    moov.write(initStream);
    return new Uint8Array(initStream.buffer);
  }

  async processSamples(samples: Sample[]) {
    const trackId = samples[0].track_id;
    let moof = this.input.moofs[samples[0].moof_number! - 1];
    let traf = moof.trafs[0];
    let trun = traf.truns[0];

    for (const sample of samples) {
      const { senc } = getSencForMoofNumber(this.input, sample.moof_number! - 1);
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

      const transformResult = await this.options.transformSample?.({
        data: encryptedData,
        iv: sencSample.InitializationVector,
        timestamp: sample.cts!, // TODO: Check if this is correct
        encryptionScheme: 'cenc', // TODO: Set real encryption scheme
        // TODO: Also pass default KID so transformSample can check matching KID if multiple keys are provided
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
    const samplesData = concatUint8Array(samples.map((s) => s.data!));
    const samplesMp4Buffer = MP4BoxBuffer.fromArrayBuffer(samplesData.buffer, 0);
    mdat.stream = new MultiBufferStream(samplesMp4Buffer);
    mdat.write(stream);

    const segment = new Uint8Array(stream.buffer);

    const lastSampleNum = Math.max(...samples.map((s) => s.moof_number!));
    const nextSampleNum = lastSampleNum + 1;
    this.input.releaseUsedSamples(trackId, nextSampleNum);

    return segment;
  }

  async transform(chunk: Uint8Array, controller: TransformStreamDefaultController) {
    try {
      const boxBuffer = MP4BoxBuffer.fromArrayBuffer(chunk.buffer, this.bytesRead);
      this.input.appendBuffer(boxBuffer);
      this.output.appendBuffer(boxBuffer);
      this.bytesRead += chunk.length;

      if (this.samplesProcessingQueue.length > 0) {
        const segments = await Promise.all(this.samplesProcessingQueue);
        this.samplesProcessingQueue = [];
        const processed = concatUint8Array(segments);
        this.buffer = concatUint8Array([this.buffer, processed]);
      }

      if (this.buffer.length > 0) {
        controller.enqueue(this.buffer);
        this.updateProgress(this.buffer.byteLength);
        this.buffer = new Uint8Array();
      }
    } catch (error) {
      controller.error(error);
    }
  }

  async flush(controller: TransformStreamDefaultController) {
    if (this.buffer.length > 0) {
      controller.enqueue(this.buffer);
      this.updateProgress(this.buffer.byteLength);
    }
  }

  private updateProgress(bytes: number) {
    this.processedBytes += bytes;
    if (this.options.onProgress) {
      this.options.onProgress(this.processedBytes);
    }
  }
}

export class DecryptStream extends TransformStream {
  constructor(options: DecryptTransformerOptions = {}) {
    const transformer = new DecryptTransformer(options);
    super({
      transform: (chunk, controller) => transformer.transform(chunk, controller),
      flush: (controller) => transformer.flush(controller),
    });
  }
}
