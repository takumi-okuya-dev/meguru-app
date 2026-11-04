// APIクライアント。Clerkのセッショントークンを付け、レスポンスを共通スキーマで検証する。
// 401 を受けたら、セッション切れとして案内してから /sign-in へ遷移する（contracts/ui-routes.md の規則7）。
import {
  accountAccessResponseSchema,
  billingRedirectSchema,
  withdrawalPreviewSchema,
  billingSummarySchema,
  accountTeamSchema,
  inviteAcceptResponseSchema,
  invitePreviewSchema,
  testGroupDetailSchema,
  testGroupListSchema,
  featureSettingsListSchema,
  operatorUserSchema,
  type FeatureSettingsRequest,
  testGroupSummarySchema,
  testInviteJoinResponseSchema,
  testInvitePreviewSchema,
  referralPageSchema,
  referralResponseSchema,
  activityListSchema,
  teamAssignmentsSchema,
  teamCreateResponseSchema,
  teamDetailSchema,
  teamInviteSchema,
  accountSummarySchema,
  exportPageSchema,
  feedbackResponseSchema,
  performancePageSchema,
  type PerformanceTab,
  completeConnectResponseSchema,
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
  explainPromptSchema,
  keywordBatchResultSchema,
  keywordIdeaPromptSchema,
  explanationsResultSchema,
  referencePostBatchResultSchema,
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
  type CompleteConnectRequest,
  type ConnectRequest,
  TokenConnectRequestBody,
  type ReviewRequest,
  type PromotionInput,
  type PutStrategyRequest,
  type PostLengthSettings,
  type ReferencePostInputBody,
  type ResearchKeywordInput,
  type ErrorCode,
  type OpenAccountRequest,
  type CreateAccountRequest,
  type RenameAccountRequest,
} from "@threads-grower/shared";
import { z } from "zod";
import { clearReferral, currentReferral } from "./referral-store";

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
  me: async () => {
    const me = await request("/api/me", meResponseSchema);
    // 利用者の行がある（＝登録が終わった）ので、紹介の文字列はもう要らない（specs/017 contracts/ui-routes.md 3）
    clearReferral();
    if (me.withdrawalInProgress) setWithdrawalInProgress(true);
    setTestAccessRequired(me.testGroups.enabled && !me.testGroups.admitted);
    return me;
  },
  // ---- 退会（specs/013 contracts/api.md「自分」）----
  withdrawalPreview: () => request("/api/me/withdrawal-preview", withdrawalPreviewSchema),
  withdraw: (confirmEmail: string) =>
    request("/api/me/withdraw", null, { method: "POST", body: JSON.stringify({ confirmEmail }) }),
  // ---- 契約と支払い（specs/013-billing contracts/api.md）----
  billing: () => request("/api/billing", billingSummarySchema),
  syncBilling: () => request("/api/billing/sync", billingSummarySchema, { method: "POST" }),
  startCheckout: () => request("/api/billing/checkout", billingRedirectSchema, { method: "POST" }),
  openPortal: () => request("/api/billing/portal", billingRedirectSchema, { method: "POST" }),
  needsReviewCounts: () => request("/api/me/needs-review-counts", needsReviewCountsResponseSchema),
  account: (accountId: string) => request(`/api/accounts/${accountId}`, accountSummarySchema),
  // ---- チーム（specs/011-team-revision contracts/api.md）----
  accountAccess: (accountId: string) => request(`/api/accounts/${accountId}/access`, accountAccessResponseSchema),
  accountTeam: (accountId: string) => request(`/api/accounts/${accountId}/team`, accountTeamSchema),
  listActivity: (accountId: string, q: { kind?: string; actor?: string; cursor?: string }) => {
    const params = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1])));
    const qs = params.toString();
    return request(`/api/accounts/${accountId}/activity${qs ? `?${qs}` : ""}`, activityListSchema);
  },
  dismissAssignedNotice: (accountId: string) =>
    request(`/api/accounts/${accountId}/assigned-notice/dismiss`, null, { method: "POST" }),
  createTeam: (body: { name: string; accountIds: string[] }) =>
    request("/api/teams", teamCreateResponseSchema, { method: "POST", body: JSON.stringify(body) }),
  getTeam: (teamId: string) => request(`/api/teams/${teamId}`, teamDetailSchema),
  renameTeam: (teamId: string, name: string) =>
    request(`/api/teams/${teamId}`, null, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteTeam: (teamId: string) => request(`/api/teams/${teamId}`, null, { method: "DELETE" }),
  getTeamInvite: (teamId: string) => request(`/api/teams/${teamId}/invite`, teamInviteSchema),
  rotateTeamInvite: (teamId: string) => request(`/api/teams/${teamId}/invite/rotate`, teamInviteSchema, { method: "POST" }),
  setMemberRole: (teamId: string, userId: string, role: "member" | "editor") =>
    request(`/api/teams/${teamId}/members/${userId}`, null, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeMember: (teamId: string, userId: string) => request(`/api/teams/${teamId}/members/${userId}`, null, { method: "DELETE" }),
  dismissJoinedNotice: (teamId: string, userId: string) =>
    request(`/api/teams/${teamId}/members/${userId}/joined-notice/dismiss`, null, { method: "POST" }),
  leaveTeam: (teamId: string, newAdminUserId?: string) =>
    request(`/api/teams/${teamId}/leave`, null, {
      method: "POST",
      body: JSON.stringify(newAdminUserId ? { newAdminUserId } : {}),
    }),
  transferAdmin: (teamId: string, userId: string) =>
    request(`/api/teams/${teamId}/admin`, null, { method: "POST", body: JSON.stringify({ userId }) }),
  addTeamAccount: (teamId: string, accountId: string, shared = false) =>
    request(`/api/teams/${teamId}/accounts`, null, { method: "POST", body: JSON.stringify({ accountId, shared }) }),
  setTeamShared: (teamId: string, accountId: string, shared: boolean) =>
    request(`/api/teams/${teamId}/accounts/${accountId}`, null, { method: "PATCH", body: JSON.stringify({ shared }) }),
  removeTeamAccount: (teamId: string, accountId: string) =>
    request(`/api/teams/${teamId}/accounts/${accountId}`, null, { method: "DELETE" }),
  getAssignments: (teamId: string) => request(`/api/teams/${teamId}/assignments`, teamAssignmentsSchema),
  assign: (teamId: string, userId: string, accountId: string) =>
    request(`/api/teams/${teamId}/assignments/${userId}/accounts/${accountId}`, null, { method: "PUT" }),
  unassign: (teamId: string, userId: string, accountId: string) =>
    request(`/api/teams/${teamId}/assignments/${userId}/accounts/${accountId}`, null, { method: "DELETE" }),
  previewInvite: (token: string) => request(`/api/invites/${encodeURIComponent(token)}`, invitePreviewSchema),
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
  featureSettings: () => request("/api/operator/feature-settings", featureSettingsListSchema),
  findOperatorUser: (email: string) => request(`/api/operator/users?email=${encodeURIComponent(email)}`, operatorUserSchema),
  putFeatureSettings: (userId: string, features: FeatureSettingsRequest["features"]) =>
    request(`/api/operator/feature-settings/${encodeURIComponent(userId)}`, operatorUserSchema, {
      method: "PUT",
      body: JSON.stringify({ features }),
    }),
  resetFeatureSettings: (userId: string) =>
    request(`/api/operator/feature-settings/${encodeURIComponent(userId)}`, operatorUserSchema, { method: "DELETE" }),
  acceptInvite: (token: string, accounts: { id: string; shared: boolean }[]) =>
    request(`/api/invites/${encodeURIComponent(token)}/accept`, inviteAcceptResponseSchema, {
      method: "POST",
      body: JSON.stringify({ accounts }),
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
  // Threads から戻ってきた state と code で、接続を完了する（セキュリティ監査 run-1）。
  // 完了をログイン済みにして、state を作った人と呼び出し元の一致を要求する
  completeConnect: (body: CompleteConnectRequest) =>
    request("/api/threads/complete", completeConnectResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // 名前だけでアカウントを作る・名前を直す（specs/012 contracts/api.md「アカウント」）
  createAccount: (body: CreateAccountRequest) =>
    request("/api/accounts", accountSummarySchema, { method: "POST", body: JSON.stringify(body) }),
  renameAccount: (accountId: string, body: RenameAccountRequest) =>
    request(`/api/accounts/${accountId}`, accountSummarySchema, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAccount: (accountId: string, confirmName: string) =>
    request(`/api/accounts/${accountId}`, null, {
      method: "DELETE",
      body: JSON.stringify({ confirmName }),
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
  getExplainPrompt: (accountId: string, id?: string) =>
    request(
      `/api/accounts/${accountId}/reference-posts/explain-prompt${id ? `?id=${encodeURIComponent(id)}` : ""}`,
      explainPromptSchema,
    ),
  saveExplanations: (accountId: string, body: { items: { id: string; whyGood: string }[] }) =>
    request(`/api/accounts/${accountId}/reference-posts/explanations`, explanationsResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getKeywordIdeaPrompt: (accountId: string) =>
    request(`/api/accounts/${accountId}/research-keywords/idea-prompt`, keywordIdeaPromptSchema),
  createKeywordsBatch: (accountId: string, body: { items: { keyword: string; purpose: string }[] }) =>
    request(`/api/accounts/${accountId}/research-keywords/batch`, keywordBatchResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createReferencePostsBatch: (accountId: string, body: { items: ReferencePostInputBody[] }) =>
    request(`/api/accounts/${accountId}/reference-posts/batch`, referencePostBatchResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createReferencePost: (accountId: string, body: ReferencePostInputBody) =>
    request(`/api/accounts/${accountId}/reference-posts`, referencePostSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateReferencePost: (
    accountId: string,
    id: string,
    body: ReferencePostInputBody & { expectedVersion: number },
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
  putPromptSettings: (accountId: string, postCount: number, expectedVersion: number, length?: PostLengthSettings) =>
    request(`/api/accounts/${accountId}/prompt-settings`, promptSettingsSchema, {
      method: "PUT",
      // 文字数と割合は省略できる（省略なら変えない。specs/014 FR-140）
      body: JSON.stringify(length ? { postCount, length, expectedVersion } : { postCount, expectedVersion }),
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
