import {
  EncodedPacket,
  type InputTrack,
  type InputTrackQuery,
  type PacketRetrievalOptions,
  type PsshBox,
} from 'mediabunny';
import type {
  DecryptProtectedData,
  DecryptSample,
} from './decrypt-sample';
import {
  cloneSubsamples,
  createProtectedDataLayout,
  getEncryptedSample,
  getKeyId,
  getPattern,
  getPsshBoxes,
  getTrackEncryptionInfo,
  isIsobmffTrackBacking,
  isUint8Array,
  type Fragment,
  type IsobmffTrackBacking,
  type SampleEncryptionInfo,
} from './mediabunny-isobmff';

type InputLike = {
  getTracks: (query?: InputTrackQuery<InputTrack>) => Promise<InputTrack[]>;
};

type PatchableInputTrack = InputTrack & {
  _backing: unknown;
};

type ReportEncryptionInfo = (keyId: string, psshBoxes: PsshBox[]) => void;

type EncryptedSample = {
  data: Uint8Array;
  sampleEncryption: SampleEncryptionInfo;
  fragment: Fragment | null;
};

const createMetadataOnlyOptions = (
  options: PacketRetrievalOptions,
): PacketRetrievalOptions => ({
  ...options,
  metadataOnly: true,
  verifyKeyPackets: false,
});

export class IsobmffDecryptSamplePatcher {
  private readonly patchableTrackBackings = new WeakSet<object>();

  private patchTrackBackingsPromise: Promise<void> | null = null;

  constructor(
    private readonly input: InputLike,
    private readonly decryptSample: DecryptSample | undefined,
    private readonly decryptProtectedData: DecryptProtectedData | undefined,
    private readonly reportEncryptionInfo: ReportEncryptionInfo,
  ) {}

  async ensurePatched() {
    this.patchTrackBackingsPromise ??= (async () => {
      const tracks = await this.input.getTracks();
      for (const track of tracks) {
        const backing = (track as PatchableInputTrack)._backing;
        if (!isIsobmffTrackBacking(backing) || this.patchableTrackBackings.has(backing)) {
          continue;
        }

        this.patchableTrackBackings.add(backing);
        this.patchTrackBacking(backing);
      }
    })();

    await this.patchTrackBackingsPromise;
  }

  private patchTrackBacking(backing: IsobmffTrackBacking) {
    const packetToMetadataPacket = new WeakMap<EncodedPacket, EncodedPacket>();
    const getOriginalPacket = (packet: EncodedPacket) => (
      packetToMetadataPacket.get(packet) ?? packet
    );

    const getFirstPacket = backing.getFirstPacket.bind(backing);
    backing.getFirstPacket = async (options) => {
      if (!this.shouldUseCustomDecryptSample(backing, options)) {
        return getFirstPacket(options);
      }

      const metadataPacket = await getFirstPacket(createMetadataOnlyOptions(options));
      return this.materializePacket(backing, metadataPacket, () => getFirstPacket(options), packetToMetadataPacket);
    };

    const getPacket = backing.getPacket.bind(backing);
    backing.getPacket = async (timestamp, options) => {
      if (!this.shouldUseCustomDecryptSample(backing, options)) {
        return getPacket(timestamp, options);
      }

      const metadataPacket = await getPacket(timestamp, createMetadataOnlyOptions(options));
      return this.materializePacket(backing, metadataPacket, () => getPacket(timestamp, options), packetToMetadataPacket);
    };

    const getNextPacket = backing.getNextPacket.bind(backing);
    backing.getNextPacket = async (packet, options) => {
      const originalPacket = getOriginalPacket(packet);
      if (!this.shouldUseCustomDecryptSample(backing, options)) {
        return getNextPacket(originalPacket, options);
      }

      const metadataPacket = await getNextPacket(originalPacket, createMetadataOnlyOptions(options));
      return this.materializePacket(
        backing,
        metadataPacket,
        () => getNextPacket(originalPacket, options),
        packetToMetadataPacket,
      );
    };

    const getKeyPacket = backing.getKeyPacket.bind(backing);
    backing.getKeyPacket = async (timestamp, options) => {
      if (!this.shouldUseCustomDecryptSample(backing, options)) {
        return getKeyPacket(timestamp, options);
      }

      const metadataPacket = await getKeyPacket(timestamp, createMetadataOnlyOptions(options));
      return this.materializePacket(
        backing,
        metadataPacket,
        () => getKeyPacket(timestamp, options),
        packetToMetadataPacket,
      );
    };

    const getNextKeyPacket = backing.getNextKeyPacket.bind(backing);
    backing.getNextKeyPacket = async (packet, options) => {
      const originalPacket = getOriginalPacket(packet);
      if (!this.shouldUseCustomDecryptSample(backing, options)) {
        return getNextKeyPacket(originalPacket, options);
      }

      const metadataPacket = await getNextKeyPacket(originalPacket, createMetadataOnlyOptions(options));
      return this.materializePacket(
        backing,
        metadataPacket,
        () => getNextKeyPacket(originalPacket, options),
        packetToMetadataPacket,
      );
    };
  }

  private shouldUseCustomDecryptSample(
    backing: IsobmffTrackBacking,
    options: PacketRetrievalOptions,
  ) {
    return Boolean(
      !options.metadataOnly
      && getTrackEncryptionInfo(backing)?.defaultIsProtected !== false,
    );
  }

  private async materializePacket(
    backing: IsobmffTrackBacking,
    metadataPacket: EncodedPacket | null,
    fallback: () => Promise<EncodedPacket | null>,
    packetToMetadataPacket: WeakMap<EncodedPacket, EncodedPacket>,
  ) {
    if (!metadataPacket) {
      return null;
    }

    const decryptedPacket = await this.decryptPacket(backing, metadataPacket, fallback);
    if (decryptedPacket && decryptedPacket !== metadataPacket) {
      packetToMetadataPacket.set(decryptedPacket, metadataPacket);
    }

    return decryptedPacket;
  }

  private async decryptPacket(
    backing: IsobmffTrackBacking,
    metadataPacket: EncodedPacket,
    fallback: () => Promise<EncodedPacket | null>,
  ) {
    const encryptionInfo = getTrackEncryptionInfo(backing);
    if (!encryptionInfo?.defaultIsProtected) {
      return fallback();
    }

    const keyId = getKeyId(backing);
    if (!keyId) {
      throw new Error('Encrypted sample encountered without a key ID.');
    }

    const encryptedSample = await getEncryptedSample(backing, metadataPacket);
    if (!encryptedSample) {
      return fallback();
    }

    const psshBoxes = getPsshBoxes(backing, keyId, encryptedSample.fragment);
    this.reportEncryptionInfo(keyId, psshBoxes);

    const decryptedData = this.decryptSample
      ? await this.decryptSample({
          data: encryptedSample.data,
          keyId,
          psshBoxes,
          scheme: encryptionInfo.scheme,
          iv: encryptedSample.sampleEncryption.iv.slice(),
          subsamples: cloneSubsamples(encryptedSample.sampleEncryption.subsamples),
          pattern: getPattern(encryptionInfo),
        })
      : await this.decryptWithProtectedData(encryptionInfo, encryptedSample, keyId, psshBoxes);

    if (!isUint8Array(decryptedData)) {
      throw new TypeError('decryption callback must return a Uint8Array.');
    }
    if (decryptedData.byteLength !== metadataPacket.byteLength) {
      throw new Error('decryption callback must return the same number of bytes as the encrypted sample.');
    }

    return new EncodedPacket(
      decryptedData,
      metadataPacket.type,
      metadataPacket.timestamp,
      metadataPacket.duration,
      metadataPacket.sequenceNumber,
      metadataPacket.byteLength,
      metadataPacket.sideData,
    );
  }

  private async decryptWithProtectedData(
    encryptionInfo: NonNullable<ReturnType<typeof getTrackEncryptionInfo>>,
    encryptedSample: EncryptedSample,
    keyId: string,
    psshBoxes: PsshBox[],
  ) {
    if (!this.decryptProtectedData) {
      throw new Error('Encrypted sample encountered without a decryption callback.');
    }

    const protectedDataLayout = createProtectedDataLayout(
      encryptedSample.data,
      encryptionInfo,
      encryptedSample.sampleEncryption,
    );
    if (!protectedDataLayout) {
      throw new Error(
        'decryptProtectedData does not support cbcs samples with subsample encryption.'
        + ' Use decryptSample for this content.',
      );
    }

    const decryptedProtectedData = await this.decryptProtectedData({
      data: protectedDataLayout.data,
      keyId,
      psshBoxes,
      scheme: encryptionInfo.scheme,
      iv: encryptedSample.sampleEncryption.iv.slice(),
      subsamples: [
        {
          clearLen: 0,
          protectedLen: protectedDataLayout.data.byteLength,
        },
      ],
      pattern: null,
    });

    if (!isUint8Array(decryptedProtectedData)) {
      throw new TypeError('decryptProtectedData must return a Uint8Array.');
    }
    if (decryptedProtectedData.byteLength !== protectedDataLayout.data.byteLength) {
      throw new Error(
        'decryptProtectedData must return the same number of bytes as the protected data input.',
      );
    }

    return protectedDataLayout.merge(decryptedProtectedData);
  }
}
