#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { decryptFile } from '../dempeg';

const args = parseArgs({
  allowPositionals: true,
  options: { key: { short: 'k', type: 'string', multiple: true } },
});

// TODO: Support multiple keys
const [keyId, keyValue] = args.values.key?.[0]?.split(':') ?? [];
const [input, output] = args.positionals;

console.log('Decrypting...');
decryptFile(input, output, { key: keyValue, keyId });
console.log('Done!');
