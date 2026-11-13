// 手伝う人（ログインなし）のAPIの呼び出し（specs/collect/001-event-day-collection contracts/api.md 8、research.md R7）。
// 共通の request は 401 をログインの切れとして扱い、ログインの画面へ移すので使わない（手伝う人の 401 は端末の印がないという意味）。
// 道筋は /api/collect/r/:token/…。参加のあとは見出し X-Collect-Device に端末の印を付ける。
import {
  COLLECT_DEVICE_HEADER,
  errorResponseSchema,
  helperJoinResponseSchema,
  helperLinkInfoSchema,
  liveTicketResponseSchema,
  receptionSnapshotSchema,
  recordReceptionResponseSchema,
  resolveSelfRequestResponseSchema,
  versionResponseSchema,
  walkInResponseSchema,
  type ConfirmReceptionRequest,
  type ErrorCode,
  type HelperJoinRequest,
  type RecordReceptionRequest,
  type SelfRequestAction,
  type WalkInRequest,
} from "@meguru/shared";
import type { z } from "zod";
import { API_BASE_URL, ApiError } from "@/lib/api-client";

/** 手伝う人の呼び出しの失敗（ApiError に、エラーの本文の足された値を添える）。 */
export class HelperApiError extends ApiError {
  constructor(
    code: ErrorCode,
    status: number,
    /** エラーの本文の足された値（HELPER_NAME_TAKEN の helperId・joinedAt など） */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code, status);
  }
}

/**
 * 手伝う人の道筋を呼ぶ。
 * @param token - 受付用リンクのトークン
 * @param path - /r/:token のあとの道筋（空なら /r/:token）
 * @param device - 端末の印（参加の前は null）
 * @param init - fetch の設定
 * @returns 成功の応答
 * @throws HelperApiError
 */
async function send(token: string, path: string, device: string | null, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (device) headers.set(COLLECT_DEVICE_HEADER, device);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/collect/r/${encodeURIComponent(token)}${path}`, { ...init, headers });
  } catch {
    throw new HelperApiError("API_UNREACHABLE", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: Record<string, unknown> } | null;
    const parsed = errorResponseSchema.safeParse(body);
    const { code: _code, message: _message, details: _details, ...extra } = body?.error ?? {};
    throw new HelperApiError(parsed.success ? parsed.data.error.code : "INTERNAL_ERROR", res.status, extra);
  }
  return res;
}

/**
 * 呼んで、応答を形で確かめる。
 * @param schema - 応答の形
 * @param token - 受付用リンクのトークン
 * @param path - /r/:token のあとの道筋
 * @param device - 端末の印
 * @param init - fetch の設定
 * @returns 確かめた応答
 */
async function call<T>(schema: z.ZodType<T>, token: string, path: string, device: string | null, init?: RequestInit): Promise<T> {
  return schema.parse(await (await send(token, path, device, init)).json());
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const person = (personId: string) => `/reception/${encodeURIComponent(personId)}`;

/** 手伝う人のAPI。 */
export const helperApi = {
  info: (token: string) => call(helperLinkInfoSchema, token, "", null),
  join: (token: string, input: HelperJoinRequest) => call(helperJoinResponseSchema, token, "/join", null, json("POST", input)),
  reception: (token: string, device: string) => call(receptionSnapshotSchema, token, "/reception", device),
  record: (token: string, device: string, personId: string, input: RecordReceptionRequest) =>
    call(recordReceptionResponseSchema, token, person(personId), device, json("PUT", input)),
  undo: (token: string, device: string, personId: string) => call(versionResponseSchema, token, person(personId), device, { method: "DELETE" }),
  walkIn: (token: string, device: string, input: WalkInRequest) => call(walkInResponseSchema, token, "/walk-ins", device, json("POST", input)),
  paypayQr: async (token: string, device: string) => (await send(token, "/paypay-qr", device)).blob(),
  liveTicket: (token: string, device: string) => call(liveTicketResponseSchema, token, "/live-ticket", device, { method: "POST" }),
  // セルフ受付の確かめ・申し出（specs/collect/002）
  confirm: (token: string, device: string, personId: string, input: ConfirmReceptionRequest) =>
    call(recordReceptionResponseSchema, token, `${person(personId)}/confirm`, device, json("POST", input)),
  resolveRequest: (token: string, device: string, requestId: string, action: SelfRequestAction, personId?: string) =>
    call(resolveSelfRequestResponseSchema, token, `/self-requests/${encodeURIComponent(requestId)}/${action}`, device, json("POST", personId ? { personId } : {})),
};
