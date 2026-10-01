// APIクライアント。Clerkのセッショントークンを付け、レスポンスを共通スキーマで検証する。
// 401 を受けたら、セッション切れとして案内してから /sign-in へ遷移する（contracts/ui-routes.md の規則7）。
import {
  accountSummarySchema,
  connectResponseSchema,
  dataDeletionStatusSchema,
  errorMessage,
  errorResponseSchema,
  meResponseSchema,
  type ConnectRequest,
  type ErrorCode,
  type OpenAccountRequest,
} from "@threads-grower/shared";
import type { z } from "zod";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;
let onSessionExpired: () => void = () => {};

/** ClerkProvider の中で一度だけ設定する */
export function configureApiClient(opts: { getToken: TokenGetter; onSessionExpired: () => void }) {
  getToken = opts.getToken;
  onSessionExpired = opts.onSessionExpired;
}

async function request<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (init.auth !== false) {
    const token = await getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => null));
    const code: ErrorCode = parsed.success ? parsed.data.error.code : "INTERNAL_ERROR";
    if (res.status === 401) onSessionExpired();
    throw new ApiError(code, res.status);
  }
  if (schema === null || res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}

export const api = {
  me: () => request("/api/me", meResponseSchema),
  account: (accountId: string) => request(`/api/accounts/${accountId}`, accountSummarySchema),
  openAccount: (accountId: string, body: OpenAccountRequest, signal?: AbortSignal) =>
    request(`/api/accounts/${accountId}/open`, accountSummarySchema, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  connect: (body: ConnectRequest) =>
    request("/api/threads/connect", connectResponseSchema, { method: "POST", body: JSON.stringify(body) }),
  deleteAccount: (accountId: string, confirmUsername: string) =>
    request(`/api/accounts/${accountId}`, null, { method: "DELETE", body: JSON.stringify({ confirmUsername }) }),
  dataDeletionStatus: (code: string) =>
    request(`/api/data-deletion/${encodeURIComponent(code)}`, dataDeletionStatusSchema, { auth: false }),
};

/** エラーを画面の文言にする */
export function describeError(err: unknown, ctx: { username?: string; max?: number } = {}): string {
  const code: ErrorCode = err instanceof ApiError ? err.code : "INTERNAL_ERROR";
  return errorMessage(code, ctx).message;
}
