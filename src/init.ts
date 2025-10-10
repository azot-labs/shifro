import { AllRegisteredBoxes, BoxParser, createFile, DataStream, ISOFile, Movie } from 'mp4box';
import { Encv } from './sample';

export const createFiles = () => {
  const input = createFile(true);
  const ready = new Promise<Movie>((resolve) => {
    input.onReady = resolve;
  });
  const output = createFile(false);
  return { input, ready, output };
};

export const processInit = async ({ input, info, output }: { input: ISOFile; info: Movie; output: ISOFile }) => {
  const track = info.tracks[0];
  input.setExtractionOptions(track.id, undefined, { nbSamples: 100 });

  const initStream = new DataStream();
  const ftyp = output.ftyp;
  const moov = output.moov;
  const trak = moov.traks[0];
  const stsd = trak.mdia.minf.stbl.stsd;
  const encSampleEntry = stsd.entries?.find((box) => !box.box_name) as Encv;
  const sinf = encSampleEntry.sinf;
  const frma = sinf.frma;
  const decSampleEntry: AllRegisteredBoxes['avc1'] = new BoxParser.sampleEntry[frma.data_format as 'avc1']();
  for (const key of Object.keys(encSampleEntry)) {
    // @ts-ignore
    decSampleEntry.set(key, encSampleEntry[key]);
  }
  decSampleEntry.boxes = decSampleEntry.boxes?.filter((box) => box.box_name !== 'ProtectionSchemeInfoBox');
  stsd.addEntry(decSampleEntry);
  stsd.entries = stsd.entries?.filter((box) => !!box.box_name); // Remove encvSampleEntry, etc.
  moov.psshs = [];
  moov.boxes = output.moov.boxes?.filter((box) => box.box_name !== 'ProtectionSystemSpecificHeaderBox');
  ftyp.write(initStream);
  moov.write(initStream);
  const init = new Uint8Array(initStream.buffer);

  return { init };
};
