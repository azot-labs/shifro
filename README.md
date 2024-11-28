# dempeg

A lightweight, dependency-free MP4 decrypter for Node.js.

## Features

- **Decryption** of MP4 files with MPEG Common Encryption (CENC)
- **Small** size (~10kB without types)

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

Decrypt file:

```js
import { decryptFile } from 'dempeg';

decryptFile('./input.mp4', './output.mp4', {
  key: 'eb676abbcb345e96bbcf616630f1a3da',
  keyId: '100b6c20940f779a4589152b57d2dacb',
});
```

Decrypt each segment separately:

```js
import { decryptSegment } from 'dempeg';

const segments = [
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

Shell-like syntax:

```js
import { $ } from 'dempeg';

$`dempeg ./input.mp4 ./output.mp4 --key eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb`;
```

### CLI

```bash
dempeg ./input.mp4 ./output.mp4 --key eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb
```
