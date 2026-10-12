// APIクライアント。Clerkのセッショントークンを付け、レスポンスを共通スキーマで検証する。
// 401 を受けたら、セッション切れとして案内してから /sign-in へ遷移する（contracts/ui-routes.md の規則7）。
import {
  accountAccessResponseSchema,
  accountTeamSchema,
  inviteAcceptResponseSchema,
  invitePreviewSchema,
  partnerInviteResponseSchema,
  activityListSchema,
  partnerSummarySchema,
  teamInviteSchema,
  teamSchema,
  accountSummarySchema,
  exportPageSchema,
  feedbackResponseSchema,
  performancePageSchema,
  type PerformanceTab,
  connectResponseSchema,
  tokenConnectResponseSchema,
  deleteCountSchema,
  draftBatchResultSchema,
  postDraftListSchema,
  addNgWordsResponseSchema,
  coreRulesResponseSchema,
  draftCountsSchema,
  postingRulesSchema,
  reviewResponseSchema,
  updatePostDraftResponseSchema,
  promptResponseSchema,
  promptSettingsSchema,
  dataDeletionStatusSchema,
  errorMessage,
  errorResponseSchema,
  meResponseSchema,
  needsReviewCountsResponseSchema,
  profileStatusSchema,
  promotionListSchema,
  promotionSchema,
  promotionSettingsSchema,
  referencePostListSchema,
  referencePostSchema,
  researchKeywordListSchema,
  researchKeywordSchema,
  strategySchema,
  autoPostStatusSchema,
  postDraftSchema,
  postingScheduleResponseSchema,
  publishedPageSchema,
  putPostingScheduleResponseSchema,
  threadsCheckSchema,
  type PutPostingScheduleRequest,
  type ConnectRequest,
  TokenConnectRequestBody,
  type ReviewRequest,
  type PromotionInput,
  type PutStrategyRequest,
  type ReferencePostInput,
  type ResearchKeywordInput,
  type ErrorCode,
  type OpenAccountRequest,
} from "@threads-grower/shared";
import { z } from "zod";

/** PATCH /accounts/:id/partner のレスポンス（specs/008 FR-030）。 */
const delegationResponseSchema = z.object({ delegation: z.object({ review: z.boolean(), settings: z.boolean() }) });

/** POST /post-drafts/:id/prioritize のレスポンス。 */
const postDraftResponseSchema = z.object({ draft: postDraftSchema });

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

/** Accountの API が権限・存在のエラーを返したときの受け取り口（specs/008 contracts/ui-routes.md「共通の振る舞い」2・3）。 */
export type AccountAccessErrorListener = (code: "ROLE_FORBIDDEN" | "ACCOUNT_NOT_FOUND", accountId: string) => void;
let onAccountAccessError: AccountAccessErrorListener | null = null;

/**
 * Accountの API の 403 ROLE_FORBIDDEN・404 ACCOUNT_NOT_FOUND を受け取る関数を登録する。Accountの画面の親が登録する。
 * @param listener - 受け取る関数（NULLで解除）
 */
export function setAccountAccessErrorListener(listener: AccountAccessErrorListener | null) {
  onAccountAccessError = listener;
}

const ACCOUNT_PATH = /^\/api\/accounts\/([0-9a-f-]{36})(?:\/|$)/i;

/**
 * API クライアントに、Clerk のトークンの取り方とセッション切れの扱いを渡す。ClerkProvider の中で一度だけ呼ぶ。
 * @param opts - getToken：セッショントークンを返す関数、onSessionExpired：401 を受けたときの処理
 */
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
    const accountId = ACCOUNT_PATH.exec(path)?.[1];
    if (accountId && (code === "ROLE_FORBIDDEN" || code === "ACCOUNT_NOT_FOUND")) onAccountAccessError?.(code, accountId);
    throw new ApiError(
      code,
      res.status,
      parsed.success ? (parsed.data.error.details ?? []) : [],
      parsed.success ? parsed.data.latest : undefined,
      parsed.success ? (parsed.data.updatedBy ?? null) : null,
    );
  }
  if (schema === null || res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}

/** 傾向メモ・切り替えの保存の入力（specs/006 contracts/api.md）。 */
type FeedbackRequestInput = { memo?: string | null; includeInPrompt?: boolean; expectedVersion?: number };

/** API の呼び出し。レスポンスは共通のスキーマで検証する。 */
export const api = {
  me: () => request("/api/me", meResponseSchema),
  needsReviewCounts: () => request("/api/me/needs-review-counts", needsReviewCountsResponseSchema),
  account: (accountId: string) => request(`/api/accounts/${accountId}`, accountSummarySchema),
  // ---- チーム運用（specs/008-team-operations contracts/api.md）----
  accountAccess: (accountId: string) => request(`/api/accounts/${accountId}/access`, accountAccessResponseSchema),
  getPartnerInvite: (accountId: string) =>
    request(`/api/accounts/${accountId}/partner-invite`, partnerInviteResponseSchema),
  createPartnerInvite: (accountId: string) =>
    request(`/api/accounts/${accountId}/partner-invite`, partnerInviteResponseSchema, { method: "POST" }),
  rotatePartnerInvite: (accountId: string) =>
    request(`/api/accounts/${accountId}/partner-invite/rotate`, partnerInviteResponseSchema, { method: "POST" }),
  cancelPartnerInvite: (accountId: string) =>
    request(`/api/accounts/${accountId}/partner-invite`, null, { method: "DELETE" }),
  accountTeam: (accountId: string) => request(`/api/accounts/${accountId}/team`, accountTeamSchema),
  removePartner: (accountId: string) => request(`/api/accounts/${accountId}/partner`, null, { method: "DELETE" }),
  setDelegation: (accountId: string, delegation: { review?: boolean; settings?: boolean }) =>
    request(`/api/accounts/${accountId}/partner`, delegationResponseSchema, {
      method: "PATCH",
      body: JSON.stringify({ delegation }),
    }),
  dismissPartnerJoined: (accountId: string) =>
    request(`/api/accounts/${accountId}/partner/joined-notice/dismiss`, null, { method: "POST" }),
  listActivity: (accountId: string, q: { kind?: string; actor?: string; cursor?: string }) => {
    const params = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1])));
    const qs = params.toString();
    return request(`/api/accounts/${accountId}/activity${qs ? `?${qs}` : ""}`, activityListSchema);
  },
  getTeam: () => request("/api/team", teamSchema),
  getTeamAccounts: () => request("/api/team/accounts", partnerSummarySchema),
  renameTeam: (name: string) => request("/api/team", teamSchema, { method: "PATCH", body: JSON.stringify({ name }) }),
  getTeamInvite: () => request("/api/team/invite", teamInviteSchema),
  rotateTeamInvite: () => request("/api/team/invite/rotate", teamInviteSchema, { method: "POST" }),
  assignEditor: (userId: string, accountId: string) =>
    request(`/api/team/editors/${userId}/accounts/${accountId}`, null, { method: "PUT" }),
  unassignEditor: (userId: string, accountId: string) =>
    request(`/api/team/editors/${userId}/accounts/${accountId}`, null, { method: "DELETE" }),
  removeEditor: (userId: string) => request(`/api/team/editors/${userId}`, null, { method: "DELETE" }),
  previewInvite: (token: string) => request(`/api/invites/${encodeURIComponent(token)}`, invitePreviewSchema),
  acceptInvite: (token: string, teamName?: string) =>
    request(`/api/invites/${encodeURIComponent(token)}/accept`, inviteAcceptResponseSchema, {
      method: "POST",
      body: JSON.stringify(teamName === undefined ? {} : { teamName }),
    }),
  openAccount: (accountId: string, body: OpenAccountRequest, signal?: AbortSignal) =>
    request(`/api/accounts/${accountId}/open`, accountSummarySchema, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  // 自分のMetaアプリのトークンで追加・接続し直す（specs/010 contracts/api.md）
  tokenConnect: (body: TokenConnectRequestBody) =>
    request("/api/threads/token-connect", tokenConnectResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  connect: (body: ConnectRequest) =>
    request("/api/threads/connect", connectResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteAccount: (accountId: string, confirmUsername: string) =>
    request(`/api/accounts/${accountId}`, null, {
      method: "DELETE",
      body: JSON.stringify({ confirmUsername }),
    }),
  // ---- 戦略プロファイル（specs/002-strategy-profile contracts/api.md）----
  getProfileStatus: (accountId: string) =>
    request(`/api/accounts/${accountId}/profile-status`, profileStatusSchema),
  getStrategy: (accountId: string) =>
    request(`/api/accounts/${accountId}/strategy`, strategySchema),
  putStrategy: (accountId: string, body: PutStrategyRequest) =>
    request(`/api/accounts/${accountId}/strategy`, strategySchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  listPromotions: (accountId: string) =>
    request(`/api/accounts/${accountId}/promotions`, promotionListSchema),
  createPromotion: (accountId: string, body: PromotionInput) =>
    request(`/api/accounts/${accountId}/promotions`, promotionSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePromotion: (
    accountId: string,
    id: string,
    body: PromotionInput & { expectedVersion: number },
  ) =>
    request(`/api/accounts/${accountId}/promotions/${id}`, promotionSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deletePromotion: (accountId: string, id: string) =>
    request(`/api/accounts/${accountId}/promotions/${id}`, null, { method: "DELETE" }),
  getPromotionSettings: (accountId: string) =>
    request(`/api/accounts/${accountId}/promotion-settings`, promotionSettingsSchema),
  putPromotionSettings: (accountId: string, ratioPercent: number, expectedVersion: number) =>
    request(`/api/accounts/${accountId}/promotion-settings`, promotionSettingsSchema, {
      method: "PUT",
      body: JSON.stringify({ ratioPercent, expectedVersion }),
    }),
  listReferencePosts: (accountId: string) =>
    request(`/api/accounts/${accountId}/reference-posts`, referencePostListSchema),
  createReferencePost: (accountId: string, body: ReferencePostInput) =>
    request(`/api/accounts/${accountId}/reference-posts`, referencePostSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateReferencePost: (
    accountId: string,
    id: string,
    body: ReferencePostInput & { expectedVersion: number },
  ) =>
    request(`/api/accounts/${accountId}/reference-posts/${id}`, referencePostSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteReferencePost: (accountId: string, id: string) =>
    request(`/api/accounts/${accountId}/reference-posts/${id}`, null, { method: "DELETE" }),
  listResearchKeywords: (accountId: string) =>
    request(`/api/accounts/${accountId}/research-keywords`, researchKeywordListSchema),
  createResearchKeyword: (accountId: string, body: ResearchKeywordInput) =>
    request(`/api/accounts/${accountId}/research-keywords`, researchKeywordSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateResearchKeyword: (
    accountId: string,
    id: string,
    body: ResearchKeywordInput & { expectedVersion: number },
  ) =>
    request(`/api/accounts/${accountId}/research-keywords/${id}`, researchKeywordSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteResearchKeyword: (accountId: string, id: string) =>
    request(`/api/accounts/${accountId}/research-keywords/${id}`, null, { method: "DELETE" }),
  // ---- 投稿ストック（specs/003-prompt-bulk-register contracts/api.md）----
  getPrompt: (accountId: string, count?: number) =>
    request(
      `/api/accounts/${accountId}/prompt${count === undefined ? "" : `?count=${count}`}`,
      promptResponseSchema,
    ),
  putPromptSettings: (accountId: string, postCount: number, expectedVersion: number) =>
    request(`/api/accounts/${accountId}/prompt-settings`, promptSettingsSchema, {
      method: "PUT",
      body: JSON.stringify({ postCount, expectedVersion }),
    }),
  listPostDrafts: (accountId: string) =>
    request(`/api/accounts/${accountId}/post-drafts`, postDraftListSchema),
  createDraftBatch: (accountId: string, body: { clientRequestId: string; text: string }) =>
    request(`/api/accounts/${accountId}/draft-batches`, draftBatchResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteDraftBatch: (accountId: string, batchId: string) =>
    request(`/api/accounts/${accountId}/draft-batches/${batchId}`, deleteCountSchema, {
      method: "DELETE",
    }),
  updatePostDraft: (
    accountId: string,
    id: string,
    body: { body: string; expectedVersion: number },
  ) =>
    request(`/api/accounts/${accountId}/post-drafts/${id}`, updatePostDraftResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deletePostDrafts: (accountId: string, ids: string[]) =>
    request(`/api/accounts/${accountId}/post-drafts/delete`, deleteCountSchema, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  // ---- 承認・却下・投稿のルール（specs/004-review-approval contracts/api.md）----
  getDraftCounts: (accountId: string) =>
    request(`/api/accounts/${accountId}/post-drafts/counts`, draftCountsSchema),
  reviewPostDrafts: (accountId: string, body: ReviewRequest) =>
    request(`/api/accounts/${accountId}/post-drafts/review`, reviewResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getPostingRules: (accountId: string) =>
    request(`/api/accounts/${accountId}/posting-rules`, postingRulesSchema),
  addNgWords: (accountId: string, words: string[]) =>
    request(`/api/accounts/${accountId}/ng-words`, addNgWordsResponseSchema, {
      method: "POST",
      body: JSON.stringify({ words }),
    }),
  deleteNgWord: (accountId: string, id: string) =>
    request(`/api/accounts/${accountId}/ng-words/${id}`, null, { method: "DELETE" }),
  putCoreRules: (accountId: string, body: { text: string; expectedVersion: number }) =>
    request(`/api/accounts/${accountId}/core-rules`, coreRulesResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // ---- 自動投稿（specs/005-auto-post contracts/api.md）----
  getPostingSchedule: (accountId: string) =>
    request(`/api/accounts/${accountId}/posting-schedule`, postingScheduleResponseSchema),
  putPostingSchedule: (accountId: string, body: PutPostingScheduleRequest) =>
    request(`/api/accounts/${accountId}/posting-schedule`, putPostingScheduleResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  checkThreads: (accountId: string) =>
    request(`/api/accounts/${accountId}/threads-check`, threadsCheckSchema, { method: "POST" }),
  getAutoPost: (accountId: string) =>
    request(`/api/accounts/${accountId}/auto-post`, autoPostStatusSchema),
  dismissBlockedNotice: (accountId: string) =>
    request(`/api/accounts/${accountId}/auto-post/notices/blocked/dismiss`, null, {
      method: "POST",
    }),
  getPerformance: (accountId: string, tab: PerformanceTab, before?: string) => {
    const q = new URLSearchParams({ tab });
    if (before) q.set("before", before);
    return request(`/api/accounts/${accountId}/performance?${q}`, performancePageSchema);
  },
  updateFeedback: (accountId: string, draftId: string, body: FeedbackRequestInput) =>
    request(`/api/accounts/${accountId}/performance/${draftId}/feedback`, feedbackResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  exportPerformance: (accountId: string, kind: "posts" | "snapshots", before?: string) => {
    const q = new URLSearchParams({ kind });
    if (before) q.set("before", before);
    return request(`/api/accounts/${accountId}/performance/export?${q}`, exportPageSchema);
  },
  listPublished: (accountId: string, before?: string) =>
    request(
      `/api/accounts/${accountId}/post-drafts/published${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      publishedPageSchema,
    ),
  prioritizeDraft: (accountId: string, id: string, expectedVersion: number) =>
    request(`/api/accounts/${accountId}/post-drafts/${id}/prioritize`, postDraftResponseSchema, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    }),
  dataDeletionStatus: (code: string) =>
    request(`/api/data-deletion/${encodeURIComponent(code)}`, dataDeletionStatusSchema, {
      auth: false,
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
