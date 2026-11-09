import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";

/** TanStack Query のクライアント。認証・権限・存在しない・設定の誤りは再試行しない。 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 認証・権限・存在しないエラーは再試行しない
      // 認証・権限・存在しない・設定の誤りは、再試行しても直らないので再試行しない
      retry: (failureCount, error) =>
        !(
          error instanceof ApiError &&
          ([401, 403, 404, 409, 422].includes(error.status) || error.code === "CONFIG_ERROR")
        ) && failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** TanStack Query のキー。 */
export const queryKeys = {
  me: ["me"] as const,
  // 契約と支払い（specs/013）
  billing: ["billing"] as const,
  withdrawalPreview: ["me", "withdrawal-preview"] as const,
  needsReviewCounts: ["me", "needs-review-counts"] as const,
  account: (id: string) => ["account", id] as const,
  // 関わりと権限（specs/011-team-revision）。Account の下に置き、Account の削除で一緒に消す
  access: (id: string) => ["account", id, "access"] as const,
  accountTeam: (id: string) => ["account", id, "team"] as const,
  activity: (id: string, kind: string, actor: string) => ["account", id, "activity", kind, actor] as const,
  invite: (token: string) => ["invite", token] as const,
  // テスト用のグループ（specs/016）
  testInvite: (token: string) => ["test-invite", token] as const,
  testGroups: ["test-groups"] as const,
  referral: ["referral"] as const,
  referralPage: ["referral-page"] as const,
  testGroup: (id: string) => ["test-groups", id] as const,
  // 機能のまとまりごとのON/OFF（specs/019）
  featureSettings: ["feature-settings"] as const,
  // テスター招待・上限（specs/024）。申し込みは Account の下に置き、Account の削除で一緒に消す
  testerApplication: (id: string) => ["account", id, "tester-application"] as const,
  // 違うアカウントでつながった知らせ（specs/025）
  connectionNotice: (id: string) => ["account", id, "connection-notice"] as const,
  operatorTesterApplications: (view: string) => ["operator-tester-applications", view] as const,
  // 運営者のアカウント一覧（specs/026）
  operatorAccounts: (method: string, q: string) => ["operator-accounts", method, q] as const,
  operatorTesterApplicationsAll: ["operator-tester-applications"] as const,
  operatorLimits: ["operator-limits"] as const,
  // チーム（specs/011）。Account の下に置かない（チームは Account をまたぐ）。取り直しは ["team", id] の範囲で行う
  team: (id: string) => ["team", id] as const,
  teamInvite: (id: string) => ["team", id, "invite"] as const,
  teamAssignments: (id: string) => ["team", id, "assignments"] as const,
  teamStatus: (id: string) => ["team", id, "status"] as const,
  // 戦略プロファイル（specs/002-strategy-profile）。Account 単位で持ち、Account の削除で一緒に消す
  profileStatus: (id: string) => ["account", id, "profile-status"] as const,
  strategy: (id: string) => ["account", id, "strategy"] as const,
  promotions: (id: string) => ["account", id, "promotions"] as const,
  externalMedia: (id: string) => ["account", id, "external-media"] as const,
  // アルゴリズムの解析（specs/022）。取り直しは ["account", id, "analysis"] の範囲で行う
  analysis: (id: string, scope: string) => ["account", id, "analysis", scope] as const,
  analysisAll: (id: string) => ["account", id, "analysis"] as const,
  // 時間差のメンション（specs/023）
  mentionSettings: (id: string) => ["account", id, "mention-settings"] as const,
  classifications: (id: string, mode: string) => ["account", id, "analysis", "classifications", mode] as const,
  listing: (id: string, promotionId: string, media: string) => ["account", id, "external-media", promotionId, media] as const,
  mediaDefaults: (id: string) => ["account", id, "media-defaults"] as const,
  promotionSettings: (id: string) => ["account", id, "promotion-settings"] as const,
  referencePosts: (id: string) => ["account", id, "reference-posts"] as const,
  researchKeywords: (id: string) => ["account", id, "research-keywords"] as const,
  // 投稿ストック（specs/003-prompt-bulk-register）。プロンプトは件数ごとのキーで、取り直しは ["account", id, "prompt"] の範囲で行う
  prompt: (id: string, count: number) => ["account", id, "prompt", count] as const,
  promptAll: (id: string) => ["account", id, "prompt"] as const,
  postDrafts: (id: string) => ["account", id, "post-drafts"] as const,
  // 承認・却下（specs/004-review-approval）。件数は post-drafts の下に置き、下書きの取り直しで一緒に取り直す
  draftCounts: (id: string) => ["account", id, "post-drafts", "counts"] as const,
  postingRules: (id: string) => ["account", id, "posting-rules"] as const,
  // 自動投稿（specs/005-auto-post）。投稿済みの一覧は post-drafts の下に置かない（状態の変更の後に読み直さない。research.md R14）
  postingSchedule: (id: string) => ["account", id, "posting-schedule"] as const,
  autoPost: (id: string) => ["account", id, "auto-post"] as const,
  published: (id: string) => ["account", id, "published"] as const,
  // パフォーマンス（specs/006-performance-feedback）。タブごとのキーで、取り直しは ["account", id, "performance"] の範囲で行う
  performance: (id: string, tab: string) => ["account", id, "performance", tab] as const,
  performanceAll: (id: string) => ["account", id, "performance"] as const,
};
