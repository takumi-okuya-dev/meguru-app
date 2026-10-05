// APIの入出力スキーマ（contracts/api.md「型」）。WebとAPIで共有する。
import { z } from "zod";
import { ERROR_CODES } from "./errors";
import {
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
} from "./limits";
import { REJECT_REASON_CODES } from "./review";
import { isValidYmd } from "./promotions";
import { PLANS } from "./plans";
import { STRATEGY_TEXT_KEYS, TONE_PRESET_VALUES, type StrategyTextKey } from "./strategy";
import { countChars, isBlank, isHttpUrl } from "./text";

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
  /** Threads連携の公開範囲（specs/002 FR-028）。testers の間は、アカウント追加画面に検証期間の案内を出す */
  threadsAccessMode: z.enum(["testers", "public"]),
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

/** 宣伝投稿の割合（レスポンス）のスキーマ。 */
export const promotionSettingsSchema = promotionSettingsInputSchema.extend({ canEdit: z.boolean() });
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

/** 下書きの状態のスキーマ（要確認・承認済み・却下。specs/004-review-approval data-model.md）。 */
export const postDraftStatusSchema = z.enum(["needs_review", "approved", "rejected"]);
/** 下書きの状態。 */
export type PostDraftStatus = z.infer<typeof postDraftStatusSchema>;

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
  createdAt: z.string(),
  updatedAt: z.string(),
});
/** 下書き（レスポンス）。 */
export type PostDraft = z.infer<typeof postDraftSchema>;

/** 状態ごとの下書きの件数のスキーマ（GET /post-drafts/counts）。 */
export const draftCountsSchema = z.object({
  needsReview: z.number().int(),
  approved: z.number().int(),
  rejected: z.number().int(),
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

/** GET /post-drafts のレスポンスのスキーマ（004で3つの状態を返す形にした）。 */
export const postDraftListSchema = z.object({
  /** 登録のまとまりの新しい順 → position の昇順 */
  needsReview: z.array(postDraftSchema),
  /** reviewedAt の新しい順 */
  approved: z.array(postDraftSchema),
  /** reviewedAt の新しい順に最大500件 */
  rejected: z.array(postDraftSchema),
  counts: draftCountsSchema,
  limits: z.object({ needsReview: z.number().int(), approved: z.number().int() }),
  /** そのAccountのNGワード（古い順） */
  ngWords: z.array(ngWordSchema),
  /** そのAccountで、プロンプトの生成（grower機能）を使えるか */
  canGeneratePrompt: z.boolean(),
  /** 保存済みの作る件数 */
  promptPostCount: z.number().int(),
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

/** POST /post-drafts/review のリクエストのスキーマ（004 contracts/api.md、research.md R2）。 */
export const reviewRequestSchema = z
  .object({
    action: z.enum(["approve", "reject", "reopen"]),
    /** 操作ごとのID。同じ操作の再試行では同じ値を送り、自分の再試行だけを成功として扱う（research.md R2） */
    requestId: z.string().uuid(),
    items: z
      .array(z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive() }))
      .min(1)
      .max(REVIEW_MAX_ITEMS),
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

/** 作る件数のスキーマ（PUT /prompt-settings のリクエストとレスポンス）。 */
export const promptSettingsSchema = z.object({
  postCount: z.number().int().min(PROMPT_COUNT_MIN).max(PROMPT_COUNT_MAX),
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
