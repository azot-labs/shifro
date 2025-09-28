#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { Input, FilePathSource, Output, FilePathTarget, Decryption } from './api';
import packageJson from '../package.json';

const args = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    key: { short: 'k', type: 'string', multiple: true },
    help: { short: 'h', type: 'boolean' },
  },
});

const keyStrings = (Array.isArray(args.values.key) ? args.values.key : []) as string[];
const [inputPath, outputPath] = args.positionals;

const decryptFile = async () => {
  console.time('\nDone!');

  const input = new Input({ source: new FilePathSource(inputPath) });
  const output = new Output({ target: new FilePathTarget(outputPath) });
  const keys = keyStrings.map((keyString) => {
    const [key, kid] = keyString.split(':').reverse();
    return { key, kid };
  });

  const decryption = await Decryption.init({
    input,
    output,
    keys,
    onProgress: (progress) => process.stdout.write(`\rDecrypting... [${progress}]`),
  });
  await decryption.execute();

  console.timeEnd('\nDone!');
};

const showHelp = () => {
  console.log(
    `
${packageJson.name} version ${packageJson.version}
(c) 2024-2025 ${packageJson.author}

Usage: ${packageJson.name} [options] <input> <output>

Options:
  --key <id>:<k>
    <id> is either a track ID in decimal or a 128-bit KID in hex,
    <k> is a 128-bit key in hex
    (several --key options can be used, one for each track or KID)
      `.trim()
  );
};

(async () => {
  if (inputPath && outputPath && keyStrings.length > 0) {
    await decryptFile();
  } else {
    showHelp();
  }
})();
