import * as crypto from 'node:crypto';
import { assert, log } from 'node:console';
import fs, { write } from 'node:fs';
import { expect, test } from 'vitest';
import {
  createFile,
  ISOFile,
  Movie,
  MP4BoxBuffer,
  MultiBufferStream,
  Sample,
  SampleEntry,
  VisualSampleEntry,
  BoxParser,
  DataStream,
} from 'mp4box';
import { ASSET_DATA } from './utils';
import { DataViewReader } from '../lib/data-view-reader';
import { parseHex } from '../lib/buffer';
import { getHash } from '../lib/node/utils';

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

async function decrypt(params: { inputPath: string; outputPath: string; key: string; keyId: string }) {
  const { inputPath, outputPath, key, keyId } = params;

  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  const keepMdatData = true;
  const mp4 = createFile(keepMdatData);
  const inputStream = fs.createReadStream(inputPath);
  const outputStream = fs.createWriteStream(outputPath);

  let bytesRead = 0;

  const outputMp4 = createFile(false);

  inputStream.on('data', (chunk: string | Buffer) => {
    if (typeof chunk === 'string') chunk = Buffer.from(chunk);
    const data = MP4BoxBuffer.fromArrayBuffer(chunk.buffer, bytesRead);
    mp4.appendBuffer(data);
    outputMp4.appendBuffer(data);
    bytesRead += chunk.length;
  });

  const ready = new Promise<Movie>((resolve) => {
    mp4.onReady = resolve;
  });

  const info = await ready;

  const track = info.tracks[0];

  // Create a output stream
  const out = new MultiBufferStream();

  const totalSamples = track.nb_samples;
  mp4.setExtractionOptions(track.id, undefined, { nbSamples: totalSamples });

  // Create initialization segment
  const initStream = new DataStream();
  const ftyp = outputMp4.ftyp;
  const moov = outputMp4.moov;
  const frma = mp4.getBox('frma');
  const stsd = outputMp4.moov.traks[0].mdia.minf.stbl.stsd;
  const encv = outputMp4.getBox('encv');
  const encvData = outputMp4.stream.dataView.buffer.slice(encv.start, encv.start! + encv.size);
  const avc1 = new BoxParser.sampleEntry.avc1();
  avc1.parse(new MultiBufferStream(MP4BoxBuffer.fromArrayBuffer(encvData, 0)));
  avc1.data_reference_index = encv.data_reference_index;
  avc1.width = encv.width;
  avc1.height = encv.height;
  avc1.horizresolution = encv.horizresolution;
  avc1.vertresolution = encv.vertresolution;
  avc1.frame_count = encv.frame_count;
  avc1.compressorname = '';
  avc1.depth = encv.depth;
  for (const box of encv.boxes ?? []) {
    if (box.box_name === 'ProtectionSchemeInfoBox') continue;
    avc1.addBox(box);
  }
  stsd.addEntry(avc1);
  stsd.entries = stsd.entries?.filter((box) => box.constructor.name !== 'encvSampleEntry');
  outputMp4.moov.psshs = [];
  outputMp4.moov.boxes = outputMp4.moov.boxes?.filter((box) => box.box_name !== 'ProtectionSystemSpecificHeaderBox');
  ftyp.write(initStream);
  moov.write(initStream);
  const initData = initStream.buffer;

  outputStream.write(Buffer.from(initData));

  let offset = 0;
  out.insertBuffer(initData);
  offset += initData.byteLength;

  let segmentCount = 0;

  mp4.onSamples = async (id, user, samples) => {
    console.log(`onSamples: ${samples.length}`);

    let moof = mp4.moofs[samples[0].moof_number! - 1];
    let traf = moof.trafs[0];
    let trun = traf.truns[0];

    for (const sample of samples) {
      const sampleIndex = samples.indexOf(sample);
      const { moof, mdat, senc, traf, trun } = getSencForMoofNumber(mp4, sample.moof_number! - 1);
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
      assert(sampleOffset === sample.data!.length);
      const encryptedData = Buffer.concat(encryptedParts);

      const keyBuffer = new Uint8Array(parseHex(key));

      const cipher = crypto.createCipheriv('AES-128-CTR', keyBuffer, sencSample.InitializationVector);
      const plaintext = Buffer.concat([cipher.update(encryptedData), cipher.final()]);

      const decrypted_sample_parts = [];
      let sample_idx = 0;
      let pt_idx = 0;
      for (const subsample of sencSample.subsamples) {
        decrypted_sample_parts.push(sample.data!.subarray(sample_idx, sample_idx + subsample.BytesOfClearData));
        sample_idx += subsample.BytesOfClearData + subsample.BytesOfProtectedData;
        decrypted_sample_parts.push(plaintext.subarray(pt_idx, pt_idx + subsample.BytesOfProtectedData));
        pt_idx += subsample.BytesOfProtectedData;
      }
      const decrypted_sample = Buffer.concat(decrypted_sample_parts);

      sample.description = avc1;
      sample.data = decrypted_sample;
      sample.size = decrypted_sample.byteLength;

      offset += decrypted_sample.byteLength;
      segmentCount++;
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
    const samplesData = Buffer.concat(samples.map((s) => s.data!));
    const samplesMp4Buffer = MP4BoxBuffer.fromArrayBuffer(samplesData.buffer, 0);
    mdat.stream = new MultiBufferStream(samplesMp4Buffer);
    mdat.write(stream);

    const mdatBuffer = Buffer.from(stream.buffer);
    outputStream.write(mdatBuffer);

    const lastSampleNum = Math.max(...samples.map((s) => s.moof_number!));
    const nextSampleNum = lastSampleNum + 1;
    mp4.releaseUsedSamples(id, nextSampleNum);
  };

  mp4.start();

  await new Promise<void>((resolve, reject) => {
    inputStream.on('error', reject);
    inputStream.on('close', () => {
      console.log('inputStream.on.close');
      resolve();
    });
    inputStream.on('end', () => {
      console.log('inputStream.on.end');
      resolve();
      mp4.flush();
      outputMp4.flush();
    });
  });

  return outputPath;
}

test('decrypting with mp4box.js', async () => {
  const output = await decrypt({
    inputPath: ASSET_DATA.inputPath,
    outputPath: ASSET_DATA.outputPath,
    key: ASSET_DATA.keyValue,
    keyId: ASSET_DATA.keyId,
  });
  const actualHash = await getHash(output);
  const expectedHash = 'a4a4594c30072ab023a9dd9313fc5ec6bc203dc3920ef28eb951f5426229a93d';
  expect(actualHash).toBe(expectedHash);
});
