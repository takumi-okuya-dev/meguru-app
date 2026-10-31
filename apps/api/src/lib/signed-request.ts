// Metaの signed_request の検証（research.md R7）。
// 形式は "<base64urlの署名>.<base64urlのJSONペイロード>"。署名は App Secret による HMAC-SHA256。
import { isPlaceholder } from "./config";

/** Meta の signed_request が不正（形式・署名・内容の誤り）であることを表す。 */
export class SignedRequestError extends Error {
  override name = "SignedRequestError";
}

/** 検証済みの signed_request の中身。 */
export type SignedRequestPayload = {
  userId: string;
  /** Metaが通知を発行した時刻。含まれていなければ undefined */
  issuedAt?: Date;
};

function b64urlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Meta の signed_request を検証して中身を取り出す（research.md R7）。
 * 形式は「base64url の署名.base64url の JSON」で、署名は App Secret による HMAC-SHA256。
 * @param signedRequest - Meta から受け取った signed_request
 * @param appSecret - Threadsのアプリシークレット
 * @returns ThreadsのユーザーIDと、通知の発行時刻
 * @throws SignedRequestError 形式・署名・内容が不正なとき。シークレットが未設定・見本の値のときも
 */
export async function verifySignedRequest(
  signedRequest: string,
  appSecret: string | undefined,
): Promise<SignedRequestPayload> {
  // トークンを貼る方法だけで運用するとシークレットを入れない。空の鍵のHMACは誰でも作れるので、
  // 署名を見る前に断る（偽のアンインストール・データ削除の通知を通さない）
  if (isPlaceholder(appSecret)) throw new SignedRequestError("app secret not configured");
  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new SignedRequestError("malformed signed_request");
  const [sigPart, payloadPart] = parts as [string, string];

  let signature: Uint8Array;
  let payload: unknown;
  try {
    signature = b64urlToBytes(sigPart);
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadPart)));
  } catch {
    throw new SignedRequestError("malformed signed_request");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // verify は定数時間で比較する
  const ok = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(payloadPart));
  if (!ok) throw new SignedRequestError("invalid signature");

  if (typeof payload !== "object" || payload === null) throw new SignedRequestError("invalid payload");
  const p = payload as Record<string, unknown>;
  if (p.algorithm !== undefined && String(p.algorithm).toUpperCase() !== "HMAC-SHA256") {
    throw new SignedRequestError("unsupported algorithm");
  }
  const userId = p.user_id;
  if (typeof userId !== "string" && typeof userId !== "number") throw new SignedRequestError("missing user_id");
  const issuedAt = typeof p.issued_at === "number" ? new Date(p.issued_at * 1000) : undefined;
  return { userId: String(userId), issuedAt };
}
