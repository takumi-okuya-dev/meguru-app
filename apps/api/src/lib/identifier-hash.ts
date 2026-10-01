// データ削除・取り消しのtombstoneに使う鍵付きハッシュ（research.md R7）。
// 平文のThreadsユーザーIDを残さずに照合するため。鍵なしでは元のIDを復元・照合できない。

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
