import * as crypto from 'node:crypto';
import { assert } from 'node:console';
import fs from 'node:fs';
import { expect, test } from 'vitest';
import { createFile, ISOFile, Movie, MP4BoxBuffer, Sample } from 'mp4box';
import { ASSET_DATA } from './utils';
import { DataViewReader } from '../lib/data-view-reader';
import { concatUint8Array, parseHex } from '../lib/buffer';
import { decryptWithKey } from '../shifro';
import { getHash } from '../lib/node/utils';

export async function getFileRange(path: string, progress: (data: MP4BoxBuffer) => void, start = 0, end = Infinity) {
  const reader = fs.createReadStream(path, { start, end });
  return new Promise<void>((resolve, reject) => {
    let bytesRead = 0;
    reader.on('data', (chunk: string | Buffer) => {
      if (typeof chunk === 'string') chunk = Buffer.from(chunk);
      const data = MP4BoxBuffer.fromArrayBuffer(chunk.buffer, start + bytesRead);
      bytesRead += chunk.length;
      progress(data);
    });
    reader.on('error', reject);
    reader.on('end', resolve);
  });
}

export async function loadAndGetInfo(file_path: string, loadAll = false, keepMdat = false) {
  const mp4 = createFile(keepMdat);
  const ready = new Promise<Movie>((resolve) => {
    mp4.onReady = resolve;
  });

  const populate = getFileRange(file_path, (data) => mp4.appendBuffer(data))
    .then(() => mp4.flush())
    .then(() => mp4.getInfo());

  if (loadAll) await populate;
  return { info: await Promise.race([ready, populate]), mp4 };
}

function getSencForMoofNumber(mp4: ISOFile, num: number) {
  const tenc = mp4.getBox('tenc');
  const isProtected = tenc.default_isProtected;
  const kid = tenc.default_KID;
  const perSampleIvSize = tenc.default_Per_Sample_IV_Size;

  const moof = mp4.moofs[num];
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

  return senc;
}

test('reading with mp4box', async () => {
  const { info, mp4 } = await loadAndGetInfo(ASSET_DATA.inputPath, true, true);

  const totalSamples = info.tracks[0].nb_samples;
  mp4.setExtractionOptions(1, undefined, { nbSamples: totalSamples });

  const extractedSamples: Sample[] = [];

  fs.copyFileSync(ASSET_DATA.inputPath, ASSET_DATA.outputPath); // start off with a copy of the input file
  const outfile = fs.openSync(ASSET_DATA.outputPath, 'r+');

  mp4.onSamples = async (id, user, samples) => {
    for (const sample of samples) {
      const senc = getSencForMoofNumber(mp4, sample.moof_number! - 1);
      const sencSample = senc.samples[sample.number_in_traf!];

      const encryptedParts = [];
      let offset = 0;
      for (const subsample of sencSample.subsamples) {
        encryptedParts.push(
          sample.data!.subarray(
            offset + subsample.BytesOfClearData,
            offset + subsample.BytesOfClearData + subsample.BytesOfProtectedData
          )
        );
        offset += subsample.BytesOfClearData + subsample.BytesOfProtectedData;
      }
      assert(offset === sample.data!.length);
      const encryptedData = Buffer.concat(encryptedParts);

      const key = new Uint8Array(parseHex(ASSET_DATA.keyValue));

      const cipher = crypto.createCipheriv('AES-128-CTR', key, sencSample.InitializationVector);
      const plaintext = Buffer.concat([cipher.update(encryptedData), cipher.final()]);

      // const plaintext = await decryptWithKey(key, {
      //   iv: sencSample.InitializationVector,
      //   data: encryptedData,
      //   encryptionScheme: 'cenc',
      //   timestamp: sample.dts,
      // });

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

      fs.writeSync(outfile, decrypted_sample, 0, decrypted_sample.length, sample.offset);

      extractedSamples.push(sample);
    }
  };

  function removeEncryptionBoxes() {
    // Remove sinf (track protection)
    const trak = mp4.getTrackById(extractedSamples[0].track_id);
    if (trak) trak.mdia.minf.stbl.sinf = null;

    // Remove senc if present
    const stbl = trak?.mdia.minf.stbl;
    if (stbl) stbl.senc = null;

    // Remove any pssh boxes (system headers)
    // const psshBoxes = mp4.boxes.filter((b: any) => b.type === 'pssh');
    // psshBoxes.forEach((box: any) => mp4.removeBox(box));
  }

  mp4.start();

  if (extractedSamples.length >= totalSamples) {
    removeEncryptionBoxes();
    fs.closeSync(outfile);
  }

  const actualHash = await getHash(ASSET_DATA.outputPath);
  const expectedHash = 'a4a4594c30072ab023a9dd9313fc5ec6bc203dc3920ef28eb951f5426229a93d';
  expect(actualHash).toBe(expectedHash);
});
