// ThreadsのAPIの呼び出し（specs/meguru/029-threads-pattern1 contracts/api-routes.md 4）。道筋は /api/threads/…（Metaに登録した道筋と
// /api/data-deletion は今のまま）。APIの基本のURL・認証のトークン・エラーの扱いは、共通の部品（lib/api-client.ts の request）を使う。
import {
  threadsMeResponseSchema,
  accountAccessResponseSchema,
  accountTeamSchema,
  inviteAcceptResponseSchema,
  invitePreviewSchema,
  operatorTesterApplicationSchema,
  operatorTesterApplicationsSchema,
  operatorAccountsSchema,
  testerApplicationResponseSchema,
  connectionNoticeSchema,
  testerApplicationSchema,
  activityListSchema,
  teamAssignmentsSchema,
  teamCreateResponseSchema,
  teamDetailSchema,
  teamStatusSchema,
  externalMediaListSchema,
  analysisResponseSchema,
  mentionAttachResponseSchema,
  mentionBulkResponseSchema,
  mentionSettingsSchema,
  analysisSettingsResponseSchema,
  classificationsResponseSchema,
  classificationsSaveResponseSchema,
  listingDetailSchema,
  mediaDefaultsListSchema,
  mediaDefaultsSchema,
  type ListingUpdateRequest,
  type AnalysisScope,
  type MentionAttachRequest,
  type AnalysisSettingsRequest,
  type ClassificationsRequest,
  type Media,
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
  type OpenAccountRequest,
  type CreateAccountRequest,
  type RenameAccountRequest,
} from "@meguru/shared";
import { z } from "zod";
import { ApiError, request } from "@/lib/api-client";

/** POST /post-drafts/:id/prioritize のレスポンス。 */
const postDraftResponseSchema = z.object({ draft: postDraftSchema });

/** 傾向メモ・切り替えの保存の入力（specs/006 contracts/api.md）。 */
type FeedbackRequestInput = { memo?: string | null; includeInPrompt?: boolean; expectedVersion?: number };

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

const ACCOUNT_PATH = /^\/api\/threads\/accounts\/([0-9a-f-]{36})(?:\/|$)/i;

/**
 * ThreadsのAPIを呼ぶ（共通の request に、Accountの権限・存在のエラーの知らせを足す。共通の部品は道筋の形を知らない）。
 * @param path - /api/threads から始まる道筋
 * @param schema - レスポンスのスキーマ（中身がなければ null）
 * @param init - fetch の設定
 * @returns 検証したレスポンス
 */
function call<T>(path: string, schema: z.ZodType<T> | null, init: Parameters<typeof request>[2] = {}): Promise<T> {
  const accountId = ACCOUNT_PATH.exec(path)?.[1];
  return request(path, schema, {
    ...init,
    onError: (err: ApiError) => {
      if (accountId && (err.code === "ROLE_FORBIDDEN" || err.code === "ACCOUNT_NOT_FOUND")) onAccountAccessError?.(err.code, accountId);
    },
  });
}

/** ThreadsのAPIの呼び出し。レスポンスは共通のスキーマで検証する。 */
export const threadsApi = {
  // Threadsの「自分」（アカウント・チーム・使える機能など。specs/meguru/029 contracts/api-routes.md 2）
  me: () => call("/api/threads/me", threadsMeResponseSchema),
  needsReviewCounts: () => call("/api/threads/me/needs-review-counts", needsReviewCountsResponseSchema),
  account: (accountId: string) => call(`/api/threads/accounts/${accountId}`, accountSummarySchema),
  // ---- チーム（specs/011-team-revision contracts/api.md）----
  accountAccess: (accountId: string) => call(`/api/threads/accounts/${accountId}/access`, accountAccessResponseSchema),
  accountTeam: (accountId: string) => call(`/api/threads/accounts/${accountId}/team`, accountTeamSchema),
  listActivity: (accountId: string, q: { kind?: string; actor?: string; cursor?: string }) => {
    const params = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1])));
    const qs = params.toString();
    return call(`/api/threads/accounts/${accountId}/activity${qs ? `?${qs}` : ""}`, activityListSchema);
  },
  dismissAssignedNotice: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/assigned-notice/dismiss`, null, { method: "POST" }),
  createTeam: (body: { name: string; accountIds: string[] }) =>
    call("/api/threads/teams", teamCreateResponseSchema, { method: "POST", body: JSON.stringify(body) }),
  getTeam: (teamId: string) => call(`/api/threads/teams/${teamId}`, teamDetailSchema),
  renameTeam: (teamId: string, name: string) =>
    call(`/api/threads/teams/${teamId}`, null, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteTeam: (teamId: string) => call(`/api/threads/teams/${teamId}`, null, { method: "DELETE" }),
  getTeamInvite: (teamId: string) => call(`/api/threads/teams/${teamId}/invite`, teamInviteSchema),
  // 運用状況（specs/020 contracts/api.md）
  teamStatus: (teamId: string) => call(`/api/threads/teams/${teamId}/status`, teamStatusSchema),
  rotateTeamInvite: (teamId: string) => call(`/api/threads/teams/${teamId}/invite/rotate`, teamInviteSchema, { method: "POST" }),
  setMemberRole: (teamId: string, userId: string, role: "member" | "editor") =>
    call(`/api/threads/teams/${teamId}/members/${userId}`, null, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeMember: (teamId: string, userId: string) => call(`/api/threads/teams/${teamId}/members/${userId}`, null, { method: "DELETE" }),
  dismissJoinedNotice: (teamId: string, userId: string) =>
    call(`/api/threads/teams/${teamId}/members/${userId}/joined-notice/dismiss`, null, { method: "POST" }),
  leaveTeam: (teamId: string, newAdminUserId?: string) =>
    call(`/api/threads/teams/${teamId}/leave`, null, {
      method: "POST",
      body: JSON.stringify(newAdminUserId ? { newAdminUserId } : {}),
    }),
  transferAdmin: (teamId: string, userId: string) =>
    call(`/api/threads/teams/${teamId}/admin`, null, { method: "POST", body: JSON.stringify({ userId }) }),
  addTeamAccount: (teamId: string, accountId: string, shared = false) =>
    call(`/api/threads/teams/${teamId}/accounts`, null, { method: "POST", body: JSON.stringify({ accountId, shared }) }),
  setTeamShared: (teamId: string, accountId: string, shared: boolean) =>
    call(`/api/threads/teams/${teamId}/accounts/${accountId}`, null, { method: "PATCH", body: JSON.stringify({ shared }) }),
  removeTeamAccount: (teamId: string, accountId: string) =>
    call(`/api/threads/teams/${teamId}/accounts/${accountId}`, null, { method: "DELETE" }),
  getAssignments: (teamId: string) => call(`/api/threads/teams/${teamId}/assignments`, teamAssignmentsSchema),
  assign: (teamId: string, userId: string, accountId: string) =>
    call(`/api/threads/teams/${teamId}/assignments/${userId}/accounts/${accountId}`, null, { method: "PUT" }),
  unassign: (teamId: string, userId: string, accountId: string) =>
    call(`/api/threads/teams/${teamId}/assignments/${userId}/accounts/${accountId}`, null, { method: "DELETE" }),
  previewInvite: (token: string) => call(`/api/threads/invites/${encodeURIComponent(token)}`, invitePreviewSchema),
  // テスター招待（specs/024 contracts/api.md「利用者の申し込み」「運営者の招待の管理」）
  testerApplication: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/tester-application`, testerApplicationResponseSchema),
  applyTester: (accountId: string, threadsUsername: string) =>
    call(`/api/threads/accounts/${accountId}/tester-application`, testerApplicationSchema, {
      method: "POST",
      body: JSON.stringify({ threadsUsername }),
    }),
  cancelTesterApplication: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/tester-application`, null, { method: "DELETE" }),
  // 違うアカウントでつながった知らせ（specs/025 contracts/api.md）
  connectionNotice: (accountId: string) => call(`/api/threads/accounts/${accountId}/connection-notice`, connectionNoticeSchema),
  dismissConnectionNotice: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/connection-notice/dismiss`, null, { method: "POST" }),
  // 運営者のアカウント一覧（specs/026-operator-accounts contracts/api.md）
  operatorAccounts: ({ method, q, cursor }: { method: string; q: string; cursor?: string }) => {
    const params = new URLSearchParams({ method });
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    return call(`/api/threads/operator/accounts?${params.toString()}`, operatorAccountsSchema);
  },
  operatorTesterApplications: (view: string) =>
    call(`/api/threads/operator/tester-applications?view=${encodeURIComponent(view)}`, operatorTesterApplicationsSchema),
  operateTesterApplication: (id: string, action: "invite" | "decline" | "revert" | "removed", body: { force?: boolean; reason?: string } = {}) =>
    call(`/api/threads/operator/tester-applications/${encodeURIComponent(id)}/${action}`, operatorTesterApplicationSchema.nullable(), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  setTesterSlotCapacity: (slotCapacity: number) =>
    call("/api/threads/operator/tester-settings", z.object({ used: z.number(), capacity: z.number() }), {
      method: "PUT",
      body: JSON.stringify({ slotCapacity }),
    }),
  acceptInvite: (token: string, accounts: { id: string; shared: boolean }[]) =>
    call(`/api/threads/invites/${encodeURIComponent(token)}/accept`, inviteAcceptResponseSchema, {
      method: "POST",
      body: JSON.stringify({ accounts }),
    }),
  openAccount: (accountId: string, body: OpenAccountRequest, signal?: AbortSignal) =>
    call(`/api/threads/accounts/${accountId}/open`, accountSummarySchema, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  // 自分のMetaアプリのトークンで追加・接続し直す（specs/010 contracts/api.md）
  tokenConnect: (body: TokenConnectRequestBody) =>
    call("/api/threads/token-connect", tokenConnectResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  connect: (body: ConnectRequest) =>
    call("/api/threads/connect", connectResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Threads から戻ってきた state と code で、接続を完了する（セキュリティ監査 run-1）。
  // 完了をログイン済みにして、state を作った人と呼び出し元の一致を要求する
  completeConnect: (body: CompleteConnectRequest) =>
    call("/api/threads/complete", completeConnectResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // 名前だけでアカウントを作る・名前を直す（specs/012 contracts/api.md「アカウント」）
  createAccount: (body: CreateAccountRequest) =>
    call("/api/threads/accounts", accountSummarySchema, { method: "POST", body: JSON.stringify(body) }),
  renameAccount: (accountId: string, body: RenameAccountRequest) =>
    call(`/api/threads/accounts/${accountId}`, accountSummarySchema, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAccount: (accountId: string, confirmName: string) =>
    call(`/api/threads/accounts/${accountId}`, null, {
      method: "DELETE",
      body: JSON.stringify({ confirmName }),
    }),
  // ---- 戦略プロファイル（specs/002-strategy-profile contracts/api.md）----
  getProfileStatus: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/profile-status`, profileStatusSchema),
  getStrategy: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/strategy`, strategySchema),
  putStrategy: (accountId: string, body: PutStrategyRequest) =>
    call(`/api/threads/accounts/${accountId}/strategy`, strategySchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  listPromotions: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/promotions`, promotionListSchema),
  createPromotion: (accountId: string, body: PromotionInput) =>
    call(`/api/threads/accounts/${accountId}/promotions`, promotionSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePromotion: (
    accountId: string,
    id: string,
    body: PromotionInput & { expectedVersion: number },
  ) =>
    call(`/api/threads/accounts/${accountId}/promotions/${id}`, promotionSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deletePromotion: (accountId: string, id: string) =>
    call(`/api/threads/accounts/${accountId}/promotions/${id}`, null, { method: "DELETE" }),
  // 時間差のメンション（specs/023 contracts/api.md）
  mentionSettings: (accountId: string) => call(`/api/threads/accounts/${accountId}/mention-settings`, mentionSettingsSchema),
  putMentionSettings: (accountId: string, body: { expectedVersion: number | null; message: string; delayMinutes: number }) =>
    call(`/api/threads/accounts/${accountId}/mention-settings`, mentionSettingsSchema, { method: "PUT", body: JSON.stringify(body) }),
  addMentionPerson: (accountId: string, body: { username: string; label: string; always?: boolean }) =>
    call(`/api/threads/accounts/${accountId}/mention-people`, mentionSettingsSchema, { method: "POST", body: JSON.stringify(body) }),
  patchMentionPerson: (accountId: string, personId: string, body: { label?: string; always?: boolean }) =>
    call(`/api/threads/accounts/${accountId}/mention-people/${personId}`, mentionSettingsSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMentionPerson: (accountId: string, personId: string) =>
    call(`/api/threads/accounts/${accountId}/mention-people/${personId}`, mentionSettingsSchema, { method: "DELETE" }),
  attachMention: (accountId: string, draftId: string, body: MentionAttachRequest) =>
    call(`/api/threads/accounts/${accountId}/post-drafts/${draftId}/mention`, mentionAttachResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  attachMentionsBulk: (accountId: string, items: { id: string; expectedVersion: number }[]) =>
    call(`/api/threads/accounts/${accountId}/post-drafts/mentions`, mentionBulkResponseSchema, {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  detachMention: (accountId: string, draftId: string, expectedVersion?: number) =>
    call(`/api/threads/accounts/${accountId}/post-drafts/${draftId}/mention`, mentionAttachResponseSchema.pick({ draft: true }), {
      method: "DELETE",
      body: JSON.stringify(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  // アルゴリズムの解析（specs/022 contracts/api.md）
  analysis: (accountId: string, scope: AnalysisScope) =>
    call(`/api/threads/accounts/${accountId}/analysis?scope=${scope}`, analysisResponseSchema),
  patchAnalysisSettings: (accountId: string, body: AnalysisSettingsRequest) =>
    call(`/api/threads/accounts/${accountId}/analysis/settings`, analysisSettingsResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  classifications: (accountId: string, mode: "unclassified" | "classified") =>
    call(`/api/threads/accounts/${accountId}/analysis/classifications?mode=${mode}`, classificationsResponseSchema),
  putClassifications: (accountId: string, body: ClassificationsRequest) =>
    call(`/api/threads/accounts/${accountId}/analysis/classifications`, classificationsSaveResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // 外部媒体展開（specs/021 contracts/api.md）
  externalMedia: (accountId: string) => call(`/api/threads/accounts/${accountId}/external-media`, externalMediaListSchema),
  listing: (accountId: string, promotionId: string, media: Media) =>
    call(`/api/threads/accounts/${accountId}/external-media/${promotionId}/${media}`, listingDetailSchema),
  generateListing: (accountId: string, promotionId: string, media: Media, expectedVersion: number | null) =>
    call(`/api/threads/accounts/${accountId}/external-media/${promotionId}/${media}/generate`, listingDetailSchema, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    }),
  updateListing: (accountId: string, promotionId: string, media: Media, body: ListingUpdateRequest) =>
    call(`/api/threads/accounts/${accountId}/external-media/${promotionId}/${media}`, listingDetailSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  mediaDefaults: (accountId: string) => call(`/api/threads/accounts/${accountId}/media-defaults`, mediaDefaultsListSchema),
  putMediaDefaults: (accountId: string, media: Media, expectedVersion: number | null, values: Record<string, string>) =>
    call(`/api/threads/accounts/${accountId}/media-defaults/${media}`, mediaDefaultsSchema, {
      method: "PUT",
      body: JSON.stringify({ expectedVersion, values }),
    }),
  getPromotionSettings: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/promotion-settings`, promotionSettingsSchema),
  putPromotionSettings: (accountId: string, ratioPercent: number, expectedVersion: number) =>
    call(`/api/threads/accounts/${accountId}/promotion-settings`, promotionSettingsSchema, {
      method: "PUT",
      body: JSON.stringify({ ratioPercent, expectedVersion }),
    }),
  listReferencePosts: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/reference-posts`, referencePostListSchema),
  getExplainPrompt: (accountId: string, id?: string) =>
    call(
      `/api/threads/accounts/${accountId}/reference-posts/explain-prompt${id ? `?id=${encodeURIComponent(id)}` : ""}`,
      explainPromptSchema,
    ),
  saveExplanations: (accountId: string, body: { items: { id: string; whyGood: string }[] }) =>
    call(`/api/threads/accounts/${accountId}/reference-posts/explanations`, explanationsResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getKeywordIdeaPrompt: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/research-keywords/idea-prompt`, keywordIdeaPromptSchema),
  createKeywordsBatch: (accountId: string, body: { items: { keyword: string; purpose: string }[] }) =>
    call(`/api/threads/accounts/${accountId}/research-keywords/batch`, keywordBatchResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createReferencePostsBatch: (accountId: string, body: { items: ReferencePostInputBody[] }) =>
    call(`/api/threads/accounts/${accountId}/reference-posts/batch`, referencePostBatchResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createReferencePost: (accountId: string, body: ReferencePostInputBody) =>
    call(`/api/threads/accounts/${accountId}/reference-posts`, referencePostSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateReferencePost: (
    accountId: string,
    id: string,
    body: ReferencePostInputBody & { expectedVersion: number },
  ) =>
    call(`/api/threads/accounts/${accountId}/reference-posts/${id}`, referencePostSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteReferencePost: (accountId: string, id: string) =>
    call(`/api/threads/accounts/${accountId}/reference-posts/${id}`, null, { method: "DELETE" }),
  listResearchKeywords: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/research-keywords`, researchKeywordListSchema),
  createResearchKeyword: (accountId: string, body: ResearchKeywordInput) =>
    call(`/api/threads/accounts/${accountId}/research-keywords`, researchKeywordSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateResearchKeyword: (
    accountId: string,
    id: string,
    body: ResearchKeywordInput & { expectedVersion: number },
  ) =>
    call(`/api/threads/accounts/${accountId}/research-keywords/${id}`, researchKeywordSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteResearchKeyword: (accountId: string, id: string) =>
    call(`/api/threads/accounts/${accountId}/research-keywords/${id}`, null, { method: "DELETE" }),
  // ---- 投稿ストック（specs/003-prompt-bulk-register contracts/api.md）----
  getPrompt: (accountId: string, count?: number) =>
    call(
      `/api/threads/accounts/${accountId}/prompt${count === undefined ? "" : `?count=${count}`}`,
      promptResponseSchema,
    ),
  putPromptSettings: (accountId: string, postCount: number, expectedVersion: number, length?: PostLengthSettings) =>
    call(`/api/threads/accounts/${accountId}/prompt-settings`, promptSettingsSchema, {
      method: "PUT",
      // 文字数と割合は省略できる（省略なら変えない。specs/014 FR-140）
      body: JSON.stringify(length ? { postCount, length, expectedVersion } : { postCount, expectedVersion }),
    }),
  listPostDrafts: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/post-drafts`, postDraftListSchema),
  createDraftBatch: (accountId: string, body: { clientRequestId: string; text: string }) =>
    call(`/api/threads/accounts/${accountId}/draft-batches`, draftBatchResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteDraftBatch: (accountId: string, batchId: string) =>
    call(`/api/threads/accounts/${accountId}/draft-batches/${batchId}`, deleteCountSchema, {
      method: "DELETE",
    }),
  updatePostDraft: (
    accountId: string,
    id: string,
    body: { body: string; expectedVersion: number },
  ) =>
    call(`/api/threads/accounts/${accountId}/post-drafts/${id}`, updatePostDraftResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deletePostDrafts: (accountId: string, ids: string[]) =>
    call(`/api/threads/accounts/${accountId}/post-drafts/delete`, deleteCountSchema, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  // ---- 承認・却下・投稿のルール（specs/004-review-approval contracts/api.md）----
  getDraftCounts: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/post-drafts/counts`, draftCountsSchema),
  reviewPostDrafts: (accountId: string, body: ReviewRequest) =>
    call(`/api/threads/accounts/${accountId}/post-drafts/review`, reviewResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getPostingRules: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/posting-rules`, postingRulesSchema),
  addNgWords: (accountId: string, words: string[]) =>
    call(`/api/threads/accounts/${accountId}/ng-words`, addNgWordsResponseSchema, {
      method: "POST",
      body: JSON.stringify({ words }),
    }),
  deleteNgWord: (accountId: string, id: string) =>
    call(`/api/threads/accounts/${accountId}/ng-words/${id}`, null, { method: "DELETE" }),
  putCoreRules: (accountId: string, body: { text: string; expectedVersion: number }) =>
    call(`/api/threads/accounts/${accountId}/core-rules`, coreRulesResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // ---- 自動投稿（specs/005-auto-post contracts/api.md）----
  getPostingSchedule: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/posting-schedule`, postingScheduleResponseSchema),
  putPostingSchedule: (accountId: string, body: PutPostingScheduleRequest) =>
    call(`/api/threads/accounts/${accountId}/posting-schedule`, putPostingScheduleResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  checkThreads: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/threads-check`, threadsCheckSchema, { method: "POST" }),
  getAutoPost: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/auto-post`, autoPostStatusSchema),
  dismissBlockedNotice: (accountId: string) =>
    call(`/api/threads/accounts/${accountId}/auto-post/notices/blocked/dismiss`, null, {
      method: "POST",
    }),
  getPerformance: (accountId: string, tab: PerformanceTab, before?: string) => {
    const q = new URLSearchParams({ tab });
    if (before) q.set("before", before);
    return call(`/api/threads/accounts/${accountId}/performance?${q}`, performancePageSchema);
  },
  updateFeedback: (accountId: string, draftId: string, body: FeedbackRequestInput) =>
    call(`/api/threads/accounts/${accountId}/performance/${draftId}/feedback`, feedbackResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  exportPerformance: (accountId: string, kind: "posts" | "snapshots", before?: string) => {
    const q = new URLSearchParams({ kind });
    if (before) q.set("before", before);
    return call(`/api/threads/accounts/${accountId}/performance/export?${q}`, exportPageSchema);
  },
  listPublished: (accountId: string, before?: string) =>
    call(
      `/api/threads/accounts/${accountId}/post-drafts/published${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      publishedPageSchema,
    ),
  prioritizeDraft: (accountId: string, id: string, expectedVersion: number) =>
    call(`/api/threads/accounts/${accountId}/post-drafts/${id}/prioritize`, postDraftResponseSchema, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    }),
  dataDeletionStatus: (code: string) =>
    call(`/api/data-deletion/${encodeURIComponent(code)}`, dataDeletionStatusSchema, {
      auth: false,
    }),
};
