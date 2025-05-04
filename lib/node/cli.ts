#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { decryptFile } from './utils';
import packageJson from '../../package.json';

const args = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    key: { short: 'k', type: 'string', multiple: true },
    help: { short: 'h', type: 'boolean' },
  },
});

// TODO: Support multiple keys
const keys = (Array.isArray(args.values.key) ? args.values.key : []) as string[];
const [keyId, keyValue] = keys[0]?.split(':') ?? [];
const [input, output] = args.positionals;

(async () => {
  if (input && output && keyId && keyValue) {
    await decryptFile(input, output, { key: keyValue, keyId });
    console.log('Done!');
  } else {
    // Show help
    console.log(
      `
  shifro version ${packageJson.version}
  (c) 2024 Vitaly Gashkov <vitalygashkov@vk.com>

  Usage: shifro [options] <input> <output>

  Options:
    --key <id>:<k>
      <id> is either a track ID in decimal or a 128-bit KID in hex,
      <k> is a 128-bit key in hex
      (several --key options can be used, one for each track or KID)
      `.trim()
    );
  }
})();
