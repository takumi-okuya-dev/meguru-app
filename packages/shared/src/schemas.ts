// APIの入出力スキーマ（contracts/api.md「型」）。WebとAPIで共有する。
import { z } from "zod";
import { ERROR_CODES } from "./errors";
import { PLANS } from "./plans";

/** 契約プランのスキーマ。 */
export const planSchema = z.enum(PLANS);
/** Threads接続の状態のスキーマ（FR-018）。 */
export const connectionStatusSchema = z.enum(["connected", "needs_reconnect"]);
/** Threads接続の状態。connected（接続中）か needs_reconnect（要再接続）。 */
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/** 画面に出すAccountの要約のスキーマ（contracts/api.md の AccountSummary）。 */
export const accountSummarySchema = z.object({
  id: z.string(),
  /** Threadsのユーザー名（@なし） */
  username: z.string(),
  displayName: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  plan: planSchema,
  connectionStatus: connectionStatusSchema,
  /** ISO 8601 */
  lastUsedAt: z.string().nullable(),
});
/** 画面に出すAccountの要約。 */
export type AccountSummary = z.infer<typeof accountSummarySchema>;

/** ユーザーの登録数上限と使用数のスキーマ。 */
export const accountLimitSchema = z.object({
  max: z.number().int(),
  used: z.number().int(),
});
/** ユーザーの登録数上限（max）と、ownerとして保有するAccount数（used）。 */
export type AccountLimit = z.infer<typeof accountLimitSchema>;

/** GET /api/me のレスポンスのスキーマ。 */
export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string().nullable(),
  }),
  accounts: z.array(accountSummarySchema),
  landingAccountId: z.string().nullable(),
  accountLimit: accountLimitSchema,
});
/** GET /api/me のレスポンス。ログイン中のユーザー、Account一覧、ログイン後の遷移先、登録数上限。 */
export type MeResponse = z.infer<typeof meResponseSchema>;

/** POST /api/threads/connect のリクエストのスキーマ。新規（new）か再接続（reconnect）。 */
export const connectRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new") }),
  z.object({ mode: z.literal("reconnect"), accountId: z.string().uuid() }),
]);
/** POST /api/threads/connect のリクエスト。 */
export type ConnectRequest = z.infer<typeof connectRequestSchema>;

/** POST /api/threads/connect のレスポンスのスキーマ。Threadsの認可URLを返す。 */
export const connectResponseSchema = z.object({ authorizeUrl: z.string().url() });

/** POST /api/accounts/:id/open のリクエストのスキーマ（research.md R10）。 */
export const openAccountRequestSchema = z.object({
  /** ページを読み込むたびに作る乱数ID（research.md R10） */
  clientId: z.string().min(1).max(100),
  /** そのページでAccountの画面を開くたびに増える連番 */
  openSeq: z.number().int().nonnegative(),
});
/** POST /api/accounts/:id/open のリクエスト。 */
export type OpenAccountRequest = z.infer<typeof openAccountRequestSchema>;

/** DELETE /api/accounts/:id のリクエストのスキーマ。確認のためのユーザー名を受け取る（FR-022）。 */
export const deleteAccountRequestSchema = z.object({
  confirmUsername: z.string(),
});

/** GET /api/data-deletion/:code のレスポンスのスキーマ。Metaのデータ削除要求の進み具合。 */
export const dataDeletionStatusSchema = z.object({
  status: z.enum(["pending", "completed", "failed"]),
  receivedAt: z.string(),
  completedAt: z.string().nullable(),
});
/** Metaのデータ削除要求の進み具合。 */
export type DataDeletionStatus = z.infer<typeof dataDeletionStatusSchema>;

/** APIのエラーレスポンスのスキーマ（contracts/api.md「エラーの形」）。 */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    /** CONFIG_ERROR のときの、誤っている設定の項目名（値は含めない） */
    details: z.array(z.string()).optional(),
  }),
  /** 409 STALE_UPDATE のときの、DBにある最新の値（形は資源ごとに違う。specs/002 contracts/api.md） */
  latest: z.unknown().optional(),
});
/** APIのエラーレスポンス。 */
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
