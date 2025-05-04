import { parseArgs } from 'node:util';
import { decryptFile } from '../../dempeg';

export const $ = async (strings: TemplateStringsArray, ...values: string[]) => {
  const command = strings.reduce((acc, curr, i) => acc + curr + (values[i] || ''), '');
  const args = command.split(' ');
  const name = args.shift();
  if (!name) return;
  const parsed = parseArgs({
    allowPositionals: true,
    args: args,
    options: { key: { short: 'k', type: 'string' } },
  });
  const [keyId, keyValue] = parsed.values.key?.split(':') ?? [];
  const [input, output] = parsed.positionals;
  await decryptFile(input, output, { key: keyValue, keyId });
};
