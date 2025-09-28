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

  const keepMdatData = true;
  const mp4 = createFile(keepMdatData);
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  // const inputData = fs.readFileSync(inputPath);
  const inputStream = fs.createReadStream(inputPath);

  const outputStream = fs.createWriteStream(outputPath);
  // const outputMp4 = createFile(keepMdatData);

  let bytesRead = 0;

  const outputMp4 = createFile(false);

  inputStream.on('data', (chunk: string | Buffer) => {
    if (typeof chunk === 'string') chunk = Buffer.from(chunk);
    const data = MP4BoxBuffer.fromArrayBuffer(chunk.buffer, bytesRead);
    mp4.appendBuffer(data);
    outputMp4.appendBuffer(data);
    bytesRead += chunk.length;
    // console.log({ bytesRead, inputDataSize: inputData.length });
  });

  // inputStream.close();

  const ready = new Promise<Movie>((resolve) => {
    mp4.onReady = resolve;
  });

  const info = await ready;

  // console.log(info);

  const track = info.tracks[0];

  // Create a output stream
  const out = new MultiBufferStream();

  const totalSamples = track.nb_samples;
  mp4.setExtractionOptions(track.id, undefined, { nbSamples: totalSamples });
  // mp4.setSegmentOptions(track.id, undefined, {
  //   nbSamples: track.nb_samples,
  //   nbSamplesPerFragment: track.nb_samples,
  //   rapAlignement: true,
  // });

  const frma = mp4.getBox('frma');

  // console.log({ moov: mp4.moov });
  // const moovData = mp4.stream.dataView.buffer.slice(mp4.moov.start!, mp4.moov.start! + mp4.moov.size);
  // console.log(Buffer.from(moovData).toString('utf8'));
  // console.log(Buffer.from(moovData).length);
  // const initMoov = new BoxParser.box.moov();
  // const initMoovDs = new MultiBufferStream(MP4BoxBuffer.fromArrayBuffer(moovData, 0));
  // initMoov.parse(initMoovDs);

  const stsd = outputMp4.moov.traks[0].mdia.minf.stbl.stsd;
  const encv = outputMp4.getBox('encv');
  // encv.
  const encvData = outputMp4.stream.dataView.buffer.slice(encv.start, encv.start! + encv.size);
  // console.log({ encv });
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
  // outputMp4.moov.boxes = outputMp4.moov.boxes?.filter((box) => box.box_name !== 'MovieExtendsBox');

  outputMp4.moov.mvex!.trexs[0].default_sample_duration = 0;
  outputMp4.moov.mvex!.trexs[0].default_sample_flags = 0;

  const initStream = new DataStream();
  // const total_duration = outputMp4.moov?.mvex?.mehd.fragment_duration;
  const ftyp = outputMp4.ftyp;
  const moov = outputMp4.moov;
  ftyp.write(initStream);
  // const mvex = moov.addBox(new BoxParser.box.mvex());
  // if (total_duration) {
  //   const mehd = mvex.addBox(new BoxParser.box.mehd());
  //   mehd.fragment_duration = total_duration;
  // }
  // for (let i = 0; i < moov.traks.length; i++) {
  //   const trex = mvex.addBox(new BoxParser.box.trex());
  //   trex.track_id = moov.traks[i].tkhd.track_id;
  //   trex.default_sample_description_index = 1;
  //   trex.default_sample_duration = moov.traks[i].samples[0]?.duration ?? 0;
  //   trex.default_sample_size = 0;
  //   trex.default_sample_flags = 1 << 16;
  // }
  moov.write(initStream);
  const initData = initStream.buffer;
  // const initData = ISOFile.writeInitializationSegment(
  //   outputMp4.ftyp,
  //   outputMp4.moov,
  //   outputMp4.moov?.mvex?.mehd.fragment_duration
  // );

  // const lastMvex = outputMp4.moov.boxes?.findLastIndex((box) => box.box_name === 'MovieExtendsBox');
  // console.log({ lastMvex });
  // outputMp4.moov.boxes?.splice(lastMvex!, 1);

  // Initialize the segmentation
  let offset = 0;
  const init = mp4.initializeSegmentation();

  // console.log(mp4.moov.traks[0].mdia.minf.stbl.stsd.entries);

  // Write the initialization segments to the output stream
  out.insertBuffer(init.buffer);
  offset += init.buffer.byteLength;
  // console.log(init);
  outputStream.write(Buffer.from(initData));
  // console.log({ initSize: init.buffer.byteLength, offset });
  console.log('init data:');
  console.log(Buffer.from(initData).toString('utf8'));

  // outputStream.write(Buffer.from(initData));

  // TODO: Use writeStream to write to file
  // fs.copyFileSync(inputPath, outputPath); // start off with a copy of the input file
  // const outfile = fs.openSync(outputPath, 'r+');

  let segmentCount = 0;
  // mp4.onSegment = (id, user, buffer, nextSample, last) => {
  //   console.log(`onSegment. Size: ${buffer.byteLength}. Last: ${last}. Next sample: ${nextSample}`);
  //   // console.log(`Moofs count: ${mp4.moofs.length}`);

  //   // const track = mp4.getTrackById(id);
  //   const samples = mp4.getTrackSamplesInfo(id).filter((s) => !!s.data);
  //   // const samples = mp4.moov.traks[0].samples.filter((s) => !!s.data);

  //   for (const sample of samples) {
  //     const { mdat, senc } = getSencForMoofNumber(mp4, sample.moof_number! - 1);
  //     const sencSample = senc.samples[sample.number_in_traf!];

  //     const encryptedParts = [];
  //     let sampleOffset = 0;
  //     for (const subsample of sencSample.subsamples) {
  //       encryptedParts.push(
  //         sample.data!.subarray(
  //           sampleOffset + subsample.BytesOfClearData,
  //           sampleOffset + subsample.BytesOfClearData + subsample.BytesOfProtectedData
  //         )
  //       );
  //       sampleOffset += subsample.BytesOfClearData + subsample.BytesOfProtectedData;
  //     }
  //     assert(sampleOffset === sample.data!.length);
  //     const encryptedData = Buffer.concat(encryptedParts);

  //     const keyBuffer = new Uint8Array(parseHex(key));

  //     const cipher = crypto.createCipheriv('AES-128-CTR', keyBuffer, sencSample.InitializationVector);
  //     const plaintext = Buffer.concat([cipher.update(encryptedData), cipher.final()]);

  //     const decrypted_sample_parts = [];
  //     let sample_idx = 0;
  //     let pt_idx = 0;
  //     for (const subsample of sencSample.subsamples) {
  //       decrypted_sample_parts.push(sample.data!.subarray(sample_idx, sample_idx + subsample.BytesOfClearData));
  //       sample_idx += subsample.BytesOfClearData + subsample.BytesOfProtectedData;
  //       decrypted_sample_parts.push(plaintext.subarray(pt_idx, pt_idx + subsample.BytesOfProtectedData));
  //       pt_idx += subsample.BytesOfProtectedData;
  //     }
  //     const decrypted_sample = Buffer.concat(decrypted_sample_parts);

  //     sample.description = avc1;
  //     sample.data = decrypted_sample;
  //     sample.size = decrypted_sample.byteLength;

  //     // if (offset === 854) {
  //     //   console.log({
  //     //     offset,
  //     //     sample,
  //     //     senc,
  //     //     sencSample,
  //     //     sampleSize: sample.size,
  //     //     sampleDataSize: sample.data?.length,
  //     //     decryptedSampleSize: decrypted_sample.length,
  //     //     segmentSize: buffer.byteLength,
  //     //   });
  //     //   console.log(Buffer.from(decrypted_sample.buffer).toString('utf8'));
  //     // }

  //     // out.insertBuffer(MP4BoxBuffer.fromArrayBuffer(decrypted_sample.buffer, offset));
  //     offset += decrypted_sample.byteLength;
  //     segmentCount++;

  //     // console.log(mp4.mdats);
  //     // outputStream.write(decrypted_sample);
  //     // outputStream.write(Buffer.from(moof.data));
  //     // outputStream.write(Buffer.from(mdat.data));
  //     // outputStream.write(sample.data);
  //   }

  //   console.log(samples);

  //   const stream = new DataStream();
  //   const moof = mp4.createMoof(samples);
  //   moof.write(stream);
  //   moof.trafs[0].truns[0].data_offset = moof.size + 8;
  //   stream.adjustUint32(moof.trafs[0].truns[0].data_offset_position, moof.trafs[0].truns[0].data_offset);
  //   const mdat = new BoxParser.box.mdat();
  //   mdat.stream = new MultiBufferStream();
  //   let sampleOffset = 0;
  //   for (const sample of samples) {
  //     if (sample.data) {
  //       const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(sample.data.buffer, sampleOffset);
  //       mdat.stream.insertBuffer(mp4Buffer);
  //       sampleOffset += sample.data.byteLength;
  //     }
  //   }
  //   mdat.write(stream);

  //   outputStream.write(Buffer.from(stream.buffer));

  //   // const moof = mp4.moofs[0];
  //   // const traf = moof.trafs[0];
  //   // const trun = traf?.truns[0];
  //   // const tfhd = traf?.tfhd;
  //   // const senc = traf?.senc as unknown as ReturnType<typeof mp4.getBox<'senc'>>;

  //   // console.log({ moof, traf, tfhd, trun, senc, });
  //   // console.log(mp4.moov.traks[0].samples.filter((s) => !!s.data));

  //   // console.log(Buffer.from(buffer).toString('utf8'));

  //   // console.log({ segmentCount, last });
  //   // if (segmentCount === 3) expect(last).toBe(true);
  //   // else expect(last).toBe(false);
  //   mp4.releaseUsedSamples(id, nextSample);
  // };

  mp4.onSamples = async (id, user, samples) => {
    console.log(`onSamples: ${samples.length}`);
    // console.log(samples.map((s) => s.moof_number).join(', '));

    let moof = mp4.moofs[samples[0].moof_number! - 1];
    let traf = moof.trafs[0];
    let trun = traf.truns[0];
    for (const sample of samples) {
      const sampleIndex = samples.indexOf(sample);
      const { moof, mdat, senc, traf, trun } = getSencForMoofNumber(mp4, sample.moof_number! - 1);
      const sencSample = senc.samples[sample.number_in_traf!];

      // if (offset === 768 && sampleIndex === 0) {
      //   console.log({ skip: true, offset, sampleIndex });
      //   continue;
      // }

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

      // console.log(sample.data?.byteLength === decrypted_sample.byteLength);
      sample.description = avc1;
      sample.data = decrypted_sample;
      sample.size = decrypted_sample.byteLength;

      // traf.boxes = traf.boxes?.filter(
      //   (box) =>
      //     box.box_name !== 'PiffSampleEncryptionBox' &&
      //     box.box_name !== 'SampleEncryptionBox' &&
      //     box.box_name !== 'SampleAuxiliaryInformationOffsetsBox' &&
      //     box.box_name !== 'SampleAuxiliaryInformationSizesBox'
      // );
      // const ds = new DataStream();
      // // console.log(moof);
      // moof.write(ds);
      // const moofData = ds.buffer;
      // const moofBuffer = Buffer.from(moofData);
      // // const moofData = mp4.stream.dataView.buffer.slice(moof.start, moof.start! + moof.size);
      // // console.log({ moof, mdat, sample });
      // if (sampleIndex === 0) {
      //   outputStream.write(moofBuffer);
      //   offset += moofData.byteLength;
      // }

      // const mdatDs = new DataStream();
      // mdat.write(mdatDs);
      // const mdatData = mdatDs.buffer;
      // const mdatPart = Buffer.from(mdatData).subarray(0, trun.data_offset);
      // const mdatWithDecrypted = Buffer.concat([mdatPart, decrypted_sample]);

      // outputStream.write(decrypted_sample);
      // if (offset === 768) {
      //   console.log(Buffer.from(moofData).toString('utf8'));
      // }
      // offset += Buffer.from(moofData).byteLength;

      // if (offset < 4000) {
      //   // console.log(Buffer.from(moofData).toString('utf8'));
      //   console.log(decrypted_sample.toString('utf8'));
      //   console.log({ offset, sampleIndex });
      // }

      offset += decrypted_sample.byteLength;
      segmentCount++;
      // process.exit();
    }

    const stream = new DataStream();
    const moof = mp4.createMoof(samples);
    moof.trafs[0].tfdt.set('version', 1);
    moof.trafs[0].tfhd.set('flags', 131104);
    // moof.trafs[0].tfhd.set('default_sample_description_index', 1);
    // moof.trafs[0].tfhd.set('default_sample_duration', 1000);
    moof.trafs[0].tfhd.set('default_sample_flags', 16842752);
    moof.trafs[0].truns[0].flags = 2821;
    moof.trafs[0].truns[0].first_sample_flags = 33554432;
    // const uuid = mp4.moofs[samples[0].moof_number! - 1]?.trafs[0].boxes?.find(
    //   (b) => b.box_name === 'PiffSampleEncryptionBox'
    // );
    // console.log(uuid);
    // if (uuid) {
    // uuid.uuid = '';
    // uuid.set('uuid', 'a2394f525a9b4f14a2446c427c648df4');
    // moof.trafs[0].addBox(uuid);
    // }
    moof.write(stream);
    moof.trafs[0].truns[0].data_offset = moof.size + 8;
    stream.adjustUint32(moof.trafs[0].truns[0].data_offset_position, moof.trafs[0].truns[0].data_offset);
    console.log({ moofSize: stream.buffer.byteLength });

    const mdat = new BoxParser.box.mdat();
    mdat.stream = new MultiBufferStream();
    // let sampleOffset = 0;
    // for (const sample of samples) {
    // console.log({ sampleSize: sample.size, sampleOffset });
    // if (sample.data) {
    // const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(sample.data.buffer, sampleOffset);
    // mdat.stream.insertBuffer(mp4Buffer);
    // sampleOffset += sample.data.byteLength;
    // }
    // }
    const samplesData = Buffer.concat(samples.map((s) => s.data!));
    mdat.stream.insertBuffer(MP4BoxBuffer.fromArrayBuffer(samplesData.buffer, 0));

    // console.log({ mdatSize: mdat.stream.buffer.byteLength, sampleOffset });
    // const encMdat = mp4.mdats[samples[0].moof_number! - 1];
    // console.log(encMdat);
    // console.log(encMdat.stream?.buffer.byteLength);
    mdat.write(stream);
    // console.log({ stream });

    const mdatBuffer = Buffer.from(stream.buffer);
    outputStream.write(mdatBuffer);

    const lastSampleNum = Math.max(...samples.map((s) => s.moof_number!));
    const nextSampleNum = lastSampleNum + 1;
    mp4.releaseUsedSamples(id, nextSampleNum);
  };

  mp4.start();

  // console.log({ mp4 });

  await new Promise<void>((resolve, reject) => {
    inputStream.on('error', reject);
    inputStream.on('close', () => {
      console.log('inputStream.on.close');
      resolve();
    });
    inputStream.on('end', () => {
      console.log('inputStream.on.end');
      resolve();
      // mp4.flush();
      // outputMp4.flush();
    });
  });

  // console.log({ newMP4 });
  // console.log(newMP4.getInfo());

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
