// ThreadsのAPIの呼び出し（specs/meguru/029-threads-pattern1 contracts/api-routes.md 4）。道筋は /api/threads/…（Metaに登録した道筋と
// /api/data-deletion は今のまま）。APIの基本のURL・認証のトークン・エラーの扱いは、共通の部品（lib/api-client.ts の request）を使う。
import {
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
import { request } from "@/lib/api-client";

/** POST /post-drafts/:id/prioritize のレスポンス。 */
const postDraftResponseSchema = z.object({ draft: postDraftSchema });

/** 傾向メモ・切り替えの保存の入力（specs/006 contracts/api.md）。 */
type FeedbackRequestInput = { memo?: string | null; includeInPrompt?: boolean; expectedVersion?: number };

/** ThreadsのAPIの呼び出し。レスポンスは共通のスキーマで検証する。 */
export const threadsApi = {  needsReviewCounts: () => request("/api/threads/me/needs-review-counts", needsReviewCountsResponseSchema),
  account: (accountId: string) => request(`/api/threads/accounts/${accountId}`, accountSummarySchema),
  // ---- チーム（specs/011-team-revision contracts/api.md）----
  accountAccess: (accountId: string) => request(`/api/threads/accounts/${accountId}/access`, accountAccessResponseSchema),
  accountTeam: (accountId: string) => request(`/api/threads/accounts/${accountId}/team`, accountTeamSchema),
  listActivity: (accountId: string, q: { kind?: string; actor?: string; cursor?: string }) => {
    const params = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1])));
    const qs = params.toString();
    return request(`/api/threads/accounts/${accountId}/activity${qs ? `?${qs}` : ""}`, activityListSchema);
  },
  dismissAssignedNotice: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/assigned-notice/dismiss`, null, { method: "POST" }),
  createTeam: (body: { name: string; accountIds: string[] }) =>
    request("/api/threads/teams", teamCreateResponseSchema, { method: "POST", body: JSON.stringify(body) }),
  getTeam: (teamId: string) => request(`/api/threads/teams/${teamId}`, teamDetailSchema),
  renameTeam: (teamId: string, name: string) =>
    request(`/api/threads/teams/${teamId}`, null, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteTeam: (teamId: string) => request(`/api/threads/teams/${teamId}`, null, { method: "DELETE" }),
  getTeamInvite: (teamId: string) => request(`/api/threads/teams/${teamId}/invite`, teamInviteSchema),
  // 運用状況（specs/020 contracts/api.md）
  teamStatus: (teamId: string) => request(`/api/threads/teams/${teamId}/status`, teamStatusSchema),
  rotateTeamInvite: (teamId: string) => request(`/api/threads/teams/${teamId}/invite/rotate`, teamInviteSchema, { method: "POST" }),
  setMemberRole: (teamId: string, userId: string, role: "member" | "editor") =>
    request(`/api/threads/teams/${teamId}/members/${userId}`, null, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeMember: (teamId: string, userId: string) => request(`/api/threads/teams/${teamId}/members/${userId}`, null, { method: "DELETE" }),
  dismissJoinedNotice: (teamId: string, userId: string) =>
    request(`/api/threads/teams/${teamId}/members/${userId}/joined-notice/dismiss`, null, { method: "POST" }),
  leaveTeam: (teamId: string, newAdminUserId?: string) =>
    request(`/api/threads/teams/${teamId}/leave`, null, {
      method: "POST",
      body: JSON.stringify(newAdminUserId ? { newAdminUserId } : {}),
    }),
  transferAdmin: (teamId: string, userId: string) =>
    request(`/api/threads/teams/${teamId}/admin`, null, { method: "POST", body: JSON.stringify({ userId }) }),
  addTeamAccount: (teamId: string, accountId: string, shared = false) =>
    request(`/api/threads/teams/${teamId}/accounts`, null, { method: "POST", body: JSON.stringify({ accountId, shared }) }),
  setTeamShared: (teamId: string, accountId: string, shared: boolean) =>
    request(`/api/threads/teams/${teamId}/accounts/${accountId}`, null, { method: "PATCH", body: JSON.stringify({ shared }) }),
  removeTeamAccount: (teamId: string, accountId: string) =>
    request(`/api/threads/teams/${teamId}/accounts/${accountId}`, null, { method: "DELETE" }),
  getAssignments: (teamId: string) => request(`/api/threads/teams/${teamId}/assignments`, teamAssignmentsSchema),
  assign: (teamId: string, userId: string, accountId: string) =>
    request(`/api/threads/teams/${teamId}/assignments/${userId}/accounts/${accountId}`, null, { method: "PUT" }),
  unassign: (teamId: string, userId: string, accountId: string) =>
    request(`/api/threads/teams/${teamId}/assignments/${userId}/accounts/${accountId}`, null, { method: "DELETE" }),
  previewInvite: (token: string) => request(`/api/threads/invites/${encodeURIComponent(token)}`, invitePreviewSchema),
  // テスター招待（specs/024 contracts/api.md「利用者の申し込み」「運営者の招待の管理」）
  testerApplication: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/tester-application`, testerApplicationResponseSchema),
  applyTester: (accountId: string, threadsUsername: string) =>
    request(`/api/threads/accounts/${accountId}/tester-application`, testerApplicationSchema, {
      method: "POST",
      body: JSON.stringify({ threadsUsername }),
    }),
  cancelTesterApplication: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/tester-application`, null, { method: "DELETE" }),
  // 違うアカウントでつながった知らせ（specs/025 contracts/api.md）
  connectionNotice: (accountId: string) => request(`/api/threads/accounts/${accountId}/connection-notice`, connectionNoticeSchema),
  dismissConnectionNotice: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/connection-notice/dismiss`, null, { method: "POST" }),
  // 運営者のアカウント一覧（specs/026-operator-accounts contracts/api.md）
  operatorAccounts: ({ method, q, cursor }: { method: string; q: string; cursor?: string }) => {
    const params = new URLSearchParams({ method });
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    return request(`/api/threads/operator/accounts?${params.toString()}`, operatorAccountsSchema);
  },
  operatorTesterApplications: (view: string) =>
    request(`/api/threads/operator/tester-applications?view=${encodeURIComponent(view)}`, operatorTesterApplicationsSchema),
  operateTesterApplication: (id: string, action: "invite" | "decline" | "revert" | "removed", body: { force?: boolean; reason?: string } = {}) =>
    request(`/api/threads/operator/tester-applications/${encodeURIComponent(id)}/${action}`, operatorTesterApplicationSchema.nullable(), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  setTesterSlotCapacity: (slotCapacity: number) =>
    request("/api/threads/operator/tester-settings", z.object({ used: z.number(), capacity: z.number() }), {
      method: "PUT",
      body: JSON.stringify({ slotCapacity }),
    }),
  acceptInvite: (token: string, accounts: { id: string; shared: boolean }[]) =>
    request(`/api/threads/invites/${encodeURIComponent(token)}/accept`, inviteAcceptResponseSchema, {
      method: "POST",
      body: JSON.stringify({ accounts }),
    }),
  openAccount: (accountId: string, body: OpenAccountRequest, signal?: AbortSignal) =>
    request(`/api/threads/accounts/${accountId}/open`, accountSummarySchema, {
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
    request("/api/threads/accounts", accountSummarySchema, { method: "POST", body: JSON.stringify(body) }),
  renameAccount: (accountId: string, body: RenameAccountRequest) =>
    request(`/api/threads/accounts/${accountId}`, accountSummarySchema, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAccount: (accountId: string, confirmName: string) =>
    request(`/api/threads/accounts/${accountId}`, null, {
      method: "DELETE",
      body: JSON.stringify({ confirmName }),
    }),
  // ---- 戦略プロファイル（specs/002-strategy-profile contracts/api.md）----
  getProfileStatus: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/profile-status`, profileStatusSchema),
  getStrategy: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/strategy`, strategySchema),
  putStrategy: (accountId: string, body: PutStrategyRequest) =>
    request(`/api/threads/accounts/${accountId}/strategy`, strategySchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  listPromotions: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/promotions`, promotionListSchema),
  createPromotion: (accountId: string, body: PromotionInput) =>
    request(`/api/threads/accounts/${accountId}/promotions`, promotionSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePromotion: (
    accountId: string,
    id: string,
    body: PromotionInput & { expectedVersion: number },
  ) =>
    request(`/api/threads/accounts/${accountId}/promotions/${id}`, promotionSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deletePromotion: (accountId: string, id: string) =>
    request(`/api/threads/accounts/${accountId}/promotions/${id}`, null, { method: "DELETE" }),
  // 時間差のメンション（specs/023 contracts/api.md）
  mentionSettings: (accountId: string) => request(`/api/threads/accounts/${accountId}/mention-settings`, mentionSettingsSchema),
  putMentionSettings: (accountId: string, body: { expectedVersion: number | null; message: string; delayMinutes: number }) =>
    request(`/api/threads/accounts/${accountId}/mention-settings`, mentionSettingsSchema, { method: "PUT", body: JSON.stringify(body) }),
  addMentionPerson: (accountId: string, body: { username: string; label: string; always?: boolean }) =>
    request(`/api/threads/accounts/${accountId}/mention-people`, mentionSettingsSchema, { method: "POST", body: JSON.stringify(body) }),
  patchMentionPerson: (accountId: string, personId: string, body: { label?: string; always?: boolean }) =>
    request(`/api/threads/accounts/${accountId}/mention-people/${personId}`, mentionSettingsSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMentionPerson: (accountId: string, personId: string) =>
    request(`/api/threads/accounts/${accountId}/mention-people/${personId}`, mentionSettingsSchema, { method: "DELETE" }),
  attachMention: (accountId: string, draftId: string, body: MentionAttachRequest) =>
    request(`/api/threads/accounts/${accountId}/post-drafts/${draftId}/mention`, mentionAttachResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  attachMentionsBulk: (accountId: string, items: { id: string; expectedVersion: number }[]) =>
    request(`/api/threads/accounts/${accountId}/post-drafts/mentions`, mentionBulkResponseSchema, {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  detachMention: (accountId: string, draftId: string, expectedVersion?: number) =>
    request(`/api/threads/accounts/${accountId}/post-drafts/${draftId}/mention`, mentionAttachResponseSchema.pick({ draft: true }), {
      method: "DELETE",
      body: JSON.stringify(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  // アルゴリズムの解析（specs/022 contracts/api.md）
  analysis: (accountId: string, scope: AnalysisScope) =>
    request(`/api/threads/accounts/${accountId}/analysis?scope=${scope}`, analysisResponseSchema),
  patchAnalysisSettings: (accountId: string, body: AnalysisSettingsRequest) =>
    request(`/api/threads/accounts/${accountId}/analysis/settings`, analysisSettingsResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  classifications: (accountId: string, mode: "unclassified" | "classified") =>
    request(`/api/threads/accounts/${accountId}/analysis/classifications?mode=${mode}`, classificationsResponseSchema),
  putClassifications: (accountId: string, body: ClassificationsRequest) =>
    request(`/api/threads/accounts/${accountId}/analysis/classifications`, classificationsSaveResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // 外部媒体展開（specs/021 contracts/api.md）
  externalMedia: (accountId: string) => request(`/api/threads/accounts/${accountId}/external-media`, externalMediaListSchema),
  listing: (accountId: string, promotionId: string, media: Media) =>
    request(`/api/threads/accounts/${accountId}/external-media/${promotionId}/${media}`, listingDetailSchema),
  generateListing: (accountId: string, promotionId: string, media: Media, expectedVersion: number | null) =>
    request(`/api/threads/accounts/${accountId}/external-media/${promotionId}/${media}/generate`, listingDetailSchema, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    }),
  updateListing: (accountId: string, promotionId: string, media: Media, body: ListingUpdateRequest) =>
    request(`/api/threads/accounts/${accountId}/external-media/${promotionId}/${media}`, listingDetailSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  mediaDefaults: (accountId: string) => request(`/api/threads/accounts/${accountId}/media-defaults`, mediaDefaultsListSchema),
  putMediaDefaults: (accountId: string, media: Media, expectedVersion: number | null, values: Record<string, string>) =>
    request(`/api/threads/accounts/${accountId}/media-defaults/${media}`, mediaDefaultsSchema, {
      method: "PUT",
      body: JSON.stringify({ expectedVersion, values }),
    }),
  getPromotionSettings: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/promotion-settings`, promotionSettingsSchema),
  putPromotionSettings: (accountId: string, ratioPercent: number, expectedVersion: number) =>
    request(`/api/threads/accounts/${accountId}/promotion-settings`, promotionSettingsSchema, {
      method: "PUT",
      body: JSON.stringify({ ratioPercent, expectedVersion }),
    }),
  listReferencePosts: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/reference-posts`, referencePostListSchema),
  getExplainPrompt: (accountId: string, id?: string) =>
    request(
      `/api/threads/accounts/${accountId}/reference-posts/explain-prompt${id ? `?id=${encodeURIComponent(id)}` : ""}`,
      explainPromptSchema,
    ),
  saveExplanations: (accountId: string, body: { items: { id: string; whyGood: string }[] }) =>
    request(`/api/threads/accounts/${accountId}/reference-posts/explanations`, explanationsResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getKeywordIdeaPrompt: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/research-keywords/idea-prompt`, keywordIdeaPromptSchema),
  createKeywordsBatch: (accountId: string, body: { items: { keyword: string; purpose: string }[] }) =>
    request(`/api/threads/accounts/${accountId}/research-keywords/batch`, keywordBatchResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createReferencePostsBatch: (accountId: string, body: { items: ReferencePostInputBody[] }) =>
    request(`/api/threads/accounts/${accountId}/reference-posts/batch`, referencePostBatchResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createReferencePost: (accountId: string, body: ReferencePostInputBody) =>
    request(`/api/threads/accounts/${accountId}/reference-posts`, referencePostSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateReferencePost: (
    accountId: string,
    id: string,
    body: ReferencePostInputBody & { expectedVersion: number },
  ) =>
    request(`/api/threads/accounts/${accountId}/reference-posts/${id}`, referencePostSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteReferencePost: (accountId: string, id: string) =>
    request(`/api/threads/accounts/${accountId}/reference-posts/${id}`, null, { method: "DELETE" }),
  listResearchKeywords: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/research-keywords`, researchKeywordListSchema),
  createResearchKeyword: (accountId: string, body: ResearchKeywordInput) =>
    request(`/api/threads/accounts/${accountId}/research-keywords`, researchKeywordSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateResearchKeyword: (
    accountId: string,
    id: string,
    body: ResearchKeywordInput & { expectedVersion: number },
  ) =>
    request(`/api/threads/accounts/${accountId}/research-keywords/${id}`, researchKeywordSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteResearchKeyword: (accountId: string, id: string) =>
    request(`/api/threads/accounts/${accountId}/research-keywords/${id}`, null, { method: "DELETE" }),
  // ---- 投稿ストック（specs/003-prompt-bulk-register contracts/api.md）----
  getPrompt: (accountId: string, count?: number) =>
    request(
      `/api/threads/accounts/${accountId}/prompt${count === undefined ? "" : `?count=${count}`}`,
      promptResponseSchema,
    ),
  putPromptSettings: (accountId: string, postCount: number, expectedVersion: number, length?: PostLengthSettings) =>
    request(`/api/threads/accounts/${accountId}/prompt-settings`, promptSettingsSchema, {
      method: "PUT",
      // 文字数と割合は省略できる（省略なら変えない。specs/014 FR-140）
      body: JSON.stringify(length ? { postCount, length, expectedVersion } : { postCount, expectedVersion }),
    }),
  listPostDrafts: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/post-drafts`, postDraftListSchema),
  createDraftBatch: (accountId: string, body: { clientRequestId: string; text: string }) =>
    request(`/api/threads/accounts/${accountId}/draft-batches`, draftBatchResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteDraftBatch: (accountId: string, batchId: string) =>
    request(`/api/threads/accounts/${accountId}/draft-batches/${batchId}`, deleteCountSchema, {
      method: "DELETE",
    }),
  updatePostDraft: (
    accountId: string,
    id: string,
    body: { body: string; expectedVersion: number },
  ) =>
    request(`/api/threads/accounts/${accountId}/post-drafts/${id}`, updatePostDraftResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deletePostDrafts: (accountId: string, ids: string[]) =>
    request(`/api/threads/accounts/${accountId}/post-drafts/delete`, deleteCountSchema, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  // ---- 承認・却下・投稿のルール（specs/004-review-approval contracts/api.md）----
  getDraftCounts: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/post-drafts/counts`, draftCountsSchema),
  reviewPostDrafts: (accountId: string, body: ReviewRequest) =>
    request(`/api/threads/accounts/${accountId}/post-drafts/review`, reviewResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getPostingRules: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/posting-rules`, postingRulesSchema),
  addNgWords: (accountId: string, words: string[]) =>
    request(`/api/threads/accounts/${accountId}/ng-words`, addNgWordsResponseSchema, {
      method: "POST",
      body: JSON.stringify({ words }),
    }),
  deleteNgWord: (accountId: string, id: string) =>
    request(`/api/threads/accounts/${accountId}/ng-words/${id}`, null, { method: "DELETE" }),
  putCoreRules: (accountId: string, body: { text: string; expectedVersion: number }) =>
    request(`/api/threads/accounts/${accountId}/core-rules`, coreRulesResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // ---- 自動投稿（specs/005-auto-post contracts/api.md）----
  getPostingSchedule: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/posting-schedule`, postingScheduleResponseSchema),
  putPostingSchedule: (accountId: string, body: PutPostingScheduleRequest) =>
    request(`/api/threads/accounts/${accountId}/posting-schedule`, putPostingScheduleResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  checkThreads: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/threads-check`, threadsCheckSchema, { method: "POST" }),
  getAutoPost: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/auto-post`, autoPostStatusSchema),
  dismissBlockedNotice: (accountId: string) =>
    request(`/api/threads/accounts/${accountId}/auto-post/notices/blocked/dismiss`, null, {
      method: "POST",
    }),
  getPerformance: (accountId: string, tab: PerformanceTab, before?: string) => {
    const q = new URLSearchParams({ tab });
    if (before) q.set("before", before);
    return request(`/api/threads/accounts/${accountId}/performance?${q}`, performancePageSchema);
  },
  updateFeedback: (accountId: string, draftId: string, body: FeedbackRequestInput) =>
    request(`/api/threads/accounts/${accountId}/performance/${draftId}/feedback`, feedbackResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  exportPerformance: (accountId: string, kind: "posts" | "snapshots", before?: string) => {
    const q = new URLSearchParams({ kind });
    if (before) q.set("before", before);
    return request(`/api/threads/accounts/${accountId}/performance/export?${q}`, exportPageSchema);
  },
  listPublished: (accountId: string, before?: string) =>
    request(
      `/api/threads/accounts/${accountId}/post-drafts/published${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      publishedPageSchema,
    ),
  prioritizeDraft: (accountId: string, id: string, expectedVersion: number) =>
    request(`/api/threads/accounts/${accountId}/post-drafts/${id}/prioritize`, postDraftResponseSchema, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    }),
  dataDeletionStatus: (code: string) =>
    request(`/api/data-deletion/${encodeURIComponent(code)}`, dataDeletionStatusSchema, {
      auth: false,
    }),

};
