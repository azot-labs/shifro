import { parsePSSH } from './box-parsers';
import { Mp4Parser } from './parser';

interface PsshInfo {
  version: number;
  pssh: string;
  systemId: string;
  systemData: Uint8Array;
  kid?: string;
}

export const getPsshList = async (data: Uint8Array) => {
  return new Promise<PsshInfo[]>((resolve) => {
    const results: PsshInfo[] = [];
    new Mp4Parser()
      .box('moov', Mp4Parser.children)
      .box('trak', Mp4Parser.children)
      .box('mdia', Mp4Parser.children)
      .box('minf', Mp4Parser.children)
      .box('stbl', Mp4Parser.children)
      .fullBox('stsd', Mp4Parser.sampleDescription)
      .fullBox('pssh', (box) => {
        const info = parsePSSH(box);
        console.log(info);
        results.push({
          version: info.version,
          pssh: info.pssh,
          systemId: info.systemId,
          systemData: info.systemData,
          kid: info.cencKeyIds[0],
        });
      })
      .parse(data, false, true);
    resolve(results);
  });
};
