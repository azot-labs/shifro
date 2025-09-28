# shifro

A lightweight library for decrypting MP4 files, directly in the browser

## Features

- **Decryption** of MP4 files with MPEG Common Encryption (CENC)
- **Small** size (under 15kB without types, minified)
- **Command-line** interface
- **Segment-by-segment processing** with JavaScript library
- **Custom handler** for samples processing

## Prerequisites

- [Node.js](https://nodejs.org/en)

## Installation

Install library as dependency for your project:

```bash
npm install shifro
```

Install globally to use as command-line tool:

```bash
npm install -g shifro
```

## Usage

### Library

#### Decrypting file using browser's Web Streams API

```js
import { Input, StreamSource, Output, StreamTarget, Decryption } from 'shifro';

const selectFile = async () =>
  new Promise<File>((resolve) => {
    const input = document.querySelector<HTMLInputElement>('#input')!;
    input.addEventListener('change', () => resolve(input.files![0]));
  });

async function main() {
  const inputFile = await selectFile();
  const inputStream = inputFile.stream();

  const outputFileHandle = window.showSaveFilePicker({ suggestedName: 'output.mp4', startIn: 'downloads' });
  const outputStream = await outputFileHandle.createWritable();

  const input = new Input({ source: new StreamSource(inputStream) });
  const output = new Output({ target: new StreamTarget(outputStream) });
  const decryption = await Decryption.init({
    input,
    output,
    keys: [
      {
        kid: 'eb676abbcb345e96bbcf616630f1a3da',
        key: '100b6c20940f779a4589152b57d2dacb',
      },
    ],
    onProgress: (progress) => console.log(`${progress}/${inputFile.size}`),
  });
  await decryption.execute();
}
```

#### Decrypting file using Node.js streams

```js
import { Input, FilePathSource, Output, FilePathTarget, Decryption } from 'shifro';

async function main() {
  const input = new Input({ source: new FilePathSource('./input.mp4') });
  const output = new Output({ target: new FilePathTarget('./output.mp4') });
  const decryption = await Decryption.init({
    input,
    output,
    keys: [
      {
        kid: 'eb676abbcb345e96bbcf616630f1a3da',
        key: '100b6c20940f779a4589152b57d2dacb',
      },
    ],
    onProgress: (progress) => {
      process.stdout.write(`\rDecrypting... [${progress}/${inputInfo.size}]`);
      if (progress === inputInfo.size) process.stdout.write('\n');
    },
  });
  await decryption.execute();
}
```

#### Segment-by-segment decryption

```js
import { decryptSegment } from 'shifro';

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
import { decryptSegment } from 'shifro';

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
shifro --key eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb ./input.mp4 ./output.mp4
```
