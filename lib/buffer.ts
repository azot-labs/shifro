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

const bufferIncludes = (buffer: Uint8Array, search: string | Uint8Array | number, offset: number = 0): boolean => {
  const encoder = new TextEncoder();
  let searchBytes: Uint8Array;

  if (typeof search === 'string') {
    searchBytes = encoder.encode(search);
  } else if (typeof search === 'number') {
    searchBytes = new Uint8Array([search]);
  } else {
    searchBytes = search;
  }

  if (searchBytes.length === 0) return true; // Empty string always matches
  if (buffer.length < searchBytes.length) return false;

  return indexOfUint8Array(buffer, searchBytes, offset) !== -1;
};

const concatUint8Array = (list: Uint8Array[], totalLength?: number): Uint8Array<ArrayBuffer> => {
  if (list.length === 0) return new Uint8Array(0);

  // Calculate total length if not provided
  let calculatedLength = totalLength ?? list.reduce((acc, curr) => acc + curr.length, 0);

  // Ensure we don't exceed available data
  calculatedLength = Math.min(
    calculatedLength,
    list.reduce((acc, curr) => acc + curr.length, 0)
  );

  const result = new Uint8Array(calculatedLength);
  let offset = 0;

  for (const bytes of list) {
    if (offset >= calculatedLength) break;
    const chunk = bytes.subarray(0, Math.min(bytes.length, calculatedLength - offset));
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
};

const copyUint8Array = (
  source: Uint8Array,
  target: Uint8Array,
  targetStart: number = 0,
  sourceStart: number = 0,
  sourceEnd: number = source.length
): number => {
  // Parameter validation and normalization
  targetStart = Math.max(0, Math.min(targetStart, target.length));
  sourceStart = Math.max(0, Math.min(sourceStart, source.length));
  sourceEnd = Math.min(sourceEnd, source.length);

  if (sourceEnd < sourceStart) sourceEnd = sourceStart;

  const bytesToCopy = Math.min(sourceEnd - sourceStart, target.length - targetStart);

  if (bytesToCopy <= 0) return 0;

  // Perform the actual copy
  target.set(source.subarray(sourceStart, sourceStart + bytesToCopy), targetStart);

  return bytesToCopy;
};

const writeUint8Array = (target: Uint8Array, str: string, offset: number = 0, maxBytes?: number): number => {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);

  // Normalize parameters
  const safeOffset = Math.max(0, Math.min(offset, target.length));
  const remainingSpace = target.length - safeOffset;

  // Calculate how many bytes we can actually write
  let bytesToWrite = encoded.length;
  if (typeof maxBytes === 'number') {
    bytesToWrite = Math.min(bytesToWrite, maxBytes);
  }
  bytesToWrite = Math.min(bytesToWrite, remainingSpace);

  if (bytesToWrite <= 0) return 0;

  // Perform the write operation
  target.set(encoded.subarray(0, bytesToWrite), safeOffset);
  return bytesToWrite;
};

export {
  bufferReplaceAll,
  bitShiftLeftBuffer,
  xorBuffer,
  bufferToArrayBuffer,
  bufferIncludes,
  concatUint8Array,
  copyUint8Array,
  writeUint8Array,
};
