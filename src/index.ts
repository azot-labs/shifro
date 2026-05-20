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
  type InputOptions as MediabunnyInputOptions,
  type StreamTargetOptions,
  type OutputOptions,
  type OutputFormat,
  type PsshBox,
  type InputTrack,
  type InputTrackQuery,
} from 'mediabunny';
import type {
  DecryptProtectedData,
  DecryptSample,
  IsobmffDecryptProtectedDataOptions,
  IsobmffDecryptSampleOptions,
  Key,
  KeyId,
  KeyMap,
} from './decrypt-sample';
import { IsobmffDecryptSamplePatcher } from './isobmff-decrypt-sample-patcher';

/**
 * Options for creating a `shifro` {@link Input}.
 *
 * In addition to the regular Mediabunny input options, `shifro` accepts either raw content keys or one of the
 * decryption callbacks used to delegate decryption to another library.
 */
export type ShifroInputOptions = Omit<MediabunnyInputOptions, 'formats' | 'formatOptions'> & {
  /**
   * Content decryption keys indexed by key ID.
   *
   * Use this when the caller already has the actual content keys and wants `shifro`/Mediabunny to perform the
   * sample decryption internally.
   */
  keys?: KeyMap;
  /**
   * Advanced decryption callback that receives the full encrypted sample layout.
   *
   * Use this when the decryption backend needs explicit access to the sample's clear/protected layout, subsample
   * metadata, or pattern encryption information.
   */
  decryptSample?: DecryptSample;
  /**
   * Simplified decryption callback that receives only the flattened protected byte stream.
   *
   * `shifro` extracts the protected bytes from the sample before calling this callback and reinserts the decrypted
   * bytes back into the sample afterward.
   */
  decryptProtectedData?: DecryptProtectedData;
  /**
   * Optional callback invoked when encryption metadata is discovered for a sample.
   *
   * This is useful when the caller wants access to the key ID and PSSH boxes without providing the key directly,
   * for example to perform external DRM license handling.
   */
  handleEncryptionInfo?: (options: { keyId: string; psshBoxes: PsshBox[] }) => void;
};

const createEncryptionReporter = (
  handleEncryptionInfo?: (options: { keyId: string; psshBoxes: PsshBox[] }) => void,
) => {
  const reportedEncryptionInfo = new Set<string>();

  return (keyId: string, psshBoxes: PsshBox[]) => {
    if (!handleEncryptionInfo || reportedEncryptionInfo.has(keyId)) {
      return;
    }

    reportedEncryptionInfo.add(keyId);
    handleEncryptionInfo({ keyId, psshBoxes });
  };
};

class Input extends MediabunnyInput {
  private readonly decryptSamplePatcher: IsobmffDecryptSamplePatcher | null;

  constructor({
    keys,
    decryptSample,
    decryptProtectedData,
    handleEncryptionInfo,
    ...options
  }: ShifroInputOptions) {
    if (!keys?.size && !decryptSample && !decryptProtectedData) {
      throw new Error('Either keys, decryptSample, or decryptProtectedData must be provided.');
    }

    const reportEncryptionInfo = createEncryptionReporter(handleEncryptionInfo);

    super({
      ...options,
      formats: ALL_FORMATS,
      formatOptions: {
        isobmff: {
          resolveKeyId: ({ keyId, psshBoxes }) => {
            reportEncryptionInfo(keyId, psshBoxes);

            const key = keys?.get(keyId);
            if (!key) {
              throw new Error('Unknown key ID.');
            }

            return key;
          },
        },
      },
    });

    this.decryptSamplePatcher =
      decryptSample || decryptProtectedData
        ? new IsobmffDecryptSamplePatcher(
            { getTracks: (query) => this.getTracksWithoutPatching(query) },
            decryptSample,
            decryptProtectedData,
            reportEncryptionInfo,
          )
        : null;
  }

  override async getTracks(query?: InputTrackQuery<InputTrack>): Promise<InputTrack[]> {
    await this.decryptSamplePatcher?.ensurePatched();
    return super.getTracks(query);
  }

  private async getTracksWithoutPatching(
    query?: InputTrackQuery<InputTrack>,
  ): Promise<InputTrack[]> {
    return super.getTracks(query);
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
  IsobmffDecryptProtectedDataOptions,
  IsobmffDecryptSampleOptions,
  DecryptProtectedData,
  DecryptSample,
  MediabunnyInputOptions as InputOptions,
  StreamTargetOptions,
  OutputOptions,
  OutputFormat,
};
