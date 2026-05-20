import type { PsshBox } from 'mediabunny';

export type KeyId = string;
export type Key = string;
export type KeyMap = Map<KeyId, Key>;

export type IsobmffScheme = 'cenc' | 'cens' | 'cbcs';

export type SubsampleEncryption = {
  /** Number of clear bytes that appear before the protected bytes in this subsample. */
  clearLen: number;
  /** Number of encrypted bytes in this subsample. */
  protectedLen: number;
};

export type EncryptionPattern = {
  /** Number of consecutive 16-byte blocks that are encrypted in each pattern step. */
  cryptByteBlock: number;
  /** Number of consecutive 16-byte blocks that are skipped in each pattern step. */
  skipByteBlock: number;
};

/**
 * Options passed to {@link DecryptSample}.
 *
 * This is the advanced callback contract. `data` contains the full sample bytes exactly as they appear in the
 * container, including any clear regions. `subsamples` and `pattern` describe which parts of `data` are protected.
 *
 * Use this callback when the decryption backend needs the original sample layout, or when working with content
 * that cannot be safely represented as a single flattened protected-byte stream, such as patterned `cbcs`
 * subsample encryption.
 */
export type IsobmffDecryptSampleOptions = {
  /** Full sample bytes as stored in the container. Clear and protected regions are both present in this buffer. */
  data: Uint8Array;
  /** Key ID from the track encryption metadata. */
  keyId: string;
  /** PSSH boxes associated with this key/sample and useful for DRM-specific key resolution. */
  psshBoxes: PsshBox[];
  /** Sample encryption scheme. */
  scheme: IsobmffScheme;
  /** Per-sample IV resolved from container metadata. */
  iv: Uint8Array;
  /** Subsample layout describing which parts of `data` are clear vs protected, or `null` for whole-sample encryption. */
  subsamples: SubsampleEncryption[] | null;
  /** Pattern encryption parameters, or `null` when no pattern is used. */
  pattern: EncryptionPattern | null;
};

/**
 * Options passed to {@link DecryptProtectedData}.
 *
 * This is the compatibility/simple callback contract. `data` contains only the protected byte stream that needs
 * to be decrypted. `shifro` is responsible for extracting those protected bytes from the sample and inserting the
 * decrypted result back into the sample afterward.
 *
 * This matches the old `transformSample` style API used by `wapter`.
 */
export type IsobmffDecryptProtectedDataOptions = {
  /** Only the protected bytes that should be decrypted. Clear sample bytes are not included. */
  data: Uint8Array;
  /** Key ID from the track encryption metadata. */
  keyId: string;
  /** PSSH boxes associated with this key/sample and useful for DRM-specific key resolution. */
  psshBoxes: PsshBox[];
  /** Sample encryption scheme. */
  scheme: IsobmffScheme;
  /** Per-sample IV resolved from container metadata. */
  iv: Uint8Array;
  /**
   * Subsample layout for the protected-data buffer passed to this callback.
   *
   * Since `data` already contains only protected bytes, this is typically a single entry covering the whole buffer.
   */
  subsamples: SubsampleEncryption[];
  /**
   * Pattern metadata for the protected-data buffer passed to this callback.
   *
   * This is `null` when the flattened protected-data representation no longer has any skipped blocks to describe.
   */
  pattern: EncryptionPattern | null;
};

/**
 * Advanced sample decryption callback.
 *
 * The callback receives the full encrypted sample layout and must return the fully decrypted sample bytes with the
 * exact same length. This is the most general integration point and should be used when a backend needs explicit
 * subsample and pattern metadata.
 */
export type DecryptSample = (
  options: IsobmffDecryptSampleOptions,
) => Uint8Array | Promise<Uint8Array>;

/**
 * Simplified protected-data decryption callback.
 *
 * The callback receives only the protected byte stream extracted from a sample and must return the decrypted bytes
 * for that protected region with the exact same length. `shifro` handles extraction from and reinsertion into the
 * original sample.
 *
 * This is the recommended callback for integrations that only need a raw "decrypt these bytes" operation.
 *
 * Note: this simplified callback is not sufficient for every encryption layout. For example, `cbcs` samples with
 * subsample encryption still require {@link DecryptSample}.
 */
export type DecryptProtectedData = (
  options: IsobmffDecryptProtectedDataOptions,
) => Uint8Array | Promise<Uint8Array>;
