// APIクライアント。Clerkのセッショントークンを付け、レスポンスを共通スキーマで検証する。
// 401 を受けたら、セッション切れとして案内してから /sign-in へ遷移する（contracts/ui-routes.md の規則7）。
import {
  operatorAppRegistrySchema,
  billingRedirectSchema,
  withdrawalPreviewSchema,
  billingSummarySchema,
  testGroupDetailSchema,
  testGroupListSchema,
  featureSettingsListSchema,
  operatorUserSchema,
  operatorLimitUserSchema,
  operatorLimitsSchema,
  defaultLimitsRequestSchema,
  type FeatureSettingsRequest,
  testGroupSummarySchema,
  testInviteJoinResponseSchema,
  testInvitePreviewSchema,
  referralPageSchema,
  referralResponseSchema,
  errorMessage,
  errorResponseSchema,
  meResponseSchema,
  type ErrorCode,
} from "@meguru/shared";
import { z } from "zod";
import { clearReferral, currentReferral } from "./referral-store";


/** API のベースURL（apps/web/.env.local の VITE_API_BASE_URL）。 */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

/** API の呼び出しの失敗。エラーコードと HTTP のステータス（通信の失敗は 0）。 */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    /** CONFIG_ERROR のときの誤っている設定の項目名、VALIDATION_FAILED のときの違反した項目名 */
    readonly details: string[] = [],
    /** 409 STALE_UPDATE のときの、DBにある最新の値（specs/002 contracts/api.md） */
    readonly latest?: unknown,
    /** 409 STALE_UPDATE のときの、先に保存した人（specs/008 FR-007） */
    readonly updatedBy: { name: string } | null = null,
  ) {
    super(code);
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;
let onSessionExpired: () => void = () => {};

// ---- 退会の途中（specs/013 research.md R10）。どのAPIの応答で分かっても、画面を「退会の手続きの途中です」に替える ----
let withdrawalInProgress = false;
const withdrawalListeners = new Set<() => void>();

/**
 * 退会の途中になったことを知らせる。
 * @param value - 途中なら true（退会が終わったら false に戻す）
 */
export function setWithdrawalInProgress(value: boolean) {
  if (withdrawalInProgress === value) return;
  withdrawalInProgress = value;
  for (const l of withdrawalListeners) l();
}

/**
 * 退会の途中かを読む（useSyncExternalStore 用）。
 * @returns 途中なら true
 */
export function getWithdrawalInProgress(): boolean {
  return withdrawalInProgress;
}

/**
 * 退会の途中の変化を受け取る（useSyncExternalStore 用）。
 * @param listener - 変わったときに呼ぶ
 * @returns 受け取りをやめる関数
 */
export function subscribeWithdrawalInProgress(listener: () => void): () => void {
  withdrawalListeners.add(listener);
  return () => withdrawalListeners.delete(listener);
}

// ---- テスト版に入れない（specs/016 research.md R5）。/api/me か、どのAPIの応答で分かっても、画面を「招待された方だけ」に替える ----
let testAccessRequired = false;
const testAccessListeners = new Set<() => void>();

/**
 * テスト版に入れないことを知らせる。
 * @param value - 入れないなら true（グループに入ったら false に戻す）
 */
export function setTestAccessRequired(value: boolean) {
  if (testAccessRequired === value) return;
  testAccessRequired = value;
  for (const l of testAccessListeners) l();
}

/**
 * テスト版に入れないかを読む（useSyncExternalStore 用）。
 * @returns 入れないなら true
 */
export function getTestAccessRequired(): boolean {
  return testAccessRequired;
}

/**
 * テスト版に入れないかの変化を受け取る（useSyncExternalStore 用）。
 * @param listener - 変わったときに呼ぶ
 * @returns 受け取りをやめる関数
 */
export function subscribeTestAccessRequired(listener: () => void): () => void {
  testAccessListeners.add(listener);
  return () => testAccessListeners.delete(listener);
}

// ---- 契約前（specs/024 research.md R9）。/api/me か、どのAPIの応答で分かっても、画面を「契約してから使い始めます」に替える ----
let subscriptionRequired = false;
const subscriptionListeners = new Set<() => void>();

/**
 * 契約前であることを知らせる。
 * @param value - 契約前なら true（契約したら false に戻す）
 */
export function setSubscriptionRequired(value: boolean) {
  if (subscriptionRequired === value) return;
  subscriptionRequired = value;
  for (const l of subscriptionListeners) l();
}

/**
 * 契約前かを読む（useSyncExternalStore 用）。
 * @returns 契約前なら true
 */
export function getSubscriptionRequired(): boolean {
  return subscriptionRequired;
}

/**
 * 契約前かの変化を受け取る（useSyncExternalStore 用）。
 * @param listener - 変わったときに呼ぶ
 * @returns 受け取りをやめる関数
 */
export function subscribeSubscriptionRequired(listener: () => void): () => void {
  subscriptionListeners.add(listener);
  return () => subscriptionListeners.delete(listener);
}

/**
 * API クライアントに、Clerk のトークンの取り方とセッション切れの扱いを渡す。ClerkProvider の中で一度だけ呼ぶ。
 * @param opts - getToken：セッショントークンを返す関数、onSessionExpired：401 を受けたときの処理
 */
export function configureApiClient(opts: { getToken: TokenGetter; onSessionExpired: () => void }) {
  getToken = opts.getToken;
  onSessionExpired = opts.onSessionExpired;
}

/**
 * API を呼ぶ共通の部品。トークンを付け、エラーを ApiError にし、レスポンスをスキーマで検証する。アプリの呼び出し
 * （apps/<名前>/lib/api.ts）からも使う（specs/meguru/029-threads-pattern1 contracts/api-routes.md 4）。
 * @param path - /api から始まる道筋
 * @param schema - レスポンスのスキーマ（中身がなければ null）
 * @param init - fetch の設定（auth: false でトークンを付けない。onError は ApiError を投げる前に呼ぶ。アプリが自分のエラーを扱うため）
 * @returns 検証したレスポンス
 */
export async function request<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: RequestInit & { auth?: boolean; onError?: (err: ApiError) => void } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (init.auth !== false) {
    const token = await getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // 紹介リンクを開いてから登録する人の紹介した人（APIは、利用者の行を新しく作るときだけ読む。specs/017 research.md R4）
    const referral = currentReferral();
    if (referral) headers.set("X-Referral-Code", referral);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (err) {
    // 中止は呼び出し側で扱う。それ以外の通信の失敗は、APIに届いていない（起動していない・CORSで拒否された など）
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("API_UNREACHABLE", 0);
  }
  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => null));
    const code: ErrorCode = parsed.success ? parsed.data.error.code : "INTERNAL_ERROR";
    if (res.status === 401) onSessionExpired();
    if (code === "WITHDRAWAL_IN_PROGRESS") setWithdrawalInProgress(true);
    if (code === "TEST_ACCESS_REQUIRED") setTestAccessRequired(true);
    if (code === "SUBSCRIPTION_REQUIRED") setSubscriptionRequired(true);
    const err = new ApiError(
      code,
      res.status,
      parsed.success ? (parsed.data.error.details ?? []) : [],
      parsed.success ? parsed.data.latest : undefined,
      parsed.success ? (parsed.data.updatedBy ?? null) : null,
    );
    init.onError?.(err);
    throw err;
  }
  if (schema === null || res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}


/** API の呼び出し。レスポンスは共通のスキーマで検証する。 */
export const api = {
  me: async () => {
    const me = await request("/api/me", meResponseSchema);
    // 利用者の行がある（＝登録が終わった）ので、紹介の文字列はもう要らない（specs/017 contracts/ui-routes.md 3）
    clearReferral();
    if (me.withdrawalInProgress) setWithdrawalInProgress(true);
    setTestAccessRequired(me.testGroups.enabled && !me.testGroups.admitted);
    setSubscriptionRequired(me.billing.state === "unsubscribed");
    return me;
  },
  // 最後に使ったアプリを覚える（specs/028 contracts/api.md 2）
  putLastApp: (app: string) => request("/api/me/last-app", null, { method: "PUT", body: JSON.stringify({ app }) }),
  // ---- 退会（specs/013 contracts/api.md「自分」）----
  withdrawalPreview: () => request("/api/me/withdrawal-preview", withdrawalPreviewSchema),
  withdraw: (confirmEmail: string) =>
    request("/api/me/withdraw", null, { method: "POST", body: JSON.stringify({ confirmEmail }) }),
  // ---- 契約と支払い（specs/013-billing contracts/api.md）----
  billing: () => request("/api/billing", billingSummarySchema),
  syncBilling: () => request("/api/billing/sync", billingSummarySchema, { method: "POST" }),
  startCheckout: () => request("/api/billing/checkout", billingRedirectSchema, { method: "POST" }),
  openPortal: () => request("/api/billing/portal", billingRedirectSchema, { method: "POST" }),
  // ---- 紹介リンク（specs/017 contracts/api.md）----
  referral: () => request("/api/me/referral", referralResponseSchema),
  referralPage: () => request("/api/referral-page", referralPageSchema, { auth: false }),
  // ---- テスト用のグループ（specs/016 contracts/api.md）----
  previewTestInvite: (token: string) => request(`/api/test-invites/${encodeURIComponent(token)}`, testInvitePreviewSchema),
  joinTestGroup: (token: string) =>
    request(`/api/test-invites/${encodeURIComponent(token)}/join`, testInviteJoinResponseSchema, { method: "POST" }),
  testGroups: () => request("/api/operator/test-groups", testGroupListSchema),
  createTestGroup: (input: { name: string; capacity: number }) =>
    request("/api/operator/test-groups", testGroupSummarySchema, { method: "POST", body: JSON.stringify(input) }),
  testGroup: (id: string) => request(`/api/operator/test-groups/${encodeURIComponent(id)}`, testGroupDetailSchema),
  updateTestGroup: (id: string, input: { name?: string; capacity?: number }) =>
    request(`/api/operator/test-groups/${encodeURIComponent(id)}`, testGroupDetailSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  rotateTestGroupInvite: (id: string) =>
    request(`/api/operator/test-groups/${encodeURIComponent(id)}/rotate-invite`, testGroupDetailSchema, { method: "POST" }),
  closeTestGroup: (id: string) =>
    request(`/api/operator/test-groups/${encodeURIComponent(id)}/close`, testGroupDetailSchema, { method: "POST" }),
  removeTestGroupMember: (id: string, userId: string) =>
    request(
      `/api/operator/test-groups/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      testGroupDetailSchema,
      { method: "DELETE" },
    ),
  // 機能のまとまりごとのON/OFF（specs/019 contracts/api.md「運営者のAPI」）
  putTestGroupFeatures: (id: string, features: FeatureSettingsRequest["features"]) =>
    request(`/api/operator/test-groups/${encodeURIComponent(id)}/features`, testGroupDetailSchema, {
      method: "PUT",
      body: JSON.stringify({ features }),
    }),
  // 登録されたアプリの機能と上限の一覧（運営の画面が、アプリの名前を直接書かずに出すため。specs/meguru/029 T070）
  appRegistry: () => request("/api/operator/app-registry", operatorAppRegistrySchema),
  featureSettings: () => request("/api/operator/feature-settings", featureSettingsListSchema),
  findOperatorUser: (email: string) => request(`/api/operator/users?email=${encodeURIComponent(email)}`, operatorUserSchema),
  putFeatureSettings: (userId: string, features: FeatureSettingsRequest["features"]) =>
    request(`/api/operator/feature-settings/${encodeURIComponent(userId)}`, operatorUserSchema, {
      method: "PUT",
      body: JSON.stringify({ features }),
    }),
  resetFeatureSettings: (userId: string) =>
    request(`/api/operator/feature-settings/${encodeURIComponent(userId)}`, operatorUserSchema, { method: "DELETE" }),
  // 上限（specs/024 contracts/api.md「運営者の上限」）
  operatorLimits: () => request("/api/operator/limits", operatorLimitsSchema),
  // 上限は「名前 → 値」（名前はアプリが登録したもの。specs/meguru/029 T070）
  putDefaultLimits: (limits: Record<string, number>) =>
    request("/api/operator/limits", defaultLimitsRequestSchema, { method: "PUT", body: JSON.stringify({ limits }) }),
  findLimitUser: (email: string) =>
    request(`/api/operator/limits/users?email=${encodeURIComponent(email)}`, operatorLimitUserSchema),
  putUserLimits: (userId: string, limits: Record<string, number | null>) =>
    request(`/api/operator/limits/users/${encodeURIComponent(userId)}`, operatorLimitUserSchema, {
      method: "PUT",
      body: JSON.stringify({ limits }),
    }),
};

/**
 * エラーを、画面に出す日本語の文言にする。
 * @param err - API の呼び出しの失敗など
 * @param ctx - 文言に埋め込む値（ユーザー名・上限）
 * @returns 画面に出す文言
 */
export function describeError(err: unknown, ctx: { username?: string; max?: number } = {}): string {
  const code: ErrorCode = err instanceof ApiError ? err.code : "INTERNAL_ERROR";
  const details = err instanceof ApiError ? err.details : [];
  return errorMessage(code, { ...ctx, details, apiUrl: API_BASE_URL }).message;
}
