import { getDefaultKid } from './kid';
import { getEncryptionScheme } from './scheme';
import { getPsshList } from './pssh';

export const getInfo = async (data: Uint8Array) => {
  const kid = await getDefaultKid(data);
  const scheme = await getEncryptionScheme(data);
  const psshList = await getPsshList(data);
  return { kid, scheme, psshList };
};
