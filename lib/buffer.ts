const bufferReplaceAll = (buffer: Buffer, original: string, replacement: string) => {
  const originalBuffer = Buffer.from(original);
  let idx = 0;
  do {
    idx = buffer.indexOf(originalBuffer, 0);
    if (idx > -1) {
      buffer.write(replacement, idx);
    }
  } while (idx !== -1);
};

const bitShiftLeftBuffer = (buffer: Buffer) => {
  const shifted = Buffer.alloc(buffer.length);
  const last = buffer.length - 1;
  for (let index = 0; index < last; index++) {
    shifted[index] = buffer[index] << 1;
    if (buffer[index + 1] & 0x80) {
      shifted[index] += 0x01;
    }
  }
  shifted[last] = buffer[last] << 1;
  return shifted;
};

const xorBuffer = (bufferA: Buffer, bufferB: Buffer) => {
  const length = Math.min(bufferA.length, bufferB.length);
  const output = Buffer.alloc(length);
  for (let index = 0; index < length; index++) {
    output[index] = bufferA[index] ^ bufferB[index];
  }
  return output;
};

const bufferToArrayBuffer = (buffer: Buffer) => {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

export { bufferReplaceAll, bitShiftLeftBuffer, xorBuffer, bufferToArrayBuffer };
