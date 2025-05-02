import { DataViewReader } from './data-view-reader';

export interface ParsedBox {
  name: string;
  parser: Mp4Parser;
  partialOkay: boolean;
  version: number | null;
  flags: number | null;
  reader: DataViewReader;
  size: number;
  start: number;
  has64BitSize: boolean;
}

export type CallbackType = (box: ParsedBox) => void;

export enum BoxType {
  BASIC_BOX,
  FULL_BOX,
}

export class Mp4Parser {
  private headers = new Map<number, BoxType>();
  private boxDefinitions = new Map<number, CallbackType>();
  private done = false;

  box(type: string, definition: CallbackType): this {
    const typeCode = Mp4Parser.typeFromString(type);
    this.headers.set(typeCode, BoxType.BASIC_BOX);
    this.boxDefinitions.set(typeCode, definition);
    return this;
  }

  fullBox(type: string, definition: CallbackType): this {
    const typeCode = Mp4Parser.typeFromString(type);
    this.headers.set(typeCode, BoxType.FULL_BOX);
    this.boxDefinitions.set(typeCode, definition);
    return this;
  }

  stop(): void {
    this.done = true;
  }

  parse(data: Uint8Array, partialOkay = false, stopOnPartial = false): void {
    const reader = new DataViewReader(data);
    // console.log(reader.h || reader.getDataView());
    this.done = false;
    // console.log('mp4parser:parse');

    while (reader.hasMoreData() && !this.done) {
      // console.log({ parse: true, hasMoreData: reader.hasMoreData(), done: this.done });
      this.parseNext(0, reader, partialOkay, stopOnPartial);
    }
  }

  parseNext(
    absStart: number,
    reader: DataViewReader,
    partialOkay?: boolean,
    stopOnPartial?: boolean,
  ): void {
    const start = reader.getPosition();
    if (stopOnPartial && start + 8 > reader.getLength()) {
      this.done = true;
      return;
    }

    let size = reader.readUint32();
    const type = reader.readUint32();
    const name = Mp4Parser.typeToString(type);
    let has64BitSize = false;

    switch (size) {
      case 0:
        size = reader.getLength() - start;
        break;
      case 1:
        if (stopOnPartial && reader.getPosition() + 8 > reader.getLength()) {
          this.done = true;
          return;
        }
        size = Number(reader.readUint64());
        has64BitSize = true;
        break;
    }

    const boxDefinition = this.boxDefinitions.get(type);

    if (boxDefinition) {
      let version: number | null = null;
      let flags: number | null = null;

      if (this.headers.get(type) === BoxType.FULL_BOX) {
        if (stopOnPartial && reader.getPosition() + 4 > reader.getLength()) {
          this.done = true;
          return;
        }
        const versionAndFlags = reader.readUint32();
        version = versionAndFlags >>> 24;
        flags = versionAndFlags & 0xffffff;
      }

      let end = start + size;
      if (partialOkay && end > reader.getLength()) {
        end = reader.getLength();
      }

      if (stopOnPartial && end > reader.getLength()) {
        this.done = true;
        return;
      }

      const payloadSize = end - reader.getPosition();
      const payload = payloadSize > 0 ? reader.readBytes(payloadSize) : new Uint8Array();
      const payloadReader = new DataViewReader(payload);

      const box: ParsedBox = {
        name,
        parser: this,
        partialOkay: !!partialOkay,
        version,
        flags,
        reader: payloadReader,
        size,
        start: start + absStart,
        has64BitSize,
      };

      boxDefinition(box);
    } else {
      const skipLength = Math.min(
        start + size - reader.getPosition(),
        reader.getLength() - reader.getPosition(),
      );
      reader.skip(skipLength);
    }
  }

  static children(box: ParsedBox): void {
    const headerSize = Mp4Parser.headerSize(box);
    while (box.reader.hasMoreData() && !box.parser.done) {
      box.parser.parseNext(box.start + headerSize, box.reader, box.partialOkay);
    }
  }

  static sampleDescription(box: ParsedBox): void {
    const headerSize = Mp4Parser.headerSize(box);
    const count = box.reader.readUint32();

    for (let i = 0; i < count; i++) {
      box.parser.parseNext(box.start + headerSize, box.reader, box.partialOkay);
      if (box.parser.done) break;
    }
  }

  static visualSampleEntry(box: ParsedBox): void {
    const headerSize = Mp4Parser.headerSize(box);
    box.reader.skip(78);

    while (box.reader.hasMoreData() && !box.parser.done) {
      box.parser.parseNext(box.start + headerSize, box.reader, box.partialOkay);
    }
  }

  static audioSampleEntry(box: ParsedBox): void {
    const headerSize = Mp4Parser.headerSize(box);
    box.reader.skip(8);
    const version = box.reader.readUint16();
    box.reader.skip(6);

    if (version === 2) {
      box.reader.skip(48);
    } else {
      box.reader.skip(12);
    }

    if (version === 1) {
      box.reader.skip(16);
    }

    while (box.reader.hasMoreData() && !box.parser.done) {
      box.parser.parseNext(box.start + headerSize, box.reader, box.partialOkay);
    }
  }

  static allData(callback: (data: Uint8Array) => void): CallbackType {
    return (box) => {
      const remaining = box.reader.getLength() - box.reader.getPosition();
      callback(box.reader.readBytes(remaining));
    };
  }

  private static typeFromString(name: string): number {
    if (name.length !== 4) {
      throw new Error('MP4 box names must be 4 characters long');
    }

    let code = 0;
    for (const char of name) {
      code = (code << 8) | char.charCodeAt(0);
    }
    return code;
  }

  static typeToString(type: number): string {
    return String.fromCharCode(
      (type >> 24) & 0xff,
      (type >> 16) & 0xff,
      (type >> 8) & 0xff,
      type & 0xff,
    );
  }

  static headerSize(box: ParsedBox): number {
    const basicHeaderSize = 8;
    const size64Bit = box.has64BitSize ? 8 : 0;
    const versionAndFlags = box.flags !== null ? 4 : 0;
    return basicHeaderSize + size64Bit + versionAndFlags;
  }
}
