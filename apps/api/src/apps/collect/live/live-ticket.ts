// 会場の共有の入場券（specs/collect/001-event-day-collection research.md R5、contracts/realtime.md 1、tasks.md T040）。
// ブラウザの WebSocket は見出しを付けられないので、イベントの番号・受付をする人・60秒の期限に COLLECT_LIVE_SECRET で
// 署名した短い入場券を URL に載せる。長く使える値（ログインのトークン・受付用リンク）は URL に載せない。
import { RECEPTION_LIMITS } from "@meguru/shared";

/** 受付をする人（主催者は "owner"、手伝う人は "helper:<番号>"）。 */
export type LiveReceiver = "owner" | `helper:${string}`;

/** 入場券の中身。 */
export type LiveTicketPayload = { eventId: string; receiver: LiveReceiver; expiresAt: Date };

const encoder = new TextEncoder();

/**
 * バイト列を base64url にする。
 * @param bytes - バイト列
 * @returns base64url の文字列
 */
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * base64url をバイト列に戻す。
 * @param text - base64url の文字列
 * @returns バイト列（形が違えば null）
 */
function fromBase64Url(text: string): Uint8Array | null {
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * 署名の鍵を作る。
 * @param secret - COLLECT_LIVE_SECRET
 * @returns HMAC-SHA256 の鍵
 */
function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/**
 * 入場券を作る。
 * @param secret - COLLECT_LIVE_SECRET
 * @param eventId - イベントの番号
 * @param receiver - 受付をする人
 * @param now - 今の時刻
 * @returns 入場券と期限
 */
export async function signLiveTicket(secret: string, eventId: string, receiver: LiveReceiver, now: Date): Promise<{ ticket: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + RECEPTION_LIMITS.liveTicketSeconds * 1000);
  const body = toBase64Url(encoder.encode(JSON.stringify({ e: eventId, r: receiver, x: Math.floor(expiresAt.getTime() / 1000) })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body)));
  return { ticket: `${body}.${toBase64Url(sig)}`, expiresAt };
}

/**
 * 入場券を確かめる（署名は一定時間で比べる crypto.subtle.verify）。
 * @param secret - COLLECT_LIVE_SECRET
 * @param ticket - 入場券
 * @param now - 今の時刻
 * @returns 中身（署名が合わない・期限が過ぎた・形が違うなら null）
 */
export async function verifyLiveTicket(secret: string, ticket: string, now: Date): Promise<LiveTicketPayload | null> {
  const [body, sigText, ...rest] = ticket.split(".");
  if (!body || !sigText || rest.length > 0) return null;
  const sig = fromBase64Url(sigText);
  if (!sig) return null;
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, encoder.encode(body)))) return null;
  const raw = fromBase64Url(body);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  const { e, r, x } = (parsed ?? {}) as { e?: unknown; r?: unknown; x?: unknown };
  if (typeof e !== "string" || typeof r !== "string" || typeof x !== "number") return null;
  if (r !== "owner" && !r.startsWith("helper:")) return null;
  if (x * 1000 <= now.getTime()) return null;
  return { eventId: e, receiver: r as LiveReceiver, expiresAt: new Date(x * 1000) };
}
