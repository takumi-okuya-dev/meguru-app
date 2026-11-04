// APIの入出力スキーマ（contracts/api.md「型」）。WebとAPIで共有する。
import { z } from "zod";
import { ERROR_CODES } from "./errors";
import { FEATURE_EVENT_ACTIONS, FEATURES } from "./features";
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
  TEST_GROUP_CAPACITY_MAX,
  TEST_GROUP_CAPACITY_MIN,
  TEST_GROUP_NAME_MAX,
  TEAM_NAME_MAX,
  REFERENCE_BATCH_MAX,
  EXPLAIN_BATCH_MAX,
  KEYWORD_BATCH_MAX,
  REFERENCE_AUTHOR_MAX,
  REFERENCE_MEMO_MAX,
  REFERENCE_METRIC_MAX,
  POST_LENGTH_TARGET_MIN,
  POST_LENGTH_TARGET_MAX,
  POST_LENGTH_TARGET_STEP,
  POST_KIND_LENGTH_MIN,
  POST_KIND_LENGTH_MAX,
  POST_KIND_LENGTH_STEP,
  POST_KIND_RATIO_STEP,
  ANALYSIS_CLASSIFY_BATCH,
  ANALYSIS_THEME_NAME_MAX,
  ANALYSIS_THEMES_MAX,
} from "./limits";
import { REJECT_REASON_CODES } from "./review";
import { OPENING_TYPES } from "./analysis/types";
import { IMAGE_STYLES, LISTING_STATUSES, MEDIA } from "./media/types";
import { EVENT_FORMATS, isEventDateTime, PREFECTURES } from "./promotion-event";
import { isValidYmd, jstToday } from "./promotions";
import { FRESHNESS_VALUES, POSTED_DATE_MODE_VALUES, REFERENCE_PLATFORM_VALUES } from "./research";
import { PURPOSE_KEYS, STRATEGY_TEXT_KEYS, TONE_PRESET_VALUES, type PurposeKey, type StrategyTextKey } from "./strategy";
import { countChars, isBlank, isHttpUrl, normalizeKeyword } from "./text";

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
export const permissionSchema = z.enum(["read", "view", "content", "review", "settings", "activity", "owner", "remove"]);
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
  /** オーナーとして持てるアカウントの数。null は上限なし、0 は作れない（specs/013 research.md R9） */
  max: z.number().int().nullable(),
  used: z.number().int(),
});
/** ユーザーの登録数上限（max）と、ownerとして保有するAccount数（used）。 */
export type AccountLimit = z.infer<typeof accountLimitSchema>;

/** 利用者の使える状態（specs/013 research.md R1）。 */
export const billingStateSchema = z.enum([
  "billing_disabled",
  "exempt",
  "trial",
  "subscribed_trial",
  "active",
  "canceling",
  "read_only",
]);
/** 読むだけの理由。 */
export const readOnlyReasonSchema = z.enum(["trial_ended", "payment_failed", "canceled", "test_access"]);

/** /api/me の、使える状態。 */
export const meBillingSchema = z.object({
  mode: z.enum(["enabled", "disabled"]),
  state: billingStateSchema,
  readOnlyReason: readOnlyReasonSchema.nullable(),
  /** 無料体験の終わる時刻（ISO 8601） */
  trialEndsAt: z.string(),
  /** 無料体験の残りの日数（state が trial のときだけ。日本時間の日付で数え、終わる日を含まない） */
  trialDaysLeft: z.number().int().nullable(),
});
/** /api/me の、使える状態。 */
export type MeBilling = z.infer<typeof meBillingSchema>;

/** 「契約と支払い」の内容（GET /api/billing。specs/013 contracts/api.md「BillingSummary」）。 */
export const billingSummarySchema = z.object({
  mode: z.enum(["enabled", "disabled"]),
  state: billingStateSchema,
  readOnlyReason: readOnlyReasonSchema.nullable(),
  trialEndsAt: z.string().nullable(),
  trialDaysLeft: z.number().int().nullable(),
  ownedAccountCount: z.number().int().nullable(),
  subscription: z
    .object({
      status: z.string().nullable(),
      currentPeriodEnd: z.string().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      nextInvoiceAt: z.string().nullable(),
      nextInvoiceAmount: z.number().int().nullable(),
    })
    .nullable(),
  prices: z.object({ base: z.number().int(), extra: z.number().int() }),
});
/** 「契約と支払い」の内容。 */
export type BillingSummary = z.infer<typeof billingSummarySchema>;

/** POST /api/billing/checkout・portal の応答。 */
export const billingRedirectSchema = z.object({ url: z.string() });

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
  /**
   * つなぐ方法のうち、画面に出すもの（既定は両方）。
   * App Review を通すまで、または通らなかったときは `token` だけにできる。
   */
  threadsConnectMethods: z.array(connectionMethodSchema).min(1),
  /** 入っているチーム（参加した順。入っていなければ空。specs/011 research.md R5） */
  teams: z.array(meTeamSchema),
  /** 使える状態（帯とアカウントを作る画面に使う。specs/013 contracts/api.md） */
  billing: meBillingSchema,
  /** 退会の途中か（specs/013 research.md R10） */
  withdrawalInProgress: z.boolean(),
  /**
   * テスト用のグループ（specs/016 contracts/api.md「GET /api/me」）。enabled は仕組みがONか、admitted はテスト版に
   * 入れるか（OFFなら常に true）、operator は運営者か（OFFなら常に false）
   */
  testGroups: z.object({ enabled: z.boolean(), admitted: z.boolean(), operator: z.boolean() }),
  /** 運営者か（招待制に関わらない。機能の設定の画面に使う。specs/019 research.md R5） */
  operator: z.boolean(),
  /** 自分の使えるまとまり（人 ∪ グループ。specs/019 contracts/api.md） */
  features: z.array(z.enum(FEATURES)),
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

/**
 * POST /api/threads/complete のリクエスト（セキュリティ監査 run-1）。
 *
 * Threads から戻ってきた `state` と `code` を、**ログイン済みの呼び出し**で渡す。
 * 以前は無認証の `GET /api/threads/callback` が `state` の持ち主をそのまま主体に
 * 持ち上げて接続まで済ませていたので、`state` を作った人が第三者にそれを踏ませると、
 * 踏んだ人の認可が作った人のテナントに記録された。完了をログイン済みにすることで、
 * `state` の `user_id` と Clerk で確かめた呼び出し元が一致することを要求できる。
 */
export const completeConnectRequestSchema = z.object({
  state: z.string().min(1).max(200),
  /** 認可が成功したときの code。利用者が許可しなかったときは入れない。 */
  code: z.string().min(1).max(4096).optional(),
  /**
   * 利用者が許可しなかったときの理由。`state` を渡すのは、元のアカウントの画面へ
   * 戻すため（どのアカウントの接続だったかは `state` の行にしか無い）。
   */
  error: z.literal("THREADS_AUTH_CANCELLED").optional(),
});
/** POST /api/threads/complete のリクエスト。 */
export type CompleteConnectRequest = z.infer<typeof completeConnectRequestSchema>;

/**
 * POST /api/threads/complete の応答。行き先はサーバーが決める
 * （以前 callback が組み立てていたリダイレクト先と同じ判断をそのまま持ってくる）。
 * 必ず `/` で始まる、このアプリの中の相対パス。
 */
export const completeConnectResponseSchema = z.object({ redirectTo: z.string().startsWith("/") });
/** POST /api/threads/complete の応答。 */
export type CompleteConnectResponse = z.infer<typeof completeConnectResponseSchema>;

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

/**
 * PUT /api/accounts/:id/strategy のリクエストのスキーマ。
 * 目的の6キー（specs/014）は省略でき、省略したキーは保存で今の値を残す（FR-054。014の前の画面からの保存）。
 */
export const putStrategyRequestSchema = strategyValuesSchema.extend({
  ...(Object.fromEntries(PURPOSE_KEYS.map((k) => [k, textMax(STRATEGY_TEXT_MAX).optional()])) as Record<
    PurposeKey,
    z.ZodOptional<ReturnType<typeof textMax>>
  >),
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

// 任意の文字（空・NULLは null にする）
const nullableText = (max: number) =>
  z
    .string()
    .nullable()
    .transform((s) => (s === null || s.trim() === "" ? null : s.trim()))
    .refine((s) => s === null || countChars(s) <= max, { message: `max ${max}` });

/** 宣伝内容の「イベントの情報」（specs/021 data-model.md）。 */
export const promotionEventSchema = z
  .object({
    startAt: z.string().refine(isEventDateTime, { message: "YYYY-MM-DDTHH:mm" }),
    endAt: z.string().refine(isEventDateTime, { message: "YYYY-MM-DDTHH:mm" }).nullable().default(null),
    format: z.enum(EVENT_FORMATS),
    venueName: nullableText(100).default(null),
    prefecture: z.enum(PREFECTURES).nullable().default(null),
    address: nullableText(200).default(null),
    building: nullableText(100).default(null),
    station: nullableText(60).default(null),
    capacity: z.number().int().min(1).max(100000).nullable().default(null),
    feeYen: z.number().int().min(0).max(1000000).nullable().default(null),
    feeNote: nullableText(500).default(null),
    cancelPolicy: nullableText(1000).default(null),
    audience: nullableText(300).default(null),
    organizer: nullableText(100).default(null),
  })
  .refine((e) => e.endAt === null || e.endAt >= e.startAt, { message: "endAt before startAt", path: ["endAt"] });

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
  /** イベントの情報（specs/021）。省けば今のまま、null で消す */
  event: promotionEventSchema.nullable().optional(),
});
/** 宣伝内容の入力。 */
export type PromotionInput = z.infer<typeof promotionInputSchema>;

/** PUT /promotions/:id のリクエストのスキーマ。 */
export const updatePromotionRequestSchema = promotionInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});

/** 宣伝内容（レスポンス）のスキーマ。 */
export const promotionSchema = promotionInputSchema.extend({
  event: promotionEventSchema.nullable(),
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

/** 参考投稿の反応の数字1つ（0以上の整数。わからなければ null）。 */
const metricValue = z.number().int().min(0).max(REFERENCE_METRIC_MAX).nullable().default(null);

/** 参考投稿の反応の数字（specs/014 FR-097）。省略した数字は null。 */
export const referenceMetricsSchema = z
  .object({
    likes: metricValue,
    replies: metricValue,
    views: metricValue,
    saves: metricValue,
    reposts: metricValue,
    followers: metricValue,
  })
  .default({ likes: null, replies: null, views: null, saves: null, reposts: null, followers: null });

/** 参考投稿の入力の項目（絞り込みの前。応答・更新のスキーマに広げるため分けておく）。 */
const referencePostFieldsSchema = z.object({
    body: requiredText(REFERENCE_BODY_MAX),
    keyword: textMax(SHORT_TEXT_MAX).default(""),
    postUrl: optionalUrl(URL_MAX),
    whyGood: textMax(REFERENCE_WHY_GOOD_MAX).default(""),
    platform: z.enum(REFERENCE_PLATFORM_VALUES).default("threads"),
    postedDateMode: z.enum(POSTED_DATE_MODE_VALUES).default("unknown"),
    /** YYYY-MM-DD。postedDateMode が exact のときだけ */
    postedDate: z.string().nullable().default(null),
    metrics: referenceMetricsSchema,
    author: textMax(REFERENCE_AUTHOR_MAX).default(""),
    memo: textMax(REFERENCE_MEMO_MAX).default(""),
});

/**
 * 投稿日の選び方と投稿日の組を確かめる（FR-096）。exact なら実在する日付で、今日（日本時間）より後でない。
 * それ以外なら投稿日は null。
 * @param v - 投稿日の選び方と投稿日
 * @param ctx - zod の絞り込みの文脈
 */
function checkPostedDate(v: { postedDateMode: string; postedDate: string | null }, ctx: z.RefinementCtx) {
  if (v.postedDateMode !== "exact") {
    if (v.postedDate !== null) ctx.addIssue({ code: "custom", path: ["postedDate"], message: "only for exact" });
    return;
  }
  if (v.postedDate === null || !isValidYmd(v.postedDate) || v.postedDate > jstToday(new Date())) {
    ctx.addIssue({ code: "custom", path: ["postedDate"], message: "valid past date required" });
  }
}

/**
 * 参考投稿の入力のスキーマ（contracts/api.md の ReferencePostInput。014で媒体・投稿日・数字・投稿者・メモを足した）。
 * 新しい項目はどれも省略でき、省略は既定値（今のクライアントからの追加・編集を壊さない）。
 */
export const referencePostInputSchema = referencePostFieldsSchema.superRefine(checkPostedDate);
/** 参考投稿の入力。 */
export type ReferencePostInput = z.infer<typeof referencePostInputSchema>;
/** 参考投稿の入力の送る形（新しい項目は省略でき、省略は既定値。specs/014）。 */
export type ReferencePostInputBody = z.input<typeof referencePostInputSchema>;

/** PUT /reference-posts/:id のリクエストのスキーマ。 */
export const updateReferencePostRequestSchema = referencePostFieldsSchema
  .extend({ expectedVersion: z.number().int().positive() })
  .superRefine(checkPostedDate);

/** POST /reference-posts/batch のリクエストのスキーマ（specs/014 FR-083）。 */
export const referencePostBatchRequestSchema = z.object({
  items: z.array(referencePostInputSchema).min(1).max(REFERENCE_BATCH_MAX),
});

/** POST /reference-posts/explanations のリクエストのスキーマ（specs/014 FR-104）。同じIDの重なりは拒む。 */
export const explanationsRequestSchema = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), whyGood: requiredText(REFERENCE_WHY_GOOD_MAX) }))
    .min(1)
    .max(EXPLAIN_BATCH_MAX)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, { message: "duplicate id" }),
});

/** POST /reference-posts/explanations のレスポンスのスキーマ。 */
export const explanationsResultSchema = z.object({
  saved: z.array(z.string()),
  skipped: z.array(z.object({ id: z.string(), reason: z.enum(["already_explained", "not_found"]) })),
});
/** まとめての解説の保存の結果。 */
export type ExplanationsResult = z.infer<typeof explanationsResultSchema>;

/** GET /reference-posts/explain-prompt のレスポンスのスキーマ（specs/014 FR-101）。 */
export const explainPromptSchema = z.object({
  prompt: z.string(),
  items: z.array(z.object({ id: z.string(), shortId: z.string() })),
  pendingCount: z.number().int(),
});
/** 解説のプロンプト。 */
export type ExplainPrompt = z.infer<typeof explainPromptSchema>;

/** 参考投稿（レスポンス）のスキーマ。鮮度と、まとめての解説で使う短いID（specs/014 R6・R8）を足す。 */
export const referencePostSchema = referencePostFieldsSchema.extend({
  ...itemMeta,
  freshness: z.enum(FRESHNESS_VALUES),
  shortId: z.string(),
});
/** 参考投稿（レスポンス）。 */
export type ReferencePost = z.infer<typeof referencePostSchema>;

/** POST /reference-posts/batch のレスポンスのスキーマ。 */
export const referencePostBatchResultSchema = z.object({ items: z.array(referencePostSchema) });

/** GET /reference-posts のレスポンスのスキーマ。 */
export const referencePostListSchema = z.object({ items: z.array(referencePostSchema), ...listMeta });

/** キーワードの入力のスキーマ（contracts/api.md の ResearchKeywordInput）。 */
export const researchKeywordInputSchema = z.object({
  keyword: requiredText(SHORT_TEXT_MAX),
  purpose: textMax(SHORT_TEXT_MAX).default(""),
});
/** キーワードの入力。 */
export type ResearchKeywordInput = z.infer<typeof researchKeywordInputSchema>;

/** POST /research-keywords/batch のリクエストのスキーマ（specs/014 FR-092）。 */
export const keywordBatchRequestSchema = z.object({
  items: z
    .array(researchKeywordInputSchema)
    .min(1)
    .max(KEYWORD_BATCH_MAX)
    .superRefine((items, ctx) => {
      // 一覧の中で重なる（正規化して同じ）キーワードは受け付けない
      const seen = new Set<string>();
      items.forEach((item, i) => {
        const key = normalizeKeyword(item.keyword);
        if (seen.has(key)) ctx.addIssue({ code: "custom", message: "duplicate", path: [i, "keyword"] });
        seen.add(key);
      });
    }),
});

/** GET /research-keywords/idea-prompt のレスポンスのスキーマ（specs/014 FR-090）。 */
export const keywordIdeaPromptSchema = z.object({ prompt: z.string() });

/** PUT /research-keywords/:id のリクエストのスキーマ。 */
export const updateResearchKeywordRequestSchema = researchKeywordInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});

/** キーワード（レスポンス）のスキーマ。 */
export const researchKeywordSchema = researchKeywordInputSchema.extend(itemMeta);
/** キーワード（レスポンス）。 */
export type ResearchKeyword = z.infer<typeof researchKeywordSchema>;

/** POST /research-keywords/batch のレスポンスのスキーマ（specs/014 FR-092）。 */
export const keywordBatchResultSchema = z.object({ items: z.array(researchKeywordSchema) });

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
    /** 無料体験の残りの日数（日本時間の日付で数え、終わる日を含まない。無料体験中だけ。specs/013） */
    trialDaysLeft: z.number().int().nullable(),
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
  // billing_inactive：オーナーが読むだけ（specs/013 research.md R8）
  stoppedReason: z.enum(["needs_reconnect", "rate_limited", "not_connected", "billing_inactive"]).nullable(),
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
  /** 含めた伸びた傾向の数（022） */
  trendCount: z.number().int(),
});
/** プロンプトに実際に含めた内容の要約。 */
export type PromptSummary = z.infer<typeof promptSummarySchema>;

/** 1投稿の文字数の目標と、短文・中文・長文の文字数と割合（specs/014 FR-140）。 */
export const postLengthSettingsSchema = z
  .object({
    target: z.number().int().min(POST_LENGTH_TARGET_MIN).max(POST_LENGTH_TARGET_MAX).multipleOf(POST_LENGTH_TARGET_STEP),
    shortLength: z.number().int().min(POST_KIND_LENGTH_MIN).max(POST_KIND_LENGTH_MAX).multipleOf(POST_KIND_LENGTH_STEP),
    mediumLength: z.number().int().min(POST_KIND_LENGTH_MIN).max(POST_KIND_LENGTH_MAX).multipleOf(POST_KIND_LENGTH_STEP),
    longLength: z.number().int().min(POST_KIND_LENGTH_MIN).max(POST_KIND_LENGTH_MAX).multipleOf(POST_KIND_LENGTH_STEP),
    shortRatio: z.number().int().min(0).max(100).multipleOf(POST_KIND_RATIO_STEP),
    mediumRatio: z.number().int().min(0).max(100).multipleOf(POST_KIND_RATIO_STEP),
    longRatio: z.number().int().min(0).max(100).multipleOf(POST_KIND_RATIO_STEP),
  })
  .superRefine((v, ctx) => {
    if (v.shortRatio + v.mediumRatio + v.longRatio !== 100) {
      ctx.addIssue({ code: "custom", path: ["longRatio"], message: "ratio_sum" });
    }
    for (const k of ["shortLength", "mediumLength", "longLength"] as const) {
      if (v[k] > v.target) ctx.addIssue({ code: "custom", path: [k], message: "length_over_target" });
    }
  });
/** 1投稿の文字数の目標と、短文・中文・長文の文字数と割合。 */
export type PostLengthSettings = z.infer<typeof postLengthSettingsSchema>;

/** 「投稿をつくる」の情報の一覧（specs/014 FR-121、research.md R9）。プロンプトを作るときの数え方のまま。 */
export const promptMaterialsSchema = z.object({
  strategy: z.object({
    items: z.array(
      z.object({ key: z.string(), status: z.enum(["empty", "short", "ok"]).nullable(), chars: z.number().int() }),
    ),
    done: z.number().int(),
    review: z.number().int(),
    purposeDone: z.number().int(),
  }),
  drafts: z.object({ profileBio: z.boolean(), pinned: z.array(z.boolean()) }),
  promotions: z.object({ included: z.number().int(), missingCta: z.number().int() }),
  research: z.object({
    total: z.number().int(),
    included: z.number().int(),
    explained: z.number().int(),
    pending: z.number().int(),
  }),
});
/** 「投稿をつくる」の情報の一覧。 */
export type PromptMaterials = z.infer<typeof promptMaterialsSchema>;

/** GET /prompt のレスポンスのスキーマ（014で parts・length・splitRecommended・settings・materials を足した）。 */
export const promptResponseSchema = z.object({
  prompt: z.string(),
  /** 2つに分けて送るときの1つ目と2つ目（FR-152） */
  parts: z.tuple([z.string(), z.string()]),
  count: z.number().int(),
  /** 1つにまとめた全文の文字数（コードポイント） */
  length: z.number().int(),
  /** 2つに分けて送るのをすすめるか（PROMPT_SPLIT_THRESHOLD を超える） */
  splitRecommended: z.boolean(),
  settings: z.object({
    postCount: z.number().int(),
    length: postLengthSettingsSchema,
    version: z.number().int(),
  }),
  summary: promptSummarySchema,
  /** 戦略がOFFなら null（「プロンプトに入っている情報」を出さない。specs/019 FR-007） */
  materials: promptMaterialsSchema.nullable(),
});
/** GET /prompt のレスポンス。 */
export type PromptResponse = z.infer<typeof promptResponseSchema>;

/** 作る件数の保存（PUT /prompt-settings のリクエスト）のスキーマ。読み込んだときの版を送る（specs/008 FR-007、PR #9 のCodexレビュー）。 */
export const putPromptSettingsRequestSchema = z.object({
  postCount: z.number().int().min(PROMPT_COUNT_MIN).max(PROMPT_COUNT_MAX),
  /** 文字数と割合（specs/014 FR-140）。省略なら変えない */
  length: postLengthSettingsSchema.optional(),
  expectedVersion: z.number().int().min(1),
});

/** 作る件数と文字数・割合のスキーマ（PUT /prompt-settings のレスポンス）。 */
export const promptSettingsSchema = z.object({
  postCount: z.number().int().min(PROMPT_COUNT_MIN).max(PROMPT_COUNT_MAX),
  length: postLengthSettingsSchema,
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
  /** オーナーが読むだけなら、その理由（チームの人には owner_inactive だけ。specs/013 FR-045）。すべて使えるなら NULL */
  readOnly: z.object({ reason: z.enum(["trial_ended", "payment_failed", "canceled", "test_access", "owner_inactive"]) }).nullable(),
  /** オーナーの設定でONの機能のまとまり（画面の出し分けに使う。specs/019 contracts/api.md） */
  features: z.array(z.enum(FEATURES)),
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
  /** 運用状況を開けるか（管理者、または同じチーム経由の担当がある編集者。specs/020） */
  statusVisible: z.boolean(),
});
/** チームの詳細。 */
export type TeamDetail = z.infer<typeof teamDetailSchema>;

/** 運用状況の人の行（specs/020 contracts/api.md）。 */
export const teamStatusPersonSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: teamRoleSchema,
  isMe: z.boolean(),
  joinedAt: z.string(),
  lastActiveAt: z.string().nullable(),
  activeCount7d: z.number().int(),
  stopped: z.boolean(),
  /** 記録がなく、入って90日を過ぎている（操作の記録は90日で消える。research.md R2） */
  retentionLimited: z.boolean(),
});
/** 運用状況のアカウントの伸び（research.md R4・R7）。 */
export const teamStatusGrowthSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("metrics_off") }),
  z.object({ state: z.literal("insufficient") }),
  z.object({ state: z.literal("ok"), ratio: z.number(), recentMedian: z.number(), previousMedian: z.number() }),
  z.object({ state: z.literal("poor"), ratio: z.number(), recentMedian: z.number(), previousMedian: z.number() }),
]);
/** 運用状況のアカウントの行。 */
export const teamStatusAccountSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  owner: z.object({ userId: z.string(), name: z.string(), isMe: z.boolean() }),
  connection: z.enum(["connected", "disconnected"]),
  addedAt: z.string(),
  lastPostedAt: z.string().nullable(),
  postCount7d: z.number().int(),
  approvedCount: z.number().int(),
  needsReviewCount: z.number().int(),
  stopped: z.boolean(),
  growth: teamStatusGrowthSchema,
});
/** GET /api/teams/:teamId/status の応答（specs/020 contracts/api.md）。 */
export const teamStatusSchema = z.object({
  scope: z.enum(["all", "assigned"]),
  generatedAt: z.string(),
  /** 止まっている人とアカウントの数（チームの画面のボタンの印） */
  stoppedCount: z.number().int(),
  people: z.array(teamStatusPersonSchema),
  accounts: z.array(teamStatusAccountSchema),
});
/** チームの運用状況。 */
export type TeamStatus = z.infer<typeof teamStatusSchema>;
/** 運用状況のアカウントの伸び。 */
export type TeamStatusGrowth = z.infer<typeof teamStatusGrowthSchema>;

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

/** POST /api/me/withdraw の要求（specs/013 contracts/api.md「自分」）。 */
export const withdrawRequestSchema = z.object({ confirmEmail: z.string().max(320) });

/** GET /api/me/withdrawal-preview の応答（退会の確認の内容）。 */
export const withdrawalPreviewSchema = z.object({
  email: z.string(),
  ownedAccounts: z.array(z.object({ id: z.string(), name: z.string() })),
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isAdmin: z.boolean(),
      outcome: z.enum(["transfer", "delete", "leave"]),
      nextAdminName: z.string().nullable(),
    }),
  ),
  hasActiveSubscription: z.boolean(),
});
/** 退会の確認の内容。 */
export type WithdrawalPreview = z.infer<typeof withdrawalPreviewSchema>;

// ---- テスト用のグループ（specs/016-test-groups contracts/api.md）----

/** GET /api/test-invites/:token の応答。viewer はログインしていなければ null。 */
export const testInvitePreviewSchema = z.object({
  group: z.object({ name: z.string() }),
  /** テスト版（招待制がONの環境）か。false なら、テスト版のための注意を出さない（specs/019 FR-019） */
  testVersion: z.boolean(),
  /** 定員に達しているか */
  full: z.boolean(),
  viewer: z
    .discriminatedUnion("state", [
      z.object({ state: z.literal("can_join") }),
      z.object({ state: z.literal("full") }),
      z.object({ state: z.literal("already_member"), groupName: z.string() }),
    ])
    .nullable(),
});
/** グループの招待の確認。 */
export type TestInvitePreview = z.infer<typeof testInvitePreviewSchema>;

/** POST /api/test-invites/:token/join の応答。 */
export const testInviteJoinResponseSchema = z.object({ groupId: z.string() });

/** グループの記録の種類（data-model.md の test_group_events.action）。 */
export const TEST_GROUP_EVENT_ACTIONS = [
  "created",
  "renamed",
  "capacity_changed",
  "invite_rotated",
  "closed",
  "member_joined",
  "member_removed",
] as const;
/** グループの記録の種類。 */
export type TestGroupEventAction = (typeof TEST_GROUP_EVENT_ACTIONS)[number];

/** 運営者の画面のグループの行。 */
export const testGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  capacity: z.number().int(),
  memberCount: z.number().int(),
  /** 閉じていれば null */
  inviteUrl: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
});
/** 運営者の画面のグループの行。 */
export type TestGroupSummary = z.infer<typeof testGroupSummarySchema>;

/** GET /api/operator/test-groups の応答。 */
export const testGroupListSchema = z.object({ groups: z.array(testGroupSummarySchema) });

/** 運営者の画面のグループの詳しい内容。 */
export const testGroupDetailSchema = testGroupSummarySchema.extend({
  /** グループの設定でOFFのまとまり（specs/019 FR-017） */
  disabled: z.array(z.enum(FEATURES)),
  /** 入っている人（入った順） */
  members: z.array(z.object({ userId: z.string(), name: z.string(), email: z.string(), joinedAt: z.string() })),
  /** 記録（新しい順に TEST_GROUP_EVENTS_LIMIT 件） */
  events: z.array(
    z.object({
      action: z.enum(TEST_GROUP_EVENT_ACTIONS),
      actorName: z.string(),
      subjectName: z.string().nullable(),
      details: z.unknown(),
      createdAt: z.string(),
    }),
  ),
});
/** 運営者の画面のグループの詳しい内容。 */
export type TestGroupDetail = z.infer<typeof testGroupDetailSchema>;

const testGroupName = z.string().trim().min(1).max(TEST_GROUP_NAME_MAX);
const testGroupCapacity = z.number().int().min(TEST_GROUP_CAPACITY_MIN).max(TEST_GROUP_CAPACITY_MAX);

/** POST /api/operator/test-groups のリクエスト。 */
export const testGroupCreateRequestSchema = z.object({ name: testGroupName, capacity: testGroupCapacity });

/** PATCH /api/operator/test-groups/:groupId のリクエスト（少なくとも1つ）。 */
export const testGroupUpdateRequestSchema = z
  .object({ name: testGroupName.optional(), capacity: testGroupCapacity.optional() })
  .refine((v) => v.name !== undefined || v.capacity !== undefined, { message: "nothing to update" });

// ---- 紹介リンク（specs/017-referral-links contracts/api.md） ----

/** GET /api/me/referral の応答。紹介された人が誰かわかるものは入れない（FR-007）。 */
export const referralResponseSchema = z.object({
  /** 本人の紹介リンク（WEB_ORIGIN/r/{code}） */
  url: z.string(),
  /** 本人の紹介で登録した人の数（退会した人は数えない） */
  referredCount: z.number().int().nonnegative(),
});
/** 本人の紹介リンクと人数。 */
export type ReferralResponse = z.infer<typeof referralResponseSchema>;

/** GET /api/referral-page の応答（認証なし）。testGroups はテスト用のグループの仕組みがONか。 */
export const referralPageSchema = z.object({ testGroups: z.boolean() });
/** 紹介リンクの画面に出す注意のための情報。 */
export type ReferralPage = z.infer<typeof referralPageSchema>;

// ---- 機能のまとまりごとのON/OFF（specs/019-feature-switches contracts/api.md「運営者のAPI」） ----

const featureSchema = z.enum(FEATURES);

/** GET /api/operator/users?email= のクエリ（完全一致。前後の空白を除き、大文字・小文字を区別しない）。 */
export const operatorUserQuerySchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) });

/** 運営者の画面の、見つかった人と今の設定（disabled は人の設定、group.disabled はグループの設定。FEATURES の順）。 */
export const operatorUserSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  disabled: z.array(featureSchema),
  /** 入っている閉じていないグループ（入っていなければ null） */
  group: z.object({ id: z.string(), name: z.string(), disabled: z.array(featureSchema) }).nullable(),
});
/** 運営者の画面の、見つかった人と今の設定。 */
export type OperatorUser = z.infer<typeof operatorUserSchema>;

/** PUT /api/operator/feature-settings/:userId のリクエスト（3つすべての値）。 */
export const featureSettingsRequestSchema = z.object({
  features: z.object({ autopost: z.boolean(), strategy: z.boolean(), team: z.boolean() }),
});
/** 機能の設定の保存の値。 */
export type FeatureSettingsRequest = z.infer<typeof featureSettingsRequestSchema>;

/** GET /api/operator/feature-settings の応答（FR-013・FR-014）。 */
export const featureSettingsListSchema = z.object({
  /** OFFのまとまりがある人。updatedAt は、その人の設定を最後に変えた日時（ONに戻した変更も含む）の新しい順 */
  users: z.array(operatorUserSchema.omit({ group: true }).extend({ updatedAt: z.string() })),
  /** 最近の変更（新しい順に FEATURE_EVENTS_LIMIT 件まで） */
  events: z.array(
    z.object({
      feature: featureSchema,
      action: z.enum(FEATURE_EVENT_ACTIONS),
      actorName: z.string(),
      subjectName: z.string(),
      /** 人の設定の変更か、グループの設定の変更か */
      subjectKind: z.enum(["user", "group"]),
      createdAt: z.string(),
    }),
  ),
});
/** 運営者の画面の、OFFの人の一覧と最近の変更。 */
export type FeatureSettingsList = z.infer<typeof featureSettingsListSchema>;

// ---- 外部媒体展開（specs/021-external-media contracts/api.md）----

/** 媒体。 */
export const mediaSchema = z.enum(MEDIA);
/** 掲載の状況。 */
export const listingStatusSchema = z.enum(LISTING_STATUSES);
/** 自動で直した内容。 */
export const listingFixSchema = z.object({ field: z.string(), excerpt: z.string(), reason: z.string() });

/** GET /api/accounts/:accountId/external-media の応答。 */
export const externalMediaListSchema = z.object({
  promotions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      version: z.number().int(),
      event: promotionEventSchema.nullable(),
      listings: z.array(z.object({ media: mediaSchema, status: listingStatusSchema, postedUrl: z.string().nullable() })),
    }),
  ),
  canEdit: z.boolean(),
});
/** 外部媒体展開の一覧。 */
export type ExternalMediaList = z.infer<typeof externalMediaListSchema>;

/** 媒体ごとの掲載内容と状況。 */
export const listingSchema = z.object({
  status: listingStatusSchema,
  postedUrl: z.string().nullable(),
  imageStyle: z.enum(IMAGE_STYLES),
  fields: z.record(z.string(), z.string()).nullable(),
  fixes: z.array(listingFixSchema),
  generatedAt: z.string().nullable(),
  sourceVersion: z.number().int().nullable(),
  version: z.number().int().nullable(),
});
/** 掲載内容と状況。 */
export type Listing = z.infer<typeof listingSchema>;

/** GET /api/accounts/:accountId/external-media/:promotionId/:media の応答。 */
export const listingDetailSchema = z.object({
  promotion: promotionSchema,
  media: mediaSchema,
  listing: listingSchema,
  defaults: z.record(z.string(), z.string()),
  sourceChanged: z.boolean(),
  canEdit: z.boolean(),
});
/** 入力の画面の中身。 */
export type ListingDetail = z.infer<typeof listingDetailSchema>;

/** POST …/generate のリクエスト。 */
export const listingGenerateRequestSchema = z.object({ expectedVersion: z.number().int().positive().nullable() });

/** PUT …/:media のリクエスト（欄の key と上限は、APIが媒体の決まりで確かめる）。 */
export const listingUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive().nullable(),
  status: listingStatusSchema.optional(),
  postedUrl: z
    .string()
    .nullable()
    .optional()
    .refine((s) => s === undefined || s === null || s === "" || (countChars(s) <= URL_MAX && isHttpUrl(s)), { message: "http(s) url" }),
  imageStyle: z.enum(IMAGE_STYLES).optional(),
  fields: z.record(z.string(), z.string()).optional(),
});
/** 掲載内容の保存のリクエスト。 */
export type ListingUpdateRequest = z.infer<typeof listingUpdateRequestSchema>;

/** 媒体の既定値（1つの媒体）。 */
export const mediaDefaultsSchema = z.object({
  media: mediaSchema,
  values: z.record(z.string(), z.string()),
  version: z.number().int().nullable(),
});
/** GET /api/accounts/:accountId/media-defaults の応答。 */
export const mediaDefaultsListSchema = z.object({ items: z.array(mediaDefaultsSchema), canEdit: z.boolean() });
/** PUT /api/accounts/:accountId/media-defaults/:media のリクエスト。 */
export const mediaDefaultsUpdateSchema = z.object({
  expectedVersion: z.number().int().positive().nullable(),
  values: z.record(z.string(), z.string().max(500)),
});

// ---- アルゴリズムの解析（specs/022-algorithm-analysis contracts/api.md）----

/** テーマのid（`t`＋英数字）。 */
export const ANALYSIS_THEME_ID_PATTERN = /^t[0-9a-z]{1,8}$/;
const themeIdSchema = z.string().regex(ANALYSIS_THEME_ID_PATTERN);
/** 書き出しの型のスキーマ。 */
export const openingTypeSchema = z.enum(OPENING_TYPES);
const themeSchema = z.object({ id: themeIdSchema, name: z.string() });

/** GET …/analysis のクエリ。 */
export const analysisQuerySchema = z.object({ scope: z.enum(["all", "regular"]).default("all") });
/** 解析の範囲（すべて・ふだんの投稿）。 */
export type AnalysisScope = z.infer<typeof analysisQuerySchema>["scope"];

/** テーマの一覧の入力（10個まで、名前は前後の空白を除いて1〜20文字、重ならない。data-model.md）。 */
export const analysisThemesSchema = z
  .array(
    z.object({
      id: themeIdSchema.optional(),
      name: z
        .string()
        .transform((s) => s.trim())
        .refine((s) => countChars(s) >= 1 && countChars(s) <= ANALYSIS_THEME_NAME_MAX, { message: `1-${ANALYSIS_THEME_NAME_MAX}` }),
    }),
  )
  .max(ANALYSIS_THEMES_MAX)
  .superRefine((items, ctx) => {
    const names = new Set<string>();
    const ids = new Set<string>();
    items.forEach((t, i) => {
      if (names.has(t.name)) ctx.addIssue({ code: "custom", path: [i, "name"], message: "duplicate" });
      names.add(t.name);
      if (t.id) {
        if (ids.has(t.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "duplicate" });
        ids.add(t.id);
      }
    });
  });

/** 解析の設定（応答）。`version` が null＝まだ保存していない（初めの値）。 */
export const analysisSettingsSchema = z.object({
  trendsInPrompt: z.boolean(),
  themes: z.array(themeSchema),
  version: z.number().int().nullable(),
});
/** 解析の設定。 */
export type AnalysisSettings = z.infer<typeof analysisSettingsSchema>;

/** PATCH …/analysis/settings のリクエスト。 */
export const analysisSettingsRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive().nullable(),
    trendsInPrompt: z.boolean().optional(),
    themes: analysisThemesSchema.optional(),
  })
  .refine((v) => v.trendsInPrompt !== undefined || v.themes !== undefined, { message: "nothing to update" });
/** 解析の設定の保存のリクエスト。 */
export type AnalysisSettingsRequest = z.infer<typeof analysisSettingsRequestSchema>;
/** PATCH …/analysis/settings の応答。 */
export const analysisSettingsResponseSchema = z.object({ settings: analysisSettingsSchema });

const bucketMarkSchema = z.enum(["few", "untried"]).nullable();
const bucketRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int(),
  views: z.number().nullable(),
  engagementRate: z.number().nullable(),
  replyRate: z.number().nullable(),
  mark: bucketMarkSchema,
});
const sideSchema = z.object({ count: z.number().int(), views: z.number().nullable() });
const compareSchema = z.object({
  count: z.number().int(),
  firstSpeed: z.number().nullable(),
  laterGrowth: z.number().nullable(),
  replyRate: z.number().nullable(),
  length: z.number().nullable(),
  questionCount: z.number().int(),
});

/** GET …/analysis の応答。 */
export const analysisResponseSchema = z.object({
  period: z.object({ from: z.string(), to: z.string(), days: z.number().int() }),
  scope: z.enum(["all", "regular"]),
  totals: z.object({
    confirmed: z.number().int(),
    promo: z.number().int(),
    withFollowers: z.number().int(),
    classified: z.number().int(),
  }),
  needMore: z.number().int().nullable(),
  trends: z.array(
    z.object({
      dimension: z.enum(["time", "day", "length", "feature", "opening", "theme"]),
      key: z.string(),
      text: z.string(),
      count: z.number().int(),
      views: z.number(),
      otherCount: z.number().int(),
      otherViews: z.number(),
      ratio: z.number(),
      promptable: z.boolean(),
    }),
  ),
  time: z.array(bucketRowSchema),
  day: z.array(bucketRowSchema),
  length: z.array(bucketRowSchema),
  features: z.array(
    z.object({ key: z.string(), label: z.string(), with: sideSchema, without: sideSchema, ratio: z.number().nullable(), mark: bucketMarkSchema }),
  ),
  opening: z.array(bucketRowSchema),
  theme: z.array(bucketRowSchema),
  recommended: z.object({
    available: z.boolean(),
    posts: z.array(
      z.object({
        id: z.string(),
        head: z.string(),
        publishedAt: z.string(),
        views: z.number(),
        spread: z.number(),
        firstSpeed: z.number().nullable(),
        laterGrowth: z.number().nullable(),
        replyRate: z.number().nullable(),
      }),
    ),
    compare: z.object({ recommended: compareSchema, others: compareSchema }).nullable(),
  }),
  schedule: z.object({ slotTimes: z.array(z.string()) }),
  settings: analysisSettingsSchema,
  canEdit: z.boolean(),
});
/** 解析の画面のデータ。 */
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

/** GET …/analysis/classifications のクエリ。 */
export const classificationsQuerySchema = z.object({ mode: z.enum(["unclassified", "classified"]).default("unclassified") });

/** GET …/analysis/classifications の応答。 */
export const classificationsResponseSchema = z.object({
  posts: z.array(
    z.object({
      draftId: z.string(),
      body: z.string(),
      publishedAt: z.string(),
      openingType: openingTypeSchema.nullable(),
      themeId: z.string().nullable(),
    }),
  ),
  remaining: z.number().int(),
  themes: z.array(themeSchema),
});
/** 分類する投稿の一覧。 */
export type ClassificationsResponse = z.infer<typeof classificationsResponseSchema>;

/** PUT …/analysis/classifications のリクエスト（1〜50件）。 */
export const classificationsRequestSchema = z.object({
  source: z.enum(["ai", "manual"]),
  items: z
    .array(z.object({ draftId: z.string().uuid(), openingType: openingTypeSchema, themeId: themeIdSchema.nullable() }))
    .min(1)
    .max(ANALYSIS_CLASSIFY_BATCH),
});
/** 分類の保存のリクエスト。 */
export type ClassificationsRequest = z.infer<typeof classificationsRequestSchema>;
/** PUT …/analysis/classifications の応答。 */
export const classificationsSaveResponseSchema = z.object({ saved: z.number().int(), skipped: z.array(z.string()) });
