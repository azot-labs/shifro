# dempeg

A lightweight, dependency-free MP4 decrypter for Node.js.

## Features

- **Decryption** of MP4 files with MPEG Common Encryption (CENC)
- **Small** size (~10kB without types)
- **Command-line** interface
- **Segment-by-segment processing** with JavaScript library
- **Custom handler** for subsample processing

## Prerequisites

- [Node.js](https://nodejs.org/en)

## Installation

Install library as dependency for your project:

```bash
npm install dempeg
```

Install globally as command-line tool:

```bash
npm install -g dempeg
```

## Usage

### Library

#### File decryption

```js
import { decryptFile } from 'dempeg';

decryptFile('./input.mp4', './output.mp4', {
  key: 'eb676abbcb345e96bbcf616630f1a3da',
  keyId: '100b6c20940f779a4589152b57d2dacb',
});
```

#### Segment-by-segment decryption

```js
import { decryptSegment } from 'dempeg';

const segments = [
  // List of MPEG-DASH segments
  // ...
];
const results = [];

(async () => {
  for (const segment of segments) {
    const decrypted = await decryptSegment(segment, {
      key: 'eb676abbcb345e96bbcf616630f1a3da',
      keyId: '100b6c20940f779a4589152b57d2dacb',
    });
    results.push(decrypted);
  }
})();

// Do something with results...
```

#### Custom subsample handler

```js
import { createDecipheriv } from 'node:crypto';
import { decryptSegment } from 'dempeg';

const segments = [
  // List of MPEG-DASH segments
  // ...
];
const results = [];

(async () => {
  for (const segment of segments) {
    const decrypted = await decryptSegment(segment, {
      keyId: '100b6c20940f779a4589152b57d2dacb',
      decryptSubsampleFn: (params) => {
        // Custom subsample handler
        // ...
        const subsample = params.data;
        const iv = params.iv;
        const key = 'eb676abbcb345e96bbcf616630f1a3da';
        const decipher = createDecipheriv('aes-128-ctr', key, iv);
        const decrypted = Buffer.concat([decipher.update(subsample), decipher.final()]);
        return decrypted;
      },
    });
    results.push(decrypted);
  }
})();

// Do something with results...
```

Shell-like syntax:

```js
import { $ } from 'dempeg';

$`dempeg --key eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb ./input.mp4 ./output.mp4`;
```

### CLI

```bash
dempeg --key eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb ./input.mp4 ./output.mp4
```
