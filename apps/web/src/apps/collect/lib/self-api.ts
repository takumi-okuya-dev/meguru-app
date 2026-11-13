// 参加者（ログインなし）のセルフ受付のAPIの呼び出し（specs/collect/002-self-check-in contracts/api.md 3、research.md R2）。
// 共通の request は 401 をログインの切れとして扱うので使わない（手伝う人の helper-api.ts と同じ）。
// 端末の印（画面で作る UUID）をセルフ受付のリンクごとに localStorage に持ち、見出し X-Collect-Device で送る。
// 保存が使えないときは、開いている間だけの印にする（開き直すと別の端末として数える）。
import {
  COLLECT_SELF_DEVICE_HEADER,
  errorResponseSchema,
  selfDeclareResponseSchema,
  selfLinkInfoSchema,
  selfMeSchema,
  selfRequestCreatedSchema,
  selfSearchResponseSchema,
  type SelfMethod,
  type SelfRequestCreate,
} from "@meguru/shared";
import type { z } from "zod";
import { API_BASE_URL, ApiError } from "@/lib/api-client";

const keyOf = (token: string) => `collect:self-device:${token}`;
const memory = new Map<string, string>();

/**
 * このリンクでの端末の印（なければ作って保存する）。
 * @param token - セルフ受付のリンクのトークン
 * @returns 端末の印（UUID）
 */
export function selfDevice(token: string): string {
  const cached = memory.get(token);
  if (cached) return cached;
  let value: string | null;
  try {
    value = window.localStorage.getItem(keyOf(token));
  } catch {
    value = null;
  }
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) {
    value = crypto.randomUUID();
    try {
      window.localStorage.setItem(keyOf(token), value);
    } catch {
      // 保存が使えない：開いている間だけ使う
    }
  }
  memory.set(token, value);
  return value;
}

/**
 * 参加者の道筋を呼ぶ。
 * @param token - セルフ受付のリンクのトークン
 * @param path - /s/:token のあとの道筋
 * @param init - fetch の設定
 * @returns 成功の応答
 * @throws ApiError
 */
async function send(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  headers.set(COLLECT_SELF_DEVICE_HEADER, selfDevice(token));
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/collect/s/${encodeURIComponent(token)}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError("API_UNREACHABLE", 0);
  }
  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => null));
    throw new ApiError(parsed.success ? parsed.data.error.code : "INTERNAL_ERROR", res.status);
  }
  return res;
}

/**
 * 呼んで、応答を形で確かめる。
 * @param schema - 応答の形
 * @param token - トークン
 * @param path - 道筋
 * @param init - fetch の設定
 * @returns 確かめた応答
 */
async function call<T>(schema: z.ZodType<T>, token: string, path: string, init?: RequestInit): Promise<T> {
  return schema.parse(await (await send(token, path, init)).json());
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/** 参加者のAPI。 */
export const selfApi = {
  info: (token: string) => call(selfLinkInfoSchema, token, ""),
  search: (token: string, query: string) => call(selfSearchResponseSchema, token, "/search", post({ query })),
  declare: (token: string, personId: string, method: SelfMethod | undefined, clientRequestId: string) =>
    call(selfDeclareResponseSchema, token, "/declare", post({ personId, ...(method ? { method } : {}), clientRequestId })),
  request: (token: string, input: SelfRequestCreate) => call(selfRequestCreatedSchema, token, "/requests", post(input)),
  me: (token: string) => call(selfMeSchema, token, "/me"),
  paypayQr: async (token: string) => (await send(token, "/paypay-qr")).blob(),
};
