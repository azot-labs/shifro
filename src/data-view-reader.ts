export type Endianness = 'BE' | 'LE';

const toDataView = (uint8Array: Uint8Array) => {
  const arrayBuffer = uint8Array.buffer;
  const dataView = new DataView(arrayBuffer, uint8Array.byteOffset, uint8Array.byteLength);
  return dataView;
};

const fromDataView = (dataView: DataView, position = 0, length?: number) => {
  return new Uint8Array(dataView.buffer, dataView.byteOffset + position, length);
};

export class DataViewReaderError extends Error {
  constructor(public severity: string, public category: string, public code: string, message?: string) {
    super(message);
    this.name = 'DataViewReaderError';
  }
}

export class DataViewReader {
  private dataView: DataView;
  private littleEndian: boolean;
  private position: number = 0;

  constructor(data: Uint8Array, endianness: Endianness = 'BE') {
    this.dataView = toDataView(data);
    this.littleEndian = endianness === 'LE';
  }

  getDataView(): DataView {
    return this.dataView;
  }

  hasMoreData(): boolean {
    return this.position < this.dataView.byteLength;
  }

  getPosition(): number {
    return this.position;
  }

  getLength(): number {
    return this.dataView.byteLength;
  }

  readUint8(): number {
    this.checkBounds(1);
    const value = this.dataView.getUint8(this.position);
    this.position += 1;
    return value;
  }

  readUint16(): number {
    this.checkBounds(2);
    const value = this.dataView.getUint16(this.position, this.littleEndian);
    this.position += 2;
    return value;
  }

  readUint32(): number {
    this.checkBounds(4);
    const value = this.dataView.getUint32(this.position, this.littleEndian);
    this.position += 4;
    return value;
  }

  readInt32(): number {
    this.checkBounds(4);
    const value = this.dataView.getInt32(this.position, this.littleEndian);
    this.position += 4;
    return value;
  }

  readUint64(): number {
    let low: number, high: number;

    try {
      if (this.littleEndian) {
        low = this.dataView.getUint32(this.position, true);
        high = this.dataView.getUint32(this.position + 4, true);
      } else {
        high = this.dataView.getUint32(this.position, false);
        low = this.dataView.getUint32(this.position + 4, false);
      }
    } catch (e) {
      throw this.outOfBounds();
    }

    if (high > 0x1fffff) {
      throw new DataViewReaderError('CRITICAL', 'MEDIA', 'JS_INTEGER_OVERFLOW', '64-bit integer overflow');
    }

    this.position += 8;

    return high * Math.pow(2, 32) + low;
  }

  readBytes(bytes: number): Uint8Array {
    this.checkBounds(bytes);
    const value = fromDataView(this.dataView, this.position, bytes);
    this.position += bytes;
    return value;
  }

  skip(bytes: number): void {
    this.checkBounds(bytes);
    this.position += bytes;
  }

  rewind(bytes: number): void {
    if (this.position < bytes) {
      throw this.outOfBounds();
    }
    this.position -= bytes;
  }

  seek(position: number): void {
    if (position < 0 || position > this.dataView.byteLength) {
      throw this.outOfBounds();
    }
    this.position = position;
  }

  readTerminatedString(): string {
    const start = this.position;
    while (this.hasMoreData() && this.dataView.getUint8(this.position) !== 0) {
      this.position++;
    }

    if (!this.hasMoreData()) {
      throw this.outOfBounds();
    }

    const buffer = new Uint8Array(this.dataView.buffer, start, this.position - start);
    this.position++; // Skip null terminator
    return new TextDecoder().decode(buffer);
  }

  private checkBounds(bytes: number): void {
    if (this.position + bytes > this.dataView.byteLength) {
      throw this.outOfBounds();
    }
  }

  private outOfBounds(): DataViewReaderError {
    return new DataViewReaderError('CRITICAL', 'MEDIA', 'BUFFER_READ_OUT_OF_BOUNDS', 'Read operation out of bounds');
  }
}
