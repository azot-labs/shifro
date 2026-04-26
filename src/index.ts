import {
  ALL_FORMATS,
  FilePathSource,
  UrlSource,
  StreamSource,
  ReadableStreamSource,
  Input as MediabunnyInput,
  FilePathTarget,
  StreamTarget,
  Output as MediabunnyOutput,
  Mp4OutputFormat,
  MovOutputFormat,
  MkvOutputFormat,
  Mp3OutputFormat,
  Conversion,
  type StreamSourceOptions,
  type InputOptions,
  type StreamTargetOptions,
  type OutputOptions,
  type OutputFormat,
  type PsshBox,
} from 'mediabunny';

type KeyId = string;
type Key = string;
type KeyMap = Map<KeyId, Key>;

class Input extends MediabunnyInput {
  constructor({
    keys,
    handleEncryptionInfo,
    ...options
  }: Omit<InputOptions, 'formats' | 'formatOptions'> & {
    keys: KeyMap;
    handleEncryptionInfo?: (options: { keyId: string; psshBoxes: PsshBox[] }) => void;
  }) {
    super({
      ...options,
      formats: ALL_FORMATS,
      formatOptions: {
        isobmff: {
          resolveKeyId: ({ keyId, psshBoxes }) => {
            handleEncryptionInfo?.({ keyId, psshBoxes });
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
  ReadableStreamSource,
  Input,
  FilePathTarget,
  StreamTarget,
  Output,
  Mp4OutputFormat,
  MovOutputFormat,
  MkvOutputFormat,
  Mp3OutputFormat,
  Conversion as Decryption,
};

export type {
  StreamSourceOptions,
  KeyId,
  Key,
  KeyMap,
  InputOptions,
  StreamTargetOptions,
  OutputOptions,
  OutputFormat,
};
