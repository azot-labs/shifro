import {
  ALL_FORMATS,
  FilePathSource,
  UrlSource,
  StreamSource,
  StreamSourceOptions,
  ReadableStreamSource,
  Input as MediabunnyInput,
  InputOptions,
  FilePathTarget,
  StreamTarget,
  StreamTargetOptions,
  Output as MediabunnyOutput,
  Mp4OutputFormat,
  MovOutputFormat,
  MkvOutputFormat,
  Mp3OutputFormat,
  Conversion,
  OutputOptions,
  OutputFormat,
} from 'mediabunny';

type KeyId = string;
type Key = string;
type KeyMap = Map<KeyId, Key>;

class Input extends MediabunnyInput {
  constructor({ keys, ...options }: Omit<InputOptions, 'formats' | 'formatOptions'> & { keys: KeyMap }) {
    super({
      ...options,
      formats: ALL_FORMATS,
      formatOptions: {
        isobmff: {
          resolveKeyId: ({ keyId }) => {
            const key = keys.get(keyId);
            if (!key) throw new Error('Unknown key ID.');
            return key;
          },
        },
      },
    });
  }
}

class Output extends MediabunnyOutput {
  constructor({ ...options }: Omit<OutputOptions, 'format'> & { format?: OutputFormat }) {
    super({
      ...options,
      format: options.format ?? new Mp4OutputFormat(),
    });
  }
}

export {
  UrlSource,
  FilePathSource,
  StreamSource,
  StreamSourceOptions,
  ReadableStreamSource,
  KeyId,
  Key,
  KeyMap,
  InputOptions,
  Input,
  FilePathTarget,
  StreamTarget,
  StreamTargetOptions,
  OutputOptions,
  OutputFormat,
  Output,
  Mp4OutputFormat,
  MovOutputFormat,
  MkvOutputFormat,
  Mp3OutputFormat,
  Conversion as Decryption,
}
