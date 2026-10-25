export interface DeviceKeyPair {
  readonly publicKeyJwk: string;
  readonly privateKey: CryptoKey;
}

/**
 * D17: the pairing exchange sends a public key, never a secret. The private key stays in memory
 * for the lifetime of the install's session because the daemon does not ask for a signature yet.
 */
export async function generateDeviceKeyPair(
  cryptoImpl: Crypto = globalThis.crypto,
): Promise<DeviceKeyPair> {
  const pair = await cryptoImpl.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const jwk = await cryptoImpl.subtle.exportKey('jwk', pair.publicKey);
  return { publicKeyJwk: JSON.stringify(jwk), privateKey: pair.privateKey };
}
