// データ削除・取り消しのtombstoneに使う鍵付きハッシュ（research.md R7）。
// 平文のThreadsユーザーIDを残さずに照合するため。鍵なしでは元のIDを復元・照合できない。

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * バイト列を16進の文字列にする。
 * @param bytes - バイト列
 * @returns 16進の文字列（小文字）
 */
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * ThreadsのユーザーIDの鍵付きハッシュを求める（research.md R7）。平文のIDを残さずに照合するために使う。
 * @param identifierHashKeyB64 - IDENTIFIER_HASH_KEY（32バイトの base64）
 * @param threadsUserId - ThreadsのユーザーID
 * @returns HMAC-SHA256 の16進の文字列
 */
export async function threadsUserHmac(identifierHashKeyB64: string, threadsUserId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(identifierHashKeyB64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(threadsUserId));
  return toHex(mac);
}

/**
 * 文字列の SHA-256 を求める。state の保存や signed_request の重複判定に使う。
 * @param value - ハッシュを求める文字列
 * @returns SHA-256 の16進の文字列
 */
export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
