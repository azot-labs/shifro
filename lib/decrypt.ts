export interface DecryptParams {
  key: Uint8Array;
  iv: Uint8Array;
  data: Uint8Array;
  algorithm?: string;
}

export const decrypt = async ({ key, iv, data, algorithm = 'AES-CTR' }: DecryptParams) => {
  const algorithmName = algorithm.toUpperCase();
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: algorithmName }, false, ['decrypt']);
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: algorithmName,
      counter: iv,
      length: 64, // The length of the counter in bits (for AES-128-CTR, this is typically 64 bits of the 128-bit block)
    },
    cryptoKey,
    data
  );
  return new Uint8Array(decryptedData);
};
