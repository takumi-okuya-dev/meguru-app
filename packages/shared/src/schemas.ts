// APIの入出力スキーマ（contracts/api.md「型」）。WebとAPIで共有する。
import { z } from "zod";
import { ERROR_CODES } from "./errors";
import {
  ACCOUNT_NAME_MAX,
  PRIORITY_MAX,
  PRIORITY_MIN,
  PROMOTION_CONTENT_MAX,
  REFERENCE_BODY_MAX,
  REFERENCE_WHY_GOOD_MAX,
  SHORT_TEXT_MAX,
  STRATEGY_TEXT_MAX,
  URL_MAX,
  DRAFT_BODY_MAX,
  PROMPT_COUNT_MAX,
  PROMPT_COUNT_MIN,
  CORE_RULES_MAX,
  NG_WORD_LIMIT,
  NG_WORD_MAX,
  REJECT_NOTE_MAX,
  REVIEW_MAX_ITEMS,
  FEEDBACK_MEMO_MAX,
  PERFORMANCE_PAGE_SIZE,
  AUTOPOST_SLOT_LIMIT,
  PUBLISHED_PAGE_SIZE,
  TEAM_MEMBER_LIMIT,
  TEAM_NAME_MAX,
} from "./limits";
import { REJECT_REASON_CODES } from "./review";
import { isValidYmd } from "./promotions";
import { PLANS } from "./plans";
import { STRATEGY_TEXT_KEYS, TONE_PRESET_VALUES, type StrategyTextKey } from "./strategy";
import { countChars, isBlank, isHttpUrl } from "./text";

/** 契約プランのスキーマ。 */
export const planSchema = z.enum(PLANS);
/** Threads接続の状態のスキーマ（FR-018。not_connected は specs/012 で足した）。 */
export const connectionStatusSchema = z.enum(["connected", "needs_reconnect", "not_connected"]);
/** Threads接続の状態。connected（接続中）・needs_reconnect（要再接続）・not_connected（一度もつないでいない）。 */
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
/** 接続の方法（specs/010-token-account-add）。app はこのアプリで許可、token は自分のMetaアプリのトークン。 */
export const connectionMethodSchema = z.enum(["app", "token"]);
/** 接続の方法。 */
export type ConnectionMethod = z.infer<typeof connectionMethodSchema>;

/** Accountに対する役割のスキーマ（memberships の owner・editor。specs/011 contracts/permissions.md）。 */
export const roleSchema = z.enum(["owner", "editor"]);
/** Accountとの関わりのスキーマ（specs/011 contracts/permissions.md「関わり」）。 */
export const relationSchema = z.enum(["owner", "assigned", "shared_viewer"]);
/** チームでのロールのスキーマ（specs/011 data-model.md の team_role）。 */
export const teamRoleSchema = z.enum(["admin", "member", "editor"]);
/** 権限のスキーマ（specs/011 contracts/permissions.md「権限」）。 */
export const permissionSchema = z.enum(["read", "view", "content", "review", "settings", "activity", "owner"]);
/** 操作の記録の、した人の役割（specs/011 data-model.md。partner は008の記録にだけ残る）。 */
export const actorRoleSchema = z.enum(["owner", "member", "partner", "editor", "admin"]);

/** 画面に出すAccountの要約のスキーマ（contracts/api.md の AccountSummary）。 */
export const accountSummarySchema = z.object({
  id: z.string(),
  /** アカウントの名前。主に出す名前（specs/012 research.md R2） */
  name: z.string(),
  /** Threadsのユーザー名（@なし）。未接続ならNULL */
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  plan: planSchema,
  connectionStatus: connectionStatusSchema,
  /** ISO 8601 */
  lastUsedAt: z.string().nullable(),
  /** ログインした人の、このAccountでの役割（owner＝自分のアカウント、editor＝担当、viewer＝見せてもらっている） */
  role: z.enum(["owner", "editor", "viewer"]),
  /** 担当しているAccountのオーナーの名前。自分のAccountならNULL */
  ownerName: z.string().nullable(),
  /** 今の接続の方法（specs/010 contracts/api.md）。APIは必ず返す。未接続ならNULL（specs/012）。省略は app として扱う */
  connectionMethod: connectionMethodSchema.nullable().optional(),
  /** 要再接続の理由の補い（short_lived_token）。省略は NULL として扱う */
  reconnectHint: z.enum(["short_lived_token"]).nullable().optional(),
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

/** /api/me の、入っているチーム（サイドバーの「チーム」の見出しの下に並べる）。 */
export const meTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative(),
  role: teamRoleSchema,
});
/** 入っているチーム。 */
export type MeTeam = z.infer<typeof meTeamSchema>;

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
  /** Threads連携の公開範囲（specs/002 FR-028）。testers の間は、アカウント追加画面に検証期間の案内を出す */
  threadsAccessMode: z.enum(["testers", "public"]),
  /** 入っているチーム（参加した順。入っていなければ空。specs/011 research.md R5） */
  teams: z.array(meTeamSchema),
});
/** GET /api/me のレスポンス。ログイン中のユーザー、Account一覧、ログイン後の遷移先、登録数上限。 */
export type MeResponse = z.infer<typeof meResponseSchema>;

/** GET /api/me/needs-review-counts の応答。所有Accountが0件なら空配列。 */
export const needsReviewCountsResponseSchema = z.object({
  counts: z.array(
    z.object({
      accountId: z.string(),
      needsReview: z.number().int().nonnegative(),
    }),
  ),
});
/** 所有Accountごとの要確認件数。 */
export type NeedsReviewCountsResponse = z.infer<typeof needsReviewCountsResponseSchema>;

/**
 * POST /api/threads/connect のリクエストのスキーマ。未接続のアカウントにはじめてつなぐ（connect）か、接続し直す（reconnect）。
 * つないでアカウントを作る（new）は specs/012 でなくした（research.md R4）。
 */
export const connectRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("connect"), accountId: z.string().uuid() }),
  z.object({ mode: z.literal("reconnect"), accountId: z.string().uuid() }),
]);
/** POST /api/threads/connect のリクエスト。 */
export type ConnectRequest = z.infer<typeof connectRequestSchema>;

/** POST /api/threads/token-connect のリクエスト（specs/010 contracts/api.md）。トークンは前後を取り除く前のもの。 */
export const tokenConnectRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("connect"), accountId: z.string().uuid(), token: z.string().min(1).max(4096) }),
  z.object({ mode: z.literal("reconnect"), accountId: z.string().uuid(), token: z.string().min(1).max(4096) }),
]);
/** POST /api/threads/token-connect のリクエスト。 */
export type TokenConnectRequestBody = z.infer<typeof tokenConnectRequestSchema>;

/** POST /api/threads/token-connect のレスポンス。warnings は権限がないもの。 */
export const tokenConnectResponseSchema = z.object({
  accountId: z.string(),
  kind: z.enum(["connect", "reconnect"]),
  username: z.string(),
  warnings: z.array(z.enum(["no_publish_permission", "no_insights_permission"])),
});
/** POST /api/threads/token-connect のレスポンス。 */
export type TokenConnectResponse = z.infer<typeof tokenConnectResponseSchema>;

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

/** DELETE /api/accounts/:id のリクエストのスキーマ。確認のためのアカウントの名前を受け取る（FR-022、specs/012 FR-043）。 */
export const deleteAccountRequestSchema = z.object({
  confirmName: z.string().max(200),
});

/** アカウントの名前（前後の空白を除いて1〜50文字。specs/012 FR-002・FR-040）。 */
export const accountNameSchema = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => countChars(v) >= 1 && countChars(v) <= ACCOUNT_NAME_MAX, { message: "1-50 chars" });

/** POST /api/accounts のリクエスト（specs/012 contracts/api.md）。 */
export const createAccountRequestSchema = z.object({ name: accountNameSchema });
/** POST /api/accounts のリクエスト。 */
export type CreateAccountRequest = z.input<typeof createAccountRequestSchema>;

/** PATCH /api/accounts/:id のリクエスト（specs/012 contracts/api.md）。 */
export const renameAccountRequestSchema = z.object({ name: accountNameSchema });
/** PATCH /api/accounts/:id のリクエスト。 */
export type RenameAccountRequest = z.input<typeof renameAccountRequestSchema>;

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
  /** 409 STALE_UPDATE のときの、先に保存した人（specs/008 FR-007、research.md R8）。不明ならNULL */
  updatedBy: z.object({ name: z.string() }).nullable().optional(),
});
/** APIのエラーレスポンス。 */
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ---- 戦略プロファイル（specs/002-strategy-profile contracts/api.md）----

/**
 * 文字数（コードポイントの数）の上限つきの文字列（research.md R2）。
 * @param max - 上限
 * @returns zod のスキーマ
 */
export const textMax = (max: number) => z.string().refine((s) => countChars(s) <= max, { message: `max ${max}` });

/** 課題の全項目の値のスキーマ。19個のテキストはすべて必須（"" は未入力）。 */
export const strategyValuesSchema = z.object({
  ...(Object.fromEntries(STRATEGY_TEXT_KEYS.map((k) => [k, textMax(STRATEGY_TEXT_MAX)])) as Record<
    StrategyTextKey,
    ReturnType<typeof textMax>
  >),
  tonePreset: z.enum(TONE_PRESET_VALUES).nullable(),
});

/** PUT /api/accounts/:id/strategy のリクエストのスキーマ。 */
export const putStrategyRequestSchema = strategyValuesSchema.extend({
  expectedVersion: z.number().int().nonnegative(),
});
/** PUT /api/accounts/:id/strategy のリクエスト。 */
export type PutStrategyRequest = z.infer<typeof putStrategyRequestSchema>;

/** 課題（GET・PUT のレスポンス）のスキーマ。 */
export const strategySchema = strategyValuesSchema.extend({
  version: z.number().int(),
  filledCount: z.number().int(),
  totalCount: z.literal(16),
  /** ISO 8601。まだ保存していなければ null */
  updatedAt: z.string().nullable(),
  canEdit: z.boolean(),
});
/** 課題（GET・PUT のレスポンス）。 */
export type Strategy = z.infer<typeof strategySchema>;

/**
 * zod の検証の失敗から、違反した項目名（リクエストのキー名）を取り出す。VALIDATION_FAILED の details に使う。
 * @param error - zod のエラー
 * @returns 項目名の一覧（重複なし）
 */
export function invalidFields(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => String(i.path[0] ?? "")).filter(Boolean))];
}

/**
 * 空白だけでない、文字数の上限つきの文字列（必須の項目）。
 * @param max - 上限
 * @returns zod のスキーマ
 */
export const requiredText = (max: number) =>
  textMax(max).refine((s) => !isBlank(s), { message: "required" });

/**
 * 任意の URL（"" は未入力）。http・https のみで、文字数の上限つき（research.md R8）。
 * @param max - 上限
 * @returns zod のスキーマ
 */
export const optionalUrl = (max: number) =>
  textMax(max)
    .default("")
    .refine((s) => s === "" || isHttpUrl(s), { message: "http(s) url" });

/** 一覧のレスポンスに共通の項目。 */
const listMeta = { limit: z.number().int(), canEdit: z.boolean() };

/** 子の行（宣伝内容・参考投稿・キーワード）に共通の項目。 */
const itemMeta = { id: z.string(), version: z.number().int(), createdAt: z.string(), updatedAt: z.string() };

/** 宣伝内容の状態のスキーマ。 */
export const promotionStatusSchema = z.enum(["active", "paused", "ended"]);

/** 宣伝内容の入力のスキーマ（contracts/api.md の PromotionInput）。 */
export const promotionInputSchema = z.object({
  title: requiredText(SHORT_TEXT_MAX),
  content: requiredText(PROMOTION_CONTENT_MAX),
  targetLocation: textMax(SHORT_TEXT_MAX).default(""),
  targetPersona: textMax(SHORT_TEXT_MAX).default(""),
  targetAgeRange: textMax(SHORT_TEXT_MAX).default(""),
  cta: textMax(SHORT_TEXT_MAX).default(""),
  linkedUrl: optionalUrl(URL_MAX),
  priority: z.number().int().min(PRIORITY_MIN).max(PRIORITY_MAX).default(0),
  status: promotionStatusSchema.default("active"),
  /** YYYY-MM-DD。過去の日付も受け付ける（期限切れとして扱う） */
  validUntil: z
    .string()
    .refine(isValidYmd, { message: "YYYY-MM-DD" })
    .nullable()
    .default(null),
});
/** 宣伝内容の入力。 */
export type PromotionInput = z.infer<typeof promotionInputSchema>;

/** PUT /promotions/:id のリクエストのスキーマ。 */
export const updatePromotionRequestSchema = promotionInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});

/** 宣伝内容（レスポンス）のスキーマ。 */
export const promotionSchema = promotionInputSchema.extend({
  ...itemMeta,
  isExpired: z.boolean(),
  isTargetable: z.boolean(),
});
/** 宣伝内容（レスポンス）。 */
export type Promotion = z.infer<typeof promotionSchema>;

/** GET /promotions のレスポンスのスキーマ。 */
export const promotionListSchema = z.object({ items: z.array(promotionSchema), ...listMeta });

/** 宣伝投稿の割合の入力のスキーマ（FR-010）。 */
export const promotionSettingsInputSchema = z.object({
  ratioPercent: z.number().int().min(0).max(100),
});

/** 宣伝投稿の割合の保存（PUT）のスキーマ。読み込んだときの版を送る（specs/008 FR-007、PR #9 のCodexレビュー）。 */
export const putPromotionSettingsRequestSchema = promotionSettingsInputSchema.extend({
  expectedVersion: z.number().int().min(1),
});

/** 宣伝投稿の割合（レスポンス）のスキーマ。 */
export const promotionSettingsSchema = promotionSettingsInputSchema.extend({
  version: z.number().int(),
  canEdit: z.boolean(),
});
/** 宣伝投稿の割合（レスポンス）。 */
export type PromotionSettings = z.infer<typeof promotionSettingsSchema>;

/** 参考投稿の入力のスキーマ（contracts/api.md の ReferencePostInput）。 */
export const referencePostInputSchema = z.object({
  body: requiredText(REFERENCE_BODY_MAX),
  keyword: textMax(SHORT_TEXT_MAX).default(""),
  postUrl: optionalUrl(URL_MAX),
  whyGood: textMax(REFERENCE_WHY_GOOD_MAX).default(""),
});
/** 参考投稿の入力。 */
export type ReferencePostInput = z.infer<typeof referencePostInputSchema>;

/** PUT /reference-posts/:id のリクエストのスキーマ。 */
export const updateReferencePostRequestSchema = referencePostInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});

/** 参考投稿（レスポンス）のスキーマ。 */
export const referencePostSchema = referencePostInputSchema.extend(itemMeta);
/** 参考投稿（レスポンス）。 */
export type ReferencePost = z.infer<typeof referencePostSchema>;

/** GET /reference-posts のレスポンスのスキーマ。 */
export const referencePostListSchema = z.object({ items: z.array(referencePostSchema), ...listMeta });

/** キーワードの入力のスキーマ（contracts/api.md の ResearchKeywordInput）。 */
export const researchKeywordInputSchema = z.object({
  keyword: requiredText(SHORT_TEXT_MAX),
  purpose: textMax(SHORT_TEXT_MAX).default(""),
});
/** キーワードの入力。 */
export type ResearchKeywordInput = z.infer<typeof researchKeywordInputSchema>;

/** PUT /research-keywords/:id のリクエストのスキーマ。 */
export const updateResearchKeywordRequestSchema = researchKeywordInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});

/** キーワード（レスポンス）のスキーマ。 */
export const researchKeywordSchema = researchKeywordInputSchema.extend(itemMeta);
/** キーワード（レスポンス）。 */
export type ResearchKeyword = z.infer<typeof researchKeywordSchema>;

/** GET /research-keywords のレスポンスのスキーマ。 */
export const researchKeywordListSchema = z.object({ items: z.array(researchKeywordSchema), ...listMeta });

/** GET /api/accounts/:id/profile-status のレスポンスのスキーマ（ホームの入力状況。research.md R11・R14）。 */
export const profileStatusSchema = z.object({
  strategy: z.object({ filledCount: z.number().int(), totalCount: z.number().int() }),
  promotions: z.object({ targetableCount: z.number().int(), totalCount: z.number().int() }),
  research: z.object({ referencePostCount: z.number().int(), keywordCount: z.number().int() }),
  access: z.object({
    canEdit: z.boolean(),
    inTrial: z.boolean(),
    /** 無料体験の終了時刻（ISO 8601） */
    trialEndsAt: z.string().nullable(),
  }),
});
/** ホームの入力状況。 */
export type ProfileStatus = z.infer<typeof profileStatusSchema>;

// ---- 投稿ストック（specs/003-prompt-bulk-register contracts/api.md）----

/**
 * 下書きの状態のスキーマ（specs/004-review-approval・005-auto-post data-model.md）。
 * 要確認・承認済み・却下（004）と、投稿の処理中・投稿済み・投稿に失敗（005）。
 */
export const postDraftStatusSchema = z.enum([
  "needs_review",
  "approved",
  "rejected",
  "publishing",
  "published",
  "publish_failed",
]);
/** 下書きの状態。 */
export type PostDraftStatus = z.infer<typeof postDraftStatusSchema>;

/** 投稿に失敗した理由のスキーマ（005 data-model.md）。 */
export const publishErrorSchema = z.enum(["network", "threads_server", "invalid_request", "container_error", "unknown"]);
/** 投稿に失敗した理由。 */
export type PublishError = z.infer<typeof publishErrorSchema>;

/** 投稿の直前のチェックで要確認に戻した理由のスキーマ（005 FR-007）。 */
export const blockedReasonSchema = z.enum(["ng_word", "over_threads_limit"]);
/** 投稿の直前のチェックで要確認に戻した理由。 */
export type BlockedReason = z.infer<typeof blockedReasonSchema>;

/** 却下理由の候補のコードのスキーマ（004 research.md R10）。 */
export const rejectReasonCodeSchema = z.enum(REJECT_REASON_CODES);

/** 下書き（レスポンス）のスキーマ。 */
export const postDraftSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  /** 登録のまとまりの中での順番（0始まり） */
  position: z.number().int(),
  body: z.string(),
  status: postDraftStatusSchema,
  version: z.number().int(),
  /** 承認・却下した日時（ISO 8601）。要確認では null */
  reviewedAt: z.string().nullable(),
  /** 選んだ却下理由の候補。却下でないときは [] */
  rejectReasons: z.array(rejectReasonCodeSchema),
  /** 却下理由の自由記述 */
  rejectNote: z.string().nullable(),
  /** 「次に投稿する」の日時（005） */
  prioritizedAt: z.string().nullable(),
  /** 前の時刻から持ち越したか（005） */
  carryover: z.boolean(),
  /** 投稿した日時（005） */
  publishedAt: z.string().nullable(),
  threadsMediaId: z.string().nullable(),
  /** Threadsの投稿のURL。投稿済みでも、URLを取る前は null（005 research.md R6） */
  threadsPermalink: z.string().nullable(),
  publishFailedAt: z.string().nullable(),
  publishError: publishErrorSchema.nullable(),
  /** 投稿の直前のチェックで要確認に戻した日時（005） */
  blockedAt: z.string().nullable(),
  blockedReason: blockedReasonSchema.nullable(),
  /** 当たったNGワード（ng_word のとき）。ほかは [] */
  blockedWords: z.array(z.string()),
  /** 登録した人・最後に本文を直した人の users.id と、直した日時（specs/008 FR-053）。008より前の行は null */
  createdBy: z.string().nullable().default(null),
  editedBy: z.string().nullable().default(null),
  editedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
/** 下書き（レスポンス）。 */
export type PostDraft = z.infer<typeof postDraftSchema>;

/** 状態ごとの下書きの件数のスキーマ（GET /post-drafts/counts）。 */
export const draftCountsSchema = z.object({
  needsReview: z.number().int(),
  /** 投稿の処理中を含む */
  approved: z.number().int(),
  rejected: z.number().int(),
  published: z.number().int(),
  publishFailed: z.number().int(),
});
/** 状態ごとの下書きの件数。 */
export type DraftCounts = z.infer<typeof draftCountsSchema>;

/** NGワードのスキーマ（004 contracts/api.md）。 */
export const ngWordSchema = z.object({
  id: z.string(),
  /** 入力のまま */
  word: z.string(),
  /** 照合に使う値（normalizeNgWord） */
  normalized: z.string(),
  createdAt: z.string(),
});
/** NGワード。 */
export type NgWord = z.infer<typeof ngWordSchema>;

/** 自動投稿の状態のスキーマ（005 contracts/api.md）。 */
export const autoPostStateSchema = z.object({
  enabled: z.boolean(),
  slotCount: z.number().int(),
  /** 止まっている理由。止まっていなければ null */
  stoppedReason: z.enum(["needs_reconnect", "rate_limited", "not_connected"]).nullable(),
});
/** 自動投稿の状態。 */
export type AutoPostState = z.infer<typeof autoPostStateSchema>;

/** GET /post-drafts のレスポンスのスキーマ（004で3つの状態を返す形にした。005で投稿の順と予定を足した）。 */
export const postDraftListSchema = z.object({
  /** 登録のまとまりの新しい順 → position の昇順 */
  needsReview: z.array(postDraftSchema),
  /** 投稿の順（005 research.md R4）。投稿の処理中を含む */
  approved: z.array(postDraftSchema),
  /** 投稿に失敗した日時の新しい順に、すべて（005） */
  publishFailed: z.array(postDraftSchema),
  /** 下書きのIDから、投稿の予定の時刻（ISO 8601）へ。オフ・停止中は {}（005） */
  schedule: z.record(z.string(), z.string()),
  /** 自動投稿の状態。見せてもらっている人にはNULL（自動投稿の状態は view。specs/011 FR-031、PR #14 のCodexレビュー） */
  autoPost: autoPostStateSchema.nullable(),
  /** reviewedAt の新しい順に最大500件 */
  rejected: z.array(postDraftSchema),
  counts: draftCountsSchema,
  limits: z.object({ needsReview: z.number().int(), approved: z.number().int() }),
  /** そのAccountのNGワード（古い順） */
  ngWords: z.array(ngWordSchema),
  /** そのAccountで、プロンプトの生成（grower機能）を使えるか */
  canGeneratePrompt: z.boolean(),
  /** 保存済みの作る件数。見せてもらっている人にはNULL（設定は見せない。specs/011 FR-031） */
  promptPostCount: z.number().int().nullable(),
  /** 作る件数の版（保存のときに送る。specs/008 FR-007）。見せてもらっている人にはNULL */
  promptPostCountVersion: z.number().int().nullable().default(1),
  /** createdBy・editedBy の users.id から名前へ（チームがあるAccountだけ。specs/008 FR-053） */
  people: z.record(z.string(), z.string()).default({}),
});
/** GET /post-drafts のレスポンス。 */
export type PostDraftList = z.infer<typeof postDraftListSchema>;

/** POST /draft-batches のリクエストのスキーマ。 */
export const createDraftBatchRequestSchema = z.object({
  /** Webが送信ごとに作るID。再試行では同じ値（research.md R5） */
  clientRequestId: z.string().uuid(),
  text: z.string().refine((s) => !isBlank(s), { message: "required" }),
});
/** POST /draft-batches のリクエスト。 */
export type CreateDraftBatchRequest = z.infer<typeof createDraftBatchRequestSchema>;

/** POST /draft-batches のレスポンスのスキーマ。 */
export const draftBatchResultSchema = z.object({
  batchId: z.string(),
  draftCount: z.number().int(),
  delimiterFound: z.boolean(),
  /** Threadsの上限（500・リンク5個）を超える下書きの件数 */
  overLimitCount: z.number().int(),
  drafts: z.array(postDraftSchema),
});
/** POST /draft-batches のレスポンス。 */
export type DraftBatchResult = z.infer<typeof draftBatchResultSchema>;

/** PUT /post-drafts/:id のリクエストのスキーマ。 */
export const updatePostDraftRequestSchema = z.object({
  body: requiredText(DRAFT_BODY_MAX),
  expectedVersion: z.number().int().positive(),
});

/** PUT /post-drafts/:id のレスポンスのスキーマ。承認済みを保存すると reopened: true で要確認に戻る。 */
export const updatePostDraftResponseSchema = z.object({ draft: postDraftSchema, reopened: z.boolean() });

/**
 * UUID を小文字にそろえる。DB（uuid 型）は小文字で返すので、比べる前にそろえておく
 * （大文字で送られた自分の再試行を、別の操作と取り違えないため。PR #5 のCodexレビュー）。
 */
const lowerUuid = z
  .string()
  .uuid()
  .transform((s) => s.toLowerCase());

/** POST /post-drafts/review のリクエストのスキーマ（004 contracts/api.md、research.md R2）。 */
export const reviewRequestSchema = z
  .object({
    /** requeue：投稿に失敗 → 承認済み（もう一度投稿の順に入れる。005 FR-015） */
    action: z.enum(["approve", "reject", "reopen", "requeue"]),
    /** 操作ごとのID。同じ操作の再試行では同じ値を送り、自分の再試行だけを成功として扱う（research.md R2） */
    requestId: lowerUuid,
    items: z
      .array(z.object({ id: lowerUuid, expectedVersion: z.number().int().positive() }))
      .min(1)
      .max(REVIEW_MAX_ITEMS),
    /** 規約に注意の確認を済ませた。approve のときだけ送る */
    confirmPolicyCaution: z.boolean().optional(),
    reject: z
      .object({
        reasons: z.array(rejectReasonCodeSchema),
        note: textMax(REJECT_NOTE_MAX).default(""),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.id)).size !== v.items.length) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "duplicate id" });
    }
    if (v.action !== "approve" && v.confirmPolicyCaution !== undefined) {
      ctx.addIssue({ code: "custom", path: ["confirmPolicyCaution"], message: "only for approve" });
    }
    if (v.action !== "reject") {
      if (v.reject) ctx.addIssue({ code: "custom", path: ["reject"], message: "only for reject" });
      return;
    }
    if (!v.reject || (v.reject.reasons.length === 0 && isBlank(v.reject.note))) {
      ctx.addIssue({ code: "custom", path: ["reject"], message: "reason required" });
    } else if (new Set(v.reject.reasons).size !== v.reject.reasons.length) {
      ctx.addIssue({ code: "custom", path: ["reject"], message: "duplicate reason" });
    }
  });
/** POST /post-drafts/review のリクエスト。 */
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

/** 状態を変えなかった理由のスキーマ。 */
export const skipReasonSchema = z.enum([
  "NG_WORD",
  "OVER_THREADS_LIMIT",
  "POLICY_CONFIRM_REQUIRED",
  "STALE",
  "NOT_FOUND",
  "LIMIT",
  /** 投稿の処理中（005 FR-008） */
  "PUBLISHING",
]);
/** 状態を変えなかった理由。 */
export type SkipReason = z.infer<typeof skipReasonSchema>;

/** POST /post-drafts/review のレスポンスのスキーマ。 */
export const reviewResponseSchema = z.object({
  updated: z.array(postDraftSchema),
  skipped: z.array(z.object({ id: z.string(), reason: skipReasonSchema, latest: postDraftSchema.optional() })),
  counts: draftCountsSchema,
});
/** POST /post-drafts/review のレスポンス。 */
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

/** POST /post-drafts/delete のリクエストのスキーマ。 */
export const deletePostDraftsRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/** 削除した件数のスキーマ（取り消し・まとめての削除のレスポンス）。 */
export const deleteCountSchema = z.object({ deletedCount: z.number().int() });

/** プロンプトに実際に含めた内容の要約のスキーマ。 */
export const promptSummarySchema = z.object({
  strategyFilledCount: z.number().int(),
  promotionCount: z.number().int(),
  referencePostCount: z.number().int(),
  recentDraftCount: z.number().int(),
  length: z.number().int(),
  /** 含めた投稿ルールの行数（規約上のルールは数えない。004） */
  coreRuleCount: z.number().int(),
  /** 含めたNGワードの数（004） */
  ngWordCount: z.number().int(),
  /** 含めた却下の下書きの件数（004） */
  rejectedCount: z.number().int(),
  /** 投稿の設定の時刻の数（005 FR-024） */
  dailyPostCount: z.number().int(),
  /** 含めた反応が低かった投稿の件数（006） */
  poorPostCount: z.number().int(),
});
/** プロンプトに実際に含めた内容の要約。 */
export type PromptSummary = z.infer<typeof promptSummarySchema>;

/** GET /prompt のレスポンスのスキーマ。 */
export const promptResponseSchema = z.object({
  prompt: z.string(),
  count: z.number().int(),
  summary: promptSummarySchema,
});
/** GET /prompt のレスポンス。 */
export type PromptResponse = z.infer<typeof promptResponseSchema>;

/** 作る件数の保存（PUT /prompt-settings のリクエスト）のスキーマ。読み込んだときの版を送る（specs/008 FR-007、PR #9 のCodexレビュー）。 */
export const putPromptSettingsRequestSchema = z.object({
  postCount: z.number().int().min(PROMPT_COUNT_MIN).max(PROMPT_COUNT_MAX),
  expectedVersion: z.number().int().min(1),
});

/** 作る件数のスキーマ（PUT /prompt-settings のレスポンス）。 */
export const promptSettingsSchema = z.object({
  postCount: z.number().int().min(PROMPT_COUNT_MIN).max(PROMPT_COUNT_MAX),
  version: z.number().int(),
});

// ---- 投稿のルール（specs/004-review-approval contracts/api.md）----

/** GET /posting-rules のレスポンスのスキーマ。 */
export const postingRulesSchema = z.object({
  ngWords: z.array(ngWordSchema),
  ngWordLimit: z.number().int(),
  coreRules: z.string(),
  coreRulesVersion: z.number().int(),
  /** 投稿ルールを編集できるか（grower機能） */
  canEditCoreRules: z.boolean(),
});
/** GET /posting-rules のレスポンス。 */
export type PostingRules = z.infer<typeof postingRulesSchema>;

/** POST /ng-words のリクエストのスキーマ。空白だけの語はAPIで除く。 */
export const addNgWordsRequestSchema = z.object({
  words: z
    .array(z.string().refine((s) => countChars(s.trim()) <= NG_WORD_MAX, { message: `max ${NG_WORD_MAX}` }))
    .min(1)
    .max(NG_WORD_LIMIT),
});

/** POST /ng-words のレスポンスのスキーマ。 */
export const addNgWordsResponseSchema = z.object({
  added: z.array(ngWordSchema),
  /** すでにあった、または同じ送信の中で重なった語 */
  duplicates: z.array(z.string()),
  /** 要確認に戻した承認済みの下書きの件数 */
  reopenedCount: z.number().int(),
});
/** POST /ng-words のレスポンス。 */
export type AddNgWordsResponse = z.infer<typeof addNgWordsResponseSchema>;

/** PUT /core-rules のリクエストのスキーマ。 */
export const coreRulesRequestSchema = z.object({
  text: textMax(CORE_RULES_MAX),
  expectedVersion: z.number().int().positive(),
});

/** PUT /core-rules のレスポンス（と 409 の latest）のスキーマ。 */
export const coreRulesResponseSchema = z.object({ coreRules: z.string(), coreRulesVersion: z.number().int() });
/** PUT /core-rules のレスポンス。 */
export type CoreRulesResponse = z.infer<typeof coreRulesResponseSchema>;

// ---- 自動投稿（specs/005-auto-post contracts/api.md）----

const slotTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** 投稿の設定のスキーマ。 */
export const postingScheduleSchema = z.object({
  enabled: z.boolean(),
  /** "HH:MM"（日本時間）の昇順 */
  slotTimes: z.array(z.string()),
  jitter: z.boolean(),
  /** 行がないときは 0（最初の保存は expectedVersion: 0） */
  version: z.number().int(),
});
/** 投稿の設定。 */
export type PostingSchedule = z.infer<typeof postingScheduleSchema>;

/** PUT /posting-schedule のリクエストのスキーマ。並び・重複・間の検証は validatePostingSchedule で行う。 */
export const putPostingScheduleRequestSchema = z.object({
  enabled: z.boolean(),
  slotTimes: z.array(slotTimeSchema).max(AUTOPOST_SLOT_LIMIT * 2),
  jitter: z.boolean(),
  expectedVersion: z.number().int().min(0),
});
/** PUT /posting-schedule のリクエスト。 */
export type PutPostingScheduleRequest = z.infer<typeof putPostingScheduleRequestSchema>;

/** 投稿の権限の確認の結果のスキーマ（005 FR-002a・FR-002b、research.md R15）。 */
export const threadsCheckSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), quotaUsage: z.number().int(), quotaTotal: z.number().int() }),
  z.object({ status: z.literal("needs_reconnect") }),
  // 未接続のアカウント（specs/012 research.md R5）。Threadsに問い合わせない
  z.object({ status: z.literal("not_connected") }),
  z.object({ status: z.literal("no_publish_permission") }),
  z.object({ status: z.literal("unknown") }),
]);
/** 投稿の権限の確認の結果。 */
export type ThreadsCheck = z.infer<typeof threadsCheckSchema>;

/** GET /posting-schedule のレスポンスのスキーマ。 */
export const postingScheduleResponseSchema = z.object({
  schedule: postingScheduleSchema,
  limits: z.object({ slots: z.number().int(), minGapMinutes: z.number().int(), jitterMinutes: z.number().int() }),
});
/** GET /posting-schedule のレスポンス。 */
export type PostingScheduleResponse = z.infer<typeof postingScheduleResponseSchema>;

/** PUT /posting-schedule のレスポンスのスキーマ。確かめなかったときの connectionCheck は null。 */
export const putPostingScheduleResponseSchema = z.object({
  schedule: postingScheduleSchema,
  connectionCheck: threadsCheckSchema.nullable(),
});
/** PUT /posting-schedule のレスポンス。 */
export type PutPostingScheduleResponse = z.infer<typeof putPostingScheduleResponseSchema>;

/** 知らせのスキーマ（005 FR-018、research.md R8）。 */
export const autoPostNoticeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("needs_reconnect") }),
  // 未接続（specs/012 contracts/api.md「Threadsが要る機能」）
  z.object({ kind: z.literal("not_connected") }),
  z.object({ kind: z.literal("rate_limited"), until: z.string() }),
  z.object({
    kind: z.literal("publish_failed"),
    count: z.number().int(),
    latestError: publishErrorSchema,
    latestAt: z.string(),
  }),
  z.object({
    kind: z.literal("blocked"),
    count: z.number().int(),
    latestReason: blockedReasonSchema,
    latestWords: z.array(z.string()),
  }),
  z.object({ kind: z.literal("no_approved"), nextSlotAt: z.string().nullable() }),
]);
/** 知らせ。 */
export type AutoPostNotice = z.infer<typeof autoPostNoticeSchema>;

/** GET /auto-post のレスポンスのスキーマ。 */
export const autoPostStatusSchema = z.object({
  autoPost: autoPostStateSchema,
  next: z
    .object({ at: z.string(), draft: z.object({ id: z.string(), excerpt: z.string() }) })
    .nullable(),
  approvedCount: z.number().int(),
  /** 承認済みの件数 ÷ 時刻の数（切り捨て）。時刻が0件なら null */
  daysLeft: z.number().int().nullable(),
  notices: z.array(autoPostNoticeSchema),
});
/** GET /auto-post のレスポンス。 */
export type AutoPostStatus = z.infer<typeof autoPostStatusSchema>;

/** 投稿済みの一覧の1件のスキーマ（GET /post-drafts/published。画面で使う列だけ）。 */
export const publishedPostSchema = z.object({
  id: z.string(),
  body: z.string(),
  publishedAt: z.string(),
  threadsMediaId: z.string().nullable(),
  threadsPermalink: z.string().nullable(),
});
/** 投稿済みの一覧の1件。 */
export type PublishedPost = z.infer<typeof publishedPostSchema>;

/** GET /post-drafts/published のレスポンスのスキーマ。 */
export const publishedPageSchema = z.object({
  items: z.array(publishedPostSchema),
  /** 続きを読むときに before に渡す値。続きがなければ null */
  nextCursor: z.string().nullable(),
});
/** GET /post-drafts/published のレスポンス。 */
export type PublishedPage = z.infer<typeof publishedPageSchema>;

/** GET /post-drafts/published のクエリのスキーマ。 */
export const publishedQuerySchema = z.object({
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PUBLISHED_PAGE_SIZE).default(PUBLISHED_PAGE_SIZE),
});

/** POST /post-drafts/:id/prioritize のリクエストのスキーマ。 */
export const prioritizeRequestSchema = z.object({ expectedVersion: z.number().int().positive() });

// ---- パフォーマンス分析と改善フィードバック（specs/006-performance-feedback contracts/api.md「型」） ----

/** 判定。 */
export const judgmentSchema = z.enum(["good", "normal", "poor"]);
/** 判定（好調・普通・低調）（specs/006）。 */
export type Judgment = z.infer<typeof judgmentSchema>;

/** 反応数の記録の状態。pending は記録の行がない（まだ一度も取っていない）。 */
export const metricsStateSchema = z.enum(["pending", "updating", "confirmed", "late_confirmed", "unmeasurable"]);
/** 反応数の記録の状態（specs/006）。 */
export type MetricsState = z.infer<typeof metricsStateSchema>;

/** 取り込みの種類。 */
export const metricsKindSchema = z.enum(["h24", "d3", "d7", "late"]);
/** 取り込みの種類（specs/006）。 */
export type MetricsKind = z.infer<typeof metricsKindSchema>;

/** 取り方（自動投稿の時刻の処理か、毎日の処理か）。 */
export const metricsMethodSchema = z.enum(["slot", "daily"]);
/** 取り方（specs/006）。 */
export type MetricsMethod = z.infer<typeof metricsMethodSchema>;

/** 絞り込みのタブ。pending は確定待ち（pending と updating）。 */
export const performanceTabSchema = z.enum(["all", "good", "normal", "poor", "pending"]);
/** 絞り込みのタブ（specs/006）。 */
export type PerformanceTab = z.infer<typeof performanceTabSchema>;

/** 6つの反応数。返らなかった指標は null。 */
export const metricsSchema = z.object({
  views: z.number().int().nullable(),
  likes: z.number().int().nullable(),
  replies: z.number().int().nullable(),
  reposts: z.number().int().nullable(),
  quotes: z.number().int().nullable(),
  shares: z.number().int().nullable(),
});
/** 6つの反応数（specs/006）。 */
export type Metrics = z.infer<typeof metricsSchema>;

/** 低調の投稿の改善フィードバック。 */
export const feedbackSchema = z.object({
  memo: z.string().nullable(),
  includeInPrompt: z.boolean(),
  /** 次のプロンプトに入る5件か（FR-022） */
  inNextPrompt: z.boolean(),
  /** 保存の衝突を見つける版（specs/008 FR-007） */
  version: z.number().int().default(1),
});
/** 低調の投稿の改善フィードバック（specs/006）。 */
export type Feedback = z.infer<typeof feedbackSchema>;

/** パフォーマンスの一覧の1件。 */
export const performanceItemSchema = z.object({
  id: z.string(),
  body: z.string(),
  publishedAt: z.string(),
  threadsPermalink: z.string().nullable(),
  state: metricsStateSchema,
  metrics: metricsSchema.nullable(),
  lastFetchedAt: z.string().nullable(),
  lastElapsedHours: z.number().int().nullable(),
  nextFetchAt: z.string().nullable(),
  confirmAt: z.string().nullable(),
  judgment: judgmentSchema.nullable(),
  ratio: z.number().nullable(),
  unmeasurableReason: z.enum(["no_media_id", "not_found"]).nullable(),
  feedback: feedbackSchema.nullable(),
});
/** パフォーマンスの一覧の1件（specs/006）。 */
export type PerformanceItem = z.infer<typeof performanceItemSchema>;

/** パフォーマンスの画面の上の集計。 */
export const performanceSummarySchema = z.object({
  /** 基準値。基準値に使える確定の投稿が5件未満なら null */
  baseline: z.number().nullable(),
  /** 基準値に使った確定の件数（最大30） */
  baselineSampleCount: z.number().int(),
  /** 確定した投稿の数（5件未満のとき「いま{n}件」に使う） */
  judgeableCount: z.number().int(),
  /** 5件以上あるが基準値が0（FR-009） */
  baselineIsZero: z.boolean(),
  lastFetchedAt: z.string().nullable(),
  insightsDenied: z.boolean(),
  needsReconnect: z.boolean(),
  /** 未接続（数字は数えない。specs/012 FR-033） */
  notConnected: z.boolean(),
  counts: z.object({
    all: z.number().int(),
    good: z.number().int(),
    normal: z.number().int(),
    poor: z.number().int(),
    pending: z.number().int(),
  }),
});
/** パフォーマンスの画面の上の集計（specs/006）。 */
export type PerformanceSummary = z.infer<typeof performanceSummarySchema>;

/** GET /performance のレスポンスのスキーマ。 */
export const performancePageSchema = z.object({
  summary: performanceSummarySchema,
  items: z.array(performanceItemSchema),
  nextCursor: z.string().nullable(),
});
/** GET /performance のレスポンス（specs/006）。 */
export type PerformancePage = z.infer<typeof performancePageSchema>;

/** GET /performance のクエリのスキーマ。 */
export const performanceQuerySchema = z.object({
  tab: performanceTabSchema.default("all"),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PERFORMANCE_PAGE_SIZE).default(PERFORMANCE_PAGE_SIZE),
});

/** PATCH /performance/:draftId/feedback のリクエストのスキーマ（FR-021）。 */
export const feedbackRequestSchema = z
  .object({
    memo: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v === null ? null : v.trim() === "" ? null : v.trim()))
      .refine((v) => v === undefined || v === null || [...v].length <= FEEDBACK_MEMO_MAX, {
        message: "memo is too long",
      }),
    includeInPrompt: z.boolean().optional(),
    /** 読み込んだときの版。送られたときだけ照合する（specs/008 FR-007） */
    expectedVersion: z.number().int().optional(),
  })
  .refine((v) => v.memo !== undefined || v.includeInPrompt !== undefined, { message: "nothing to update" });
/** PATCH /performance/:draftId/feedback のリクエスト（specs/006）。 */
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

/** PATCH /performance/:draftId/feedback のレスポンスのスキーマ。 */
export const feedbackResponseSchema = z.object({
  item: performanceItemSchema,
  /** 次のプロンプトに入る低調の投稿（最大5件） */
  promptIds: z.array(z.string()),
});
/** PATCH /performance/:draftId/feedback のレスポンス（specs/006）。 */
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;

/** GET /performance/export のクエリのスキーマ。 */
export const exportQuerySchema = z.object({
  kind: z.enum(["posts", "snapshots"]),
  before: z.string().max(200).optional(),
});

/** 書き出しの「投稿ごと」の1行（contracts/csv.md）。日時はISOの文字列（UTC）。CSVの整形はWebで行う。 */
export const postExportRowSchema = z.object({
  id: z.string(),
  publishedAt: z.string(),
  body: z.string(),
  metrics: metricsSchema.nullable(),
  ratio: z.number().nullable(),
  state: metricsStateSchema,
  judgment: judgmentSchema.nullable(),
  permalink: z.string().nullable(),
  lastFetchedAt: z.string().nullable(),
  lastElapsedMinutes: z.number().int().nullable(),
  followersAtPost: z.number().int().nullable(),
  h24: metricsSchema.nullable(),
  batchId: z.string(),
  batchPosition: z.number().int(),
  batchCreatedAt: z.string(),
  approvedAt: z.string().nullable(),
  prioritized: z.boolean().nullable(),
  carryover: z.boolean().nullable(),
  /** 登録の後に本文を直したか。不明は null */
  bodyEdited: z.boolean().nullable(),
  slotMinute: z.number().int().nullable(),
  strategyUpdatedAt: z.string().nullable(),
  promotionsChangedAt: z.string().nullable(),
  researchChangedAt: z.string().nullable(),
  coreRulesChangedAt: z.string().nullable(),
});
/** 書き出しの「投稿ごと」の1行（specs/006）。 */
export type PostExportRow = z.infer<typeof postExportRowSchema>;

/** 書き出しの「取り込みごと」の1行（contracts/csv.md）。 */
export const snapshotExportRowSchema = z.object({
  id: z.string(),
  publishedAt: z.string(),
  fetchedAt: z.string(),
  elapsedMinutes: z.number().int(),
  kind: metricsKindSchema,
  method: metricsMethodSchema,
  metrics: metricsSchema,
  followersOnDay: z.number().int().nullable(),
});
/** 書き出しの「取り込みごと」の1行（specs/006）。 */
export type SnapshotExportRow = z.infer<typeof snapshotExportRowSchema>;

/** GET /performance/export のレスポンスのスキーマ。 */
export const exportPageSchema = z.object({
  rows: z.union([z.array(postExportRowSchema), z.array(snapshotExportRowSchema)]),
  nextCursor: z.string().nullable(),
  generatedAt: z.string(),
});
/** GET /performance/export のレスポンス（specs/006）。 */
export type ExportPage = z.infer<typeof exportPageSchema>;

// ---- チーム運用（specs/011-team-revision contracts/api.md）----

/** 見ている人のチーム（入っているチームの id・名前・自分のロール）。 */
const accessTeamSchema = z.object({ id: z.string(), name: z.string(), myRole: teamRoleSchema });

/** GET /api/accounts/:id/access の応答のスキーマ（contracts/permissions.md「画面での出し分け」）。 */
export const accountAccessResponseSchema = z.object({
  relation: relationSchema,
  permissions: z.array(permissionSchema),
  owner: z.object({ name: z.string() }),
  /** このアカウントがチームに入っているか（操作の記録を書くか） */
  hasTeam: z.boolean(),
  /** このアカウントが入っているチームと、見ている人のロール。入っていなければNULL */
  team: accessTeamSchema.nullable(),
  /** 担当の知らせ「（アカウント名）の担当になりました」を出すか（担当の人で、まだ閉じていない。research.md R9） */
  assignedNotice: z.boolean(),
});
/** Accountとの関わりと権限（画面の出し分けに使う）。 */
export type AccountAccessResponse = z.infer<typeof accountAccessResponseSchema>;

/** チーム名（前後の空白を除いて1〜50文字。FR-010）。 */
export const teamNameSchema = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => countChars(v) >= 1 && countChars(v) <= TEAM_NAME_MAX, { message: "1-50 chars" });

/** POST /api/teams のリクエスト（自分がオーナーのアカウントを1つ以上。0件はサービスで TEAM_NEEDS_ACCOUNT）。 */
export const teamCreateRequestSchema = z.object({
  name: teamNameSchema,
  accountIds: z.array(z.string().uuid()).max(TEAM_MEMBER_LIMIT),
});
/** POST /api/teams の応答。 */
export const teamCreateResponseSchema = z.object({ teamId: z.string() });

/** PATCH /api/teams/:teamId のリクエスト。 */
export const teamRenameRequestSchema = z.object({ name: teamNameSchema });

/** GET /api/teams/:teamId のメンバーの行のアカウント。開けないアカウントは名前だけ。 */
export const teamMemberAccountSchema = z.object({
  id: z.string(),
  /** アカウントの名前（specs/012） */
  name: z.string(),
  /** チームのアカウントはつないだものだけだが、型は NULL を許す（specs/012 research.md R7） */
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  /** オーナーが「チームに見せる」にしているか */
  shared: z.boolean(),
  /** 見ている人がこのアカウントを開けるか（オーナー・担当・見せている） */
  canOpen: z.boolean(),
  /** 見ている人の関わり（開けなければNULL）。owner・assigned は Account の画面、shared_viewer は読むだけの画面で開く */
  relation: relationSchema.nullable(),
});
/** GET /api/teams/:teamId のメンバーの行。 */
export const teamMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: teamRoleSchema,
  isMe: z.boolean(),
  joinedAt: z.string(),
  /** 見ている人が管理者で、閉じていない参加の知らせのときだけ true */
  joinedNotice: z.boolean(),
  accounts: z.array(teamMemberAccountSchema),
});
/** チームのメンバーの行。 */
export type TeamMember = z.infer<typeof teamMemberSchema>;

/** GET /api/teams/:teamId の応答（contracts/api.md「GET /api/teams/:teamId の応答」）。 */
export const teamDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  myRole: teamRoleSchema,
  admin: z.object({ userId: z.string(), name: z.string() }),
  members: z.array(teamMemberSchema),
  limits: z.object({ members: z.number().int(), editors: z.number().int() }),
});
/** チームの詳細。 */
export type TeamDetail = z.infer<typeof teamDetailSchema>;

/** GET /api/teams/:teamId/invite の応答。 */
export const teamInviteSchema = z.object({ url: z.string(), rotatedAt: z.string() });
/** チームの招待リンク。 */
export type TeamInvite = z.infer<typeof teamInviteSchema>;

/** PATCH /api/teams/:teamId/members/:userId のリクエスト（管理者は切り替えられない）。 */
export const teamRoleUpdateSchema = z.object({ role: z.enum(["member", "editor"]) });

/** POST /api/teams/:teamId/leave のリクエスト（管理者は引き継ぐ人が必須）。 */
export const teamLeaveRequestSchema = z.object({ newAdminUserId: z.string().uuid().optional() });

/** POST /api/teams/:teamId/admin のリクエスト（抜けずに引き継ぐ）。 */
export const teamAdminTransferSchema = z.object({ userId: z.string().uuid() });

/** POST /api/teams/:teamId/accounts のリクエスト（自分のアカウントを足す）。 */
export const teamAccountAddSchema = z.object({ accountId: z.string().uuid(), shared: z.boolean().optional() });

/** PATCH /api/teams/:teamId/accounts/:accountId のリクエスト（チームに見せる）。 */
export const teamShareUpdateSchema = z.object({ shared: z.boolean() });

/** GET /api/teams/:teamId/assignments の応答（担当の表）。 */
export const teamAssignmentsSchema = z.object({
  /** 列：チームのアカウント */
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      username: z.string().nullable(),
      displayName: z.string().nullable(),
      profilePictureUrl: z.string().nullable(),
      ownerUserId: z.string(),
      ownerName: z.string(),
    }),
  ),
  /** 行：編集者と管理者 */
  people: z.array(
    z.object({ userId: z.string(), name: z.string(), role: teamRoleSchema, isMe: z.boolean(), accountIds: z.array(z.string()) }),
  ),
});
/** 担当の表。 */
export type TeamAssignments = z.infer<typeof teamAssignmentsSchema>;

/** 招待リンクを開いた人の状態（contracts/api.md「GET /api/invites/:token」）。 */
export const inviteViewerStatusSchema = z.enum(["anonymous", "needs_account", "needs_connection", "ready", "already_member"]);

/** GET /api/invites/:token の応答。 */
export const invitePreviewSchema = z.object({
  team: z.object({ name: z.string(), adminName: z.string(), memberCount: z.number().int() }),
  viewer: z.object({
    status: inviteViewerStatusSchema,
    /** already_member のとき、開くチーム */
    teamId: z.string().nullable(),
    /** ready のとき、選べる自分のアカウント。ほかのチームに入っていれば、そのチーム名 */
    accounts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        displayName: z.string().nullable(),
        username: z.string().nullable(),
        profilePictureUrl: z.string().nullable(),
        /** Threadsにつないでいるか。未接続は選べない（specs/012 FR-050） */
        connected: z.boolean(),
        inOtherTeam: z.string().nullable(),
      }),
    ),
  }),
});
/** 招待の確認画面の情報。 */
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/** POST /api/invites/:token/accept のリクエスト（0件はサービスで TEAM_NEEDS_ACCOUNT）。 */
export const inviteAcceptRequestSchema = z.object({
  accounts: z.array(z.object({ id: z.string().uuid(), shared: z.boolean() })).max(TEAM_MEMBER_LIMIT),
});
/** POST /api/invites/:token/accept の応答。 */
export const inviteAcceptResponseSchema = z.object({ teamId: z.string() });

/** GET /api/accounts/:id/team の応答（009のカードを改めた。specs/011 FR-055）。 */
export const accountTeamSchema = z.object({
  /** このアカウントが入っているチーム。入っていなければNULL */
  team: z
    .object({ id: z.string(), name: z.string(), admin: z.object({ userId: z.string(), name: z.string() }), shared: z.boolean() })
    .nullable(),
  /** Accountのオーナー */
  owner: z.object({ userId: z.string(), name: z.string() }),
  /** 要求したユーザー（カードの「あなた」の印に使う） */
  viewerUserId: z.string(),
  /** このアカウントの担当の人（編集者・自分を担当にした管理者） */
  assignees: z.array(z.object({ userId: z.string(), name: z.string(), role: teamRoleSchema })),
});
/** このアカウントのチーム（チーム・オーナー・担当の人）。 */
export type AccountTeam = z.infer<typeof accountTeamSchema>;

/** 操作の記録の種類のスキーマ（specs/008 FR-052）。 */
export const activityKindSchema = z.enum(["review", "draft", "content", "settings", "member"]);
/** GET /api/accounts/:id/activity のクエリのスキーマ。 */
export const activityQuerySchema = z.object({
  // カンマ区切りで複数を選べる（画面の「設定・戦略」は content と settings。PR #9 のCodexレビュー）
  kind: z
    .string()
    .max(100)
    .transform((s) => [...new Set(s.split(",").filter(Boolean))])
    .pipe(z.array(activityKindSchema).min(1))
    .optional(),
  actor: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
/** 操作の記録の1行。 */
export const activityItemSchema = z.object({
  id: z.string(),
  at: z.string(),
  actor: z.object({ userId: z.string().nullable(), name: z.string(), role: actorRoleSchema }),
  kind: activityKindSchema,
  action: z.string(),
  itemCount: z.number().int(),
  summary: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
});
/** 操作の記録の1行。 */
export type ActivityItem = z.infer<typeof activityItemSchema>;
/** GET /api/accounts/:id/activity の応答（contracts/api.md「操作の記録」）。 */
export const activityListSchema = z.object({
  items: z.array(activityItemSchema),
  actors: z.array(z.object({ userId: z.string(), name: z.string(), role: actorRoleSchema })),
  nextCursor: z.string().nullable(),
});
/** 操作の記録の一覧。 */
export type ActivityList = z.infer<typeof activityListSchema>;
