# shifro

A lightweight library for decrypting MP4 files, directly in the browser or via CLI on your machine.

This tool is a small wrapper around the [Mediabunny](https://github.com/Vanilagy/mediabunny) library with slight API changes and command-line support.

## Usage

### CLI

Run `npm install -g shifro` to install the command-line tool globally ([Node.js](https://nodejs.org/en/download) required).

```bash
shifro --key eb676abbcb345e96bbcf616630f1a3da:100b6c20940f779a4589152b57d2dacb ./input.mp4 ./output.mp4
```

This can be used as an alternative to the [mp4decrypt](https://www.bento4.com/documentation/mp4decrypt/) or [shaka-packager](https://shaka-project.github.io/shaka-packager/html/documentation.html#raw-key-encryption-options).

### Library

Run `npm install shifro` to install the library as dependency for your project.

#### Decrypting file using Node.js streams

```ts
import { Decryption, Input, FilePathSource, KeyId, Key, Output, FilePathTarget } from 'shifro';

async function decrypt() {
  const decryption = await Decryption.init({
    input: new Input({
      source: new FilePathSource('./input.mp4'),
      keys: new Map<KeyId, Key>([
        ['4d97930a3d7b55fa81d0028653f5e499', '429ec76475e7a952d224d8ef867f12b6'],
        ['d21373c0b8ab5ba9954742bcdfb5f48b', '150a6c7d7dee6a91b74dccfce5b31928'],
      ])
    }),
    output: new Output({ target: new FilePathTarget('./output.mp4') }),
  });

  decryption.onProgress = (progress) => process.stdout.write(`\rDecrypting... [${Math.round(progress * 100)}%]`),

  await decryption.execute();
}
```

#### Decrypting file using browser's Web Streams API

```ts
import { Decryption, Input, ReadableStreamSource, KeyId, Key, Output, StreamTarget } from 'shifro';

async function decryptFromBrowser() {
  const handleFileSelect = async () => {
    return new Promise<File>((resolve) => {
      const input = document.querySelector<HTMLInputElement>('#input')!;
      input.addEventListener('change', () => resolve(input.files![0]));
    });
  }

  const inputFile = await handleFileSelect();
  const inputReadableStream = inputFile.stream();

  const outputFileHandle = window.showSaveFilePicker({ suggestedName: 'output.mp4', startIn: 'downloads' });
  const outputWritableStream = await outputFileHandle.createWritable();

  const decryption = await Decryption.init({
    input: new Input({
      source: new ReadableStreamSource(inputReadableStream),
      keys: new Map<KeyId, Key>([
        ['4d97930a3d7b55fa81d0028653f5e499', '429ec76475e7a952d224d8ef867f12b6'],
        ['d21373c0b8ab5ba9954742bcdfb5f48b', '150a6c7d7dee6a91b74dccfce5b31928'],
      ])
    }),
    output: new Output({ target: new StreamTarget(outputWritableStream) }),
  });

  decryption.onProgress = (progress) => console.log(`Decrypting... [${Math.round(progress * 100)}%]`),

  await decryption.execute();
}
```


## Credits

- [mediabunny](https://github.com/Vanilagy/mediabunny)
