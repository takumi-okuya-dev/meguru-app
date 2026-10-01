// Threadsのアクセストークンの暗号化（research.md R5）。
// - AES-256-GCM（Web Crypto）。AADに account_id を使い、暗号文を別のAccountの行へ付け替えても復号できないようにする
// - IVは暗号化のたびに crypto.getRandomValues で12バイト新しく作る。使い回さない
// - 鍵はバージョン別の鍵リング（TOKEN_ENCRYPTION_KEYS）。復号は行の key_version の鍵で行う

export class KeyRingError extends Error {
  override name = "KeyRingError";
}

export type EncryptedToken = {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  keyVersion: number;
};

export type TokenCipher = {
  currentVersion: number;
  encrypt(plaintext: string, accountId: string): Promise<EncryptedToken>;
  decrypt(token: EncryptedToken, accountId: string): Promise<string>;
};

const IV_BYTES = 12;
const KEY_BYTES = 32;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseKeyRing(json: string): Map<number, Uint8Array> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new KeyRingError("TOKEN_ENCRYPTION_KEYS must be a JSON object");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new KeyRingError("TOKEN_ENCRYPTION_KEYS must be a JSON object");
  }
  const ring = new Map<number, Uint8Array>();
  for (const [version, value] of Object.entries(raw)) {
    const v = Number(version);
    if (!Number.isInteger(v) || v <= 0 || typeof value !== "string") {
      throw new KeyRingError(`invalid key ring entry for version ${version}`);
    }
    const bytes = base64ToBytes(value);
    if (bytes.length !== KEY_BYTES) throw new KeyRingError(`key version ${v} must be ${KEY_BYTES} bytes`);
    ring.set(v, bytes);
  }
  return ring;
}

/** 鍵リングを検証して暗号器を作る。設定が不正なら KeyRingError（起動時の検証として使う） */
export function createTokenCipher(keyRingJson: string, currentVersionText: string): TokenCipher {
  const ring = parseKeyRing(keyRingJson);
  const currentVersion = Number(currentVersionText);
  if (!ring.has(currentVersion)) {
    throw new KeyRingError(`current key version ${currentVersionText} is not in the key ring`);
  }

  const imported = new Map<number, Promise<CryptoKey>>();
  function keyFor(version: number): Promise<CryptoKey> {
    const raw = ring.get(version);
    if (!raw) throw new KeyRingError(`key version ${version} is not in the key ring`);
    let key = imported.get(version);
    if (!key) {
      key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
      imported.set(version, key);
    }
    return key;
  }

  const encoder = new TextEncoder();

  return {
    currentVersion,
    async encrypt(plaintext, accountId) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const key = await keyFor(currentVersion);
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: encoder.encode(accountId) },
        key,
        encoder.encode(plaintext),
      );
      return { ciphertext: new Uint8Array(ciphertext), iv, keyVersion: currentVersion };
    },
    async decrypt(token, accountId) {
      const key = await keyFor(token.keyVersion);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: token.iv, additionalData: encoder.encode(accountId) },
        key,
        token.ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    },
  };
}
