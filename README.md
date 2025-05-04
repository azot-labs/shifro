# mp4unbox

A lightweight, dependency-free MP4 decrypter

## Features

- **Decryption** of MP4 files with MPEG Common Encryption (CENC)
- **Small** size (under 15kB without types, minified)
- **Command-line** interface
- **Segment-by-segment processing** with JavaScript library
- **Custom handler** for subsample processing

## Prerequisites

- [Node.js](https://nodejs.org/en)

## Installation

Install library as dependency for your project:

```bash
npm install mp4unbox
```

Install globally to use as command-line tool:

```bash
npm install -g mp4unbox
```

## Usage

### Library

#### Decrypting file using Node.js streams

```js
import { createWriteStream, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { decryptStream } from 'mp4unbox';

const key = 'eb676abbcb345e96bbcf616630f1a3da';
const keyId = '100b6c20940f779a4589152b57d2dacb';

const inputPath = './input.mp4';
const inputInfo = await stat(inputPath);
const inputNodeStream = createReadStream(inputPath, { highWaterMark: 1024 * 1024 * 10 });
const inputWebStream = Readable.toWeb(inputNodeStream);

const outputPath = './output.mp4';
const outputNodeStream = createWriteStream(outputPath);
const outputWebStream = Writable.toWeb(outputNodeStream);

await decryptStream(inputWebStream, outputWebStream, {
  key,
  keyId,
  onProgress: (progress) => {
    process.stdout.write(`\rDecrypting... [${progress}/${inputInfo.size}]`);
    if (progress === inputInfo.size) process.stdout.write('\n');
  },
});
```

#### Decrypting file using browser's Web Streams API

```js
import { decryptStream } from 'mp4unbox';

const key = 'eb676abbcb345e96bbcf616630f1a3da';
const keyId = '100b6c20940f779a4589152b57d2dacb';

const waitForInput = async () =>
  new Promise<File>((resolve) => {
    const input = document.querySelector<HTMLInputElement>('#input')!;
    input.addEventListener('change', () => resolve(input.files![0]));
  });

const inputFile = await waitForInput();
const inputStream = input.stream();

const outputFileHandle = window.showSaveFilePicker({ suggestedName: 'output.mp4', startIn: 'downloads' });
const outputStream = await output.createWritable();

await decryptStream(inputStream, outputStream, {
  key,
  keyId,
  onProgress: (progress) => console.log(`${progress}/${input.size}`),
});
```

#### Segment-by-segment decryption

```js
import { decryptSegment } from 'mp4unbox';

const key = 'eb676abbcb345e96bbcf616630f1a3da';
const keyId = '100b6c20940f779a4589152b57d2dacb';
const encryptionScheme = 'cenc';

const encryptedSegments = [
  // List of binary MP4 segments (Uint8Array)
  // ...
];
const decryptedSegments = [];

for (const segment of encryptedSegments) {
  const decrypted = await decryptSegment(segment, { key, keyId, encryptionScheme });
  decryptedSegments.push(decrypted);
}

// Do something with results...
```

#### Transform sample data in your own way instead of built-in decryption

```js
import { createDecipheriv } from 'node:crypto';
import { decryptSegment } from 'mp4unbox';

const key = 'eb676abbcb345e96bbcf616630f1a3da';
const keyId = '100b6c20940f779a4589152b57d2dacb';
const encryptionScheme = 'cenc';

const encryptedSegments = [
  // List of binary MP4 segments (Uint8Array)
  // ...
];
const decryptedSegments = [];

for (const segment of encryptedSegments) {
  const decrypted = await decryptSegment(segment, {
    keyId,
    transformSample: (params) => {
      // Implement custom handler for subsample processing
      // ...
      const sampleData = params.data;
      const iv = params.iv;
      const decipher = createDecipheriv('aes-128-ctr', key, iv);
      const decrypted = Buffer.concat([decipher.update(sampleData), decipher.final()]);
      return decrypted;
    },
  });
  decryptedSegments.push(decrypted);
}

// Do something with results...
```

### CLI

```bash
mp4unbox --key eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb ./input.mp4 ./output.mp4
```
