const indexOfUint8Array = (buffer: Uint8Array, search: Uint8Array, start: number): number => {
  if (search.length === 0) return -1;
  const max = buffer.length - search.length + 1;
  for (let i = start; i < max; i++) {
    let match = true;
    for (let j = 0; j < search.length; j++) {
      if (buffer[i + j] !== search[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
};

const bufferReplaceAll = (buffer: Uint8Array, original: string, replacement: string) => {
  const encoder = new TextEncoder();
  const originalBytes = encoder.encode(original);
  const replacementBytes = encoder.encode(replacement);

  if (originalBytes.length !== replacementBytes.length) {
    throw new Error('Original and replacement must have the same byte length');
  }

  let idx = 0;
  do {
    idx = indexOfUint8Array(buffer, originalBytes, 0);
    if (idx !== -1) {
      buffer.set(replacementBytes, idx);
    }
  } while (idx !== -1);
};

const bitShiftLeftBuffer = (buffer: Uint8Array) => {
  const shifted = new Uint8Array(buffer.length);
  const last = buffer.length - 1;
  for (let i = 0; i < last; i++) {
    shifted[i] = buffer[i] << 1;
    if (buffer[i + 1] & 0x80) {
      shifted[i] |= 0x01;
    }
  }
  shifted[last] = buffer[last] << 1;
  return shifted;
};

const xorBuffer = (bufferA: Uint8Array, bufferB: Uint8Array) => {
  const length = Math.min(bufferA.length, bufferB.length);
  const output = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    output[i] = bufferA[i] ^ bufferB[i];
  }
  return output;
};

const bufferToArrayBuffer = (buffer: Uint8Array) => {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

export { bufferReplaceAll, bitShiftLeftBuffer, xorBuffer, bufferToArrayBuffer };
