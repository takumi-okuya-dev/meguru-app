// DBスキーマ（specs/001-login-account-setup/data-model.md）。
// Accountに紐づくテーブルはすべて ON DELETE CASCADE とする（後続featureも守る規約。research.md R13）。
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  primaryKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  FEATURE_EVENT_ACTIONS,
  FEATURES,
  POST_LENGTH_DEFAULTS,
  PROMOTION_RATIO_DEFAULT,
  PROMPT_COUNT_DEFAULT,
  REJECT_REASON_CODES,
  SUBSCRIPTION_STATUSES,
  TEST_GROUP_CAPACITY_MAX,
  TEST_GROUP_CAPACITY_MIN,
  TEST_GROUP_EVENT_ACTIONS,
  TEST_GROUP_NAME_MAX,
} from "@threads-grower/shared";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array | string }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    if (value instanceof Uint8Array) return value;
    // node-postgres / neon は bytea を "\\x..." の16進文字列で返すことがある
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  },
  toDriver(value) {
    return value;
  },
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Membershipのロールの列挙型（membership_role。Constitution原則IV）。
 * partner・editor は specs/008-team-operations で足した。member は旧プラン4の名残で使わない（列挙型から値は消せないので残す）。
 */
export const membershipRole = pgEnum("membership_role", ["owner", "member", "partner", "editor", "admin"]);
/** チームでのロール（specs/011 data-model.md の team_role）。 */
export const teamRole = pgEnum("team_role", ["admin", "member", "editor"]);
/** Threads接続の状態の列挙型（connection_status）。not_connected は一度もつないでいない（specs/012 data-model.md）。 */
export const connectionStatus = pgEnum("connection_status", ["connected", "needs_reconnect", "not_connected"]);
/** 今の接続の方法（specs/010-token-account-add data-model.md）。app は001のOAuth、token は利用者のMetaアプリのトークン。 */
export const connectionMethod = pgEnum("connection_method", ["app", "token"]);
/**
 * 接続フローの種類の列挙型（oauth_mode）。connect は未接続のアカウントにはじめてつなぐ（specs/012 research.md R4）。
 * new（つないでアカウントを作る）は使わない（列挙型から値は消せないので残す）。
 */
export const oauthMode = pgEnum("oauth_mode", ["new", "reconnect", "connect"]);
/** Metaのデータ削除要求の進み具合の列挙型（deletion_status）。 */
export const deletionStatus = pgEnum("deletion_status", ["pending", "completed", "failed"]);

/** アプリを使う個人。Clerk のユーザーと1対1で対応する（data-model.md の users）。 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  lastAccountId: uuid("last_account_id").references((): AnyPgColumn => accounts.id, { onDelete: "set null" }),
  lastAccountDeletedAt: timestamp("last_account_deleted_at", { withTimezone: true }),
  lastAccountClientId: text("last_account_client_id"),
  lastAccountOpenSeq: bigint("last_account_open_seq", { mode: "number" }),
  lastAccountOpenReceivedAt: timestamp("last_account_open_received_at", { withTimezone: true, precision: 6 }),
  // 料金なしの印（specs/013 data-model.md）。運用のスクリプトだけが変える
  billingExempt: boolean("billing_exempt").notNull().default(false),
  // 退会を受け付けた時刻。退会が終わると行ごと消えるので、残っていれば「途中」（specs/013 research.md R10）
  withdrawalRequestedAt: timestamp("withdrawal_requested_at", { withTimezone: true }),
  // テスト用のグループの仕組みがOFFの間に登録した（またはこの機能の前からいた）。true ならグループに
  // 入っていなくてもテスト版に入れる（specs/016 data-model.md、research.md R2）。既定は true にして、列を足してから
  // 新しいAPIに替わるまでの間に古いAPIが作った人も締め出さない。新しいAPIは作るときに必ず値を渡す
  signedUpOpen: boolean("signed_up_open").notNull().default(true),
  // 紹介リンク（specs/017 data-model.md）。本人の紹介の文字列は、設定の「紹介」を初めて開いたときに入れ、変えない
  referralCode: text("referral_code").unique(),
  // この人を紹介した人。行を作るとき（JIT作成）だけ入れ、あとから変えない。紹介した人が退会したら NULL
  referredByUserId: uuid("referred_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  referredAt: timestamp("referred_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("users_referred_by_idx").on(t.referredByUserId),
  check("users_not_self_referred", sql`${t.referredByUserId} <> ${t.id}`),
]);

/**
 * Threadsアカウント1件に対応する運用単位（data-model.md の accounts）。
 * 名前だけで作り、Threadsには後でつなぐ。未接続の間は threads_user_id・username・connection_method が NULL（specs/012 data-model.md）。
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // アカウントの名前（specs/012 research.md R2）。主に出す名前
  name: text("name").notNull(),
  threadsUserId: text("threads_user_id").unique(),
  username: text("username"),
  displayName: text("display_name"),
  profilePictureUrl: text("profile_picture_url"),
  connectionStatus: connectionStatus("connection_status").notNull().default("connected"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, precision: 6 }),
  connectionGeneration: bigint("connection_generation", { mode: "number" }).notNull().default(0),
  // 宣伝投稿の割合（specs/002-strategy-profile data-model.md、research.md R7）
  promotionRatioPercent: smallint("promotion_ratio_percent").notNull().default(PROMOTION_RATIO_DEFAULT),
  // プロンプトで作る件数（specs/003-prompt-bulk-register data-model.md、research.md R11）
  promptPostCount: smallint("prompt_post_count").notNull().default(PROMPT_COUNT_DEFAULT),
  // 投稿ルール（CORE RULES。specs/004-review-approval data-model.md、research.md R11）
  coreRules: text("core_rules").notNull().default(""),
  coreRulesVersion: integer("core_rules_version").notNull().default(1),
  // プロンプトの材料を最後に変えた日時（specs/006-performance-feedback research.md R9。削除も含む）
  promotionsChangedAt: timestamp("promotions_changed_at", { withTimezone: true, precision: 6 }),
  researchChangedAt: timestamp("research_changed_at", { withTimezone: true, precision: 6 }),
  coreRulesChangedAt: timestamp("core_rules_changed_at", { withTimezone: true, precision: 6 }),
  // 投稿のルールを最後に保存した人（specs/008 research.md R8）
  coreRulesUpdatedByUserId: uuid("core_rules_updated_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  // 宣伝投稿の割合・プロンプトで作る件数の版と、最後に保存した人（同時の保存を知らせる。specs/008 FR-007、PR #9 のCodexレビュー）
  promotionRatioVersion: integer("promotion_ratio_version").notNull().default(1),
  promotionRatioUpdatedByUserId: uuid("promotion_ratio_updated_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  promptPostCountVersion: integer("prompt_post_count_version").notNull().default(1),
  promptPostCountUpdatedByUserId: uuid("prompt_post_count_updated_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  // 1投稿の文字数の目標と、短文・中文・長文の文字数と割合（specs/014 data-model.md、research.md R11）。
  // 版と最後に保存した人は、作る件数のもの（prompt_post_count_version）を共有する
  postLengthTarget: smallint("post_length_target").notNull().default(POST_LENGTH_DEFAULTS.target),
  shortLength: smallint("short_length").notNull().default(POST_LENGTH_DEFAULTS.shortLength),
  mediumLength: smallint("medium_length").notNull().default(POST_LENGTH_DEFAULTS.mediumLength),
  longLength: smallint("long_length").notNull().default(POST_LENGTH_DEFAULTS.longLength),
  shortRatio: smallint("short_ratio").notNull().default(POST_LENGTH_DEFAULTS.shortRatio),
  mediumRatio: smallint("medium_ratio").notNull().default(POST_LENGTH_DEFAULTS.mediumRatio),
  longRatio: smallint("long_ratio").notNull().default(POST_LENGTH_DEFAULTS.longRatio),
  // 反応数を読む権限がないと分かった日時（006 research.md R11）。再接続で消す
  insightsDeniedAt: timestamp("insights_denied_at", { withTimezone: true, precision: 6 }),
  // 今の接続の方法と、要再接続の理由の補い（specs/010 data-model.md。hint は short_lived_token だけ）
  connectionMethod: connectionMethod("connection_method").default("app"),
  reconnectHint: text("reconnect_hint"),
  ...timestamps,
}, (t) => [
  // ユーザー名での照合（specs/010 research.md R6）。古い名前が残る間は重なりうるので一意にしない
  index("accounts_username_lower_idx").on(sql`lower(${t.username})`),
  check("accounts_promotion_ratio_range", sql`${t.promotionRatioPercent} BETWEEN 0 AND 100`),
  check("accounts_prompt_post_count_range", sql`${t.promptPostCount} BETWEEN 1 AND 50`),
  check("accounts_core_rules_length", sql`char_length(${t.coreRules}) <= 2000`),
  check("accounts_post_length_target_range", sql`${t.postLengthTarget} BETWEEN 50 AND 500`),
  check(
    "accounts_post_kind_length_range",
    sql`${t.shortLength} BETWEEN 10 AND ${t.postLengthTarget} AND ${t.mediumLength} BETWEEN 10 AND ${t.postLengthTarget} AND ${t.longLength} BETWEEN 10 AND ${t.postLengthTarget}`,
  ),
  check(
    "accounts_post_kind_ratio_range",
    sql`${t.shortRatio} BETWEEN 0 AND 100 AND ${t.mediumRatio} BETWEEN 0 AND 100 AND ${t.longRatio} BETWEEN 0 AND 100 AND ${t.shortRatio} + ${t.mediumRatio} + ${t.longRatio} = 100`,
  ),
  // アカウントの名前は前後の空白を除いて1〜50文字（specs/012 data-model.md）。空白は JavaScript の trim() と同じもの
  // （タブ・改行・NBSP・全角スペースなど。PR #15 のCodexレビュー）。0013 の名前の埋め方も同じ文字の集まりを使う
  check(
    "accounts_name_length",
    sql`char_length(${t.name}) BETWEEN 1 AND 50 AND ${t.name} !~ '^[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]' AND ${t.name} !~ '[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]$'`,
  ),
  // 未接続 ⇔ Threadsのユーザー・ユーザー名・接続の方法がそろって NULL（同じマイグレーションで足した値を使えないので ::text で比べる）
  check(
    "accounts_connection_consistency",
    sql`(${t.connectionStatus}::text = 'not_connected' AND ${t.threadsUserId} IS NULL AND ${t.username} IS NULL AND ${t.connectionMethod} IS NULL)
      OR (${t.connectionStatus}::text <> 'not_connected' AND ${t.threadsUserId} IS NOT NULL AND ${t.username} IS NOT NULL AND ${t.connectionMethod} IS NOT NULL)`,
  ),
]);

/** User と Account の関係（data-model.md の memberships）。1つのAccountに owner は1人だけ。 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    // editor（担当）の行が経由するチーム（specs/011 data-model.md）。owner はNULL
    teamId: uuid("team_id").references((): AnyPgColumn => teams.id, { onDelete: "cascade" }),
    // 担当の知らせを閉じた日時（specs/011 research.md R9）。editor の行だけで使う
    assignedNoticeDismissedAt: timestamp("assigned_notice_dismissed_at", { withTimezone: true, precision: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_account_unique").on(t.userId, t.accountId),
    // 1つのAccountにownerは1人だけ
    uniqueIndex("memberships_one_owner_per_account").on(t.accountId).where(sql`${t.role} = 'owner'`),
    // owner だけがチームなし（新しい列挙型の値はマイグレーションの中で書けないので owner だけで書く）
    check("memberships_team_matches_role", sql`(${t.role} = 'owner') = (${t.teamId} IS NULL)`),
    index("memberships_team_role_idx").on(t.teamId, t.role),
  ],
);

/** AccountがThreadsにアクセスするための認証情報（data-model.md の threads_connections）。トークンは暗号化して保存する。 */
export const threadsConnections = pgTable("threads_connections", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  accessTokenCiphertext: bytea("access_token_ciphertext").notNull(),
  // 12バイト。暗号化のたびに暗号学的乱数で新しく生成し、使い回さない（research.md R5）
  accessTokenIv: bytea("access_token_iv").notNull(),
  keyVersion: smallint("key_version").notNull(),
  scopes: text("scopes").array().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  // callbackがリダイレクトを受け取った時刻。定期更新では変えない（research.md R7）
  authorizedAt: timestamp("authorized_at", { withTimezone: true, precision: 6 }).notNull(),
  // 期限を確かめられなかったトークンの、確かめ直しの時刻（specs/010 research.md R8）。OAuthでは入れない
  recheckAt: timestamp("recheck_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("threads_connections_recheck_idx").on(t.recheckAt).where(sql`${t.recheckAt} IS NOT NULL`),
]);

/** トークンの確認の失敗の時刻（specs/010 data-model.md、FR-015）。トークンの値は持たない。 */
export const tokenCheckFailures = pgTable(
  "token_check_failures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    failedAt: timestamp("failed_at", { withTimezone: true }).notNull(),
    // invalid_format・invalid・short_lived・account_mismatch
    reason: text("reason").notNull(),
  },
  (t) => [index("token_check_failures_user_time_idx").on(t.userId, t.failedAt)],
);

/** Threads接続フローの使い捨ての state（data-model.md の oauth_states）。平文は保存しない。 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: oauthMode("mode").notNull(),
    // 許可の画面にいる間に対象が消されたら NULL にし、callback で「見つからない」と分かるようにする（specs/012 contracts/api.md）
    targetAccountId: uuid("target_account_id").references(() => accounts.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    // new（012 より前の「つないで作る」）は対象を持たない。connect・reconnect の対象は、消されると NULL になる
    check("oauth_states_no_target_for_new", sql`${t.mode}::text <> 'new' OR ${t.targetAccountId} IS NULL`),
  ],
);

/** Metaのデータ削除要求の受付記録・進み具合・tombstone（data-model.md の threads_deletion_requests）。 */
export const threadsDeletionRequests = pgTable(
  "threads_deletion_requests",
  {
    confirmationCode: text("confirmation_code").primaryKey(),
    requestFingerprint: text("request_fingerprint").notNull().unique(),
    threadsUserId: text("threads_user_id"),
    threadsUserHmac: text("threads_user_hmac"),
    status: deletionStatus("status").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, precision: 6 }).notNull(),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true, precision: 6 }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, precision: 6 }),
    attempts: smallint("attempts").notNull().default(0),
  },
  (t) => [
    // 完了するまでは再試行のために平文を保持し、完了したら消す
    check(
      "threads_deletion_requests_plaintext_until_completed",
      sql`(${t.status} <> 'completed') = (${t.threadsUserId} IS NOT NULL)`,
    ),
    index("threads_deletion_requests_hmac_idx").on(t.threadsUserHmac),
    index("threads_deletion_requests_retry_idx").on(t.status, t.lastAttemptedAt),
  ],
);

/** Metaのアンインストール通知（連携の取り消し）の短期記録（data-model.md の threads_revocations）。 */
export const threadsRevocations = pgTable(
  "threads_revocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadsUserHmac: text("threads_user_hmac").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, precision: 6 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [index("threads_revocations_hmac_issued_idx").on(t.threadsUserHmac, t.issuedAt)],
);


// ---- 戦略プロファイル（specs/002-strategy-profile/data-model.md）----
// どのテーブルも Account に紐づき、Account の削除で一緒に消える（ON DELETE CASCADE）。
// 文字数の上限は char_length（コードポイントの数）で守る（research.md R2）。

/** 課題の「近い人間性」の列挙型（tone_preset）。未選択は NULL。 */
export const tonePreset = pgEnum("tone_preset", [
  "energetic_casual",
  "polite_warm",
  "formal",
  "casual_frank",
  "introspective_calm",
  "passionate",
  "humorous",
]);
/** 宣伝内容の状態の列挙型（promotion_status）。「期限切れ」は掲載期限から求める（research.md R6）。 */
export const promotionStatus = pgEnum("promotion_status", ["active", "paused", "ended"]);

const versionColumn = () => integer("version").notNull().default(1);

/** 課題（data-model.md の strategy_designs）。Account と1対1で、最初の保存で作る。 */
export const strategyDesigns = pgTable(
  "strategy_designs",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    finalAction: text("final_action"),
    targetPersona: text("target_persona"),
    realWorries: text("real_worries"),
    desiredSelfImage: text("desired_self_image"),
    perceivedImage: text("perceived_image"),
    contentThemeMix: text("content_theme_mix"),
    antiPersona: text("anti_persona"),
    benchmarkAccounts: text("benchmark_accounts"),
    funnelDesign: text("funnel_design"),
    postGenres: text("post_genres"),
    dmReplyTemplate: text("dm_reply_template"),
    inquiryQualityTips: text("inquiry_quality_tips"),
    tonePreset: tonePreset("tone_preset"),
    toneNotes: text("tone_notes"),
    differentiation: text("differentiation"),
    successMetrics: text("success_metrics"),
    profileBioDraft: text("profile_bio_draft"),
    pinnedPostDraft1: text("pinned_post_draft_1"),
    pinnedPostDraft2: text("pinned_post_draft_2"),
    pinnedPostDraft3: text("pinned_post_draft_3"),
    // 活動の目的・在り方の5問と活動の軸（specs/014 data-model.md、research.md R3）
    purposeOrigin: text("purpose_origin"),
    purposeSelf: text("purpose_self"),
    purposeOthers: text("purpose_others"),
    purposeFuture: text("purpose_future"),
    purposeStance: text("purpose_stance"),
    activityAxis: text("activity_axis"),
    version: versionColumn(),
    // 最後に保存した人（specs/008 research.md R8。保存の衝突で名前を出す）
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) =>
    (
      [
        t.finalAction,
        t.targetPersona,
        t.realWorries,
        t.desiredSelfImage,
        t.perceivedImage,
        t.contentThemeMix,
        t.antiPersona,
        t.benchmarkAccounts,
        t.funnelDesign,
        t.postGenres,
        t.dmReplyTemplate,
        t.inquiryQualityTips,
        t.toneNotes,
        t.differentiation,
        t.successMetrics,
        t.profileBioDraft,
        t.pinnedPostDraft1,
        t.pinnedPostDraft2,
        t.pinnedPostDraft3,
      ] as const
    ).map((col) => check(`strategy_designs_${col.name}_length`, sql`char_length(${col}) <= 2000`)),
);

/** 宣伝内容（data-model.md の promotions）。 */
export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    targetLocation: text("target_location"),
    targetPersona: text("target_persona"),
    targetAgeRange: text("target_age_range"),
    cta: text("cta"),
    linkedUrl: text("linked_url"),
    priority: smallint("priority").notNull().default(0),
    status: promotionStatus("status").notNull().default("active"),
    validUntil: date("valid_until", { mode: "string" }),
    version: versionColumn(),
    // 最後に保存した人（specs/008 research.md R8。保存の衝突で名前を出す）
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("promotions_account_idx").on(t.accountId),
    check("promotions_title_length", sql`char_length(${t.title}) BETWEEN 1 AND 100`),
    check("promotions_content_length", sql`char_length(${t.content}) BETWEEN 1 AND 2000`),
    check("promotions_target_location_length", sql`char_length(${t.targetLocation}) <= 100`),
    check("promotions_target_persona_length", sql`char_length(${t.targetPersona}) <= 100`),
    check("promotions_target_age_range_length", sql`char_length(${t.targetAgeRange}) <= 100`),
    check("promotions_cta_length", sql`char_length(${t.cta}) <= 100`),
    check("promotions_linked_url_length", sql`char_length(${t.linkedUrl}) <= 2000`),
    check("promotions_priority_range", sql`${t.priority} BETWEEN 0 AND 100`),
  ],
);

/** 参考投稿（data-model.md の reference_posts）。 */
export const referencePosts = pgTable(
  "reference_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    keyword: text("keyword"),
    postUrl: text("post_url"),
    whyGood: text("why_good"),
    // 媒体・元の投稿の投稿日・反応の数字・投稿者・メモ（specs/014 data-model.md、research.md R6）
    platform: text("platform").notNull().default("threads"),
    postedDateMode: text("posted_date_mode").notNull().default("unknown"),
    postedDate: date("posted_date"),
    metricLikes: integer("metric_likes"),
    metricReplies: integer("metric_replies"),
    metricViews: integer("metric_views"),
    metricSaves: integer("metric_saves"),
    metricReposts: integer("metric_reposts"),
    metricFollowers: integer("metric_followers"),
    author: text("author"),
    memo: text("memo"),
    version: versionColumn(),
    // 最後に保存した人（specs/008 research.md R8。保存の衝突で名前を出す）
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("reference_posts_account_created_idx").on(t.accountId, t.createdAt.desc()),
    check("reference_posts_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 2000`),
    check("reference_posts_keyword_length", sql`char_length(${t.keyword}) <= 100`),
    check("reference_posts_post_url_length", sql`char_length(${t.postUrl}) <= 2000`),
    check("reference_posts_why_good_length", sql`char_length(${t.whyGood}) <= 2000`),
    check("reference_posts_platform_valid", sql`${t.platform} IN ('threads', 'instagram', 'tiktok', 'x', 'other')`),
    check(
      "reference_posts_posted_date_mode_valid",
      sql`${t.postedDateMode} IN ('exact', 'week', 'month', '3months', 'unknown')`,
    ),
    check(
      "reference_posts_posted_date_matches_mode",
      sql`(${t.postedDateMode} = 'exact') = (${t.postedDate} IS NOT NULL)`,
    ),
    check(
      "reference_posts_metrics_nonnegative",
      sql`coalesce(${t.metricLikes}, 0) >= 0 AND coalesce(${t.metricReplies}, 0) >= 0 AND coalesce(${t.metricViews}, 0) >= 0 AND coalesce(${t.metricSaves}, 0) >= 0 AND coalesce(${t.metricReposts}, 0) >= 0 AND coalesce(${t.metricFollowers}, 0) >= 0`,
    ),
    check("reference_posts_author_length", sql`char_length(${t.author}) <= 100`),
    check("reference_posts_memo_length", sql`char_length(${t.memo}) <= 500`),
  ],
);

/** リサーチキーワード（data-model.md の research_keywords）。 */
export const researchKeywords = pgTable(
  "research_keywords",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    // 重複判定用（NFKC → 前後の空白を除く → 小文字。research.md R5）
    keywordNormalized: text("keyword_normalized").notNull(),
    purpose: text("purpose"),
    version: versionColumn(),
    // 最後に保存した人（specs/008 research.md R8。保存の衝突で名前を出す）
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("research_keywords_account_keyword_unique").on(t.accountId, t.keywordNormalized),
    check("research_keywords_keyword_length", sql`char_length(${t.keyword}) BETWEEN 1 AND 100`),
    check("research_keywords_purpose_length", sql`char_length(${t.purpose}) <= 100`),
  ],
);

// ---- 投稿ストック（specs/003-prompt-bulk-register/data-model.md）----

/**
 * 下書きの状態の列挙型（post_draft_status）。要確認・承認済み・却下（004で approved・rejected を足した）と、
 * 投稿の処理中・投稿済み・投稿に失敗（005で足した。specs/005-auto-post data-model.md）。
 */
export const postDraftStatus = pgEnum("post_draft_status", [
  "needs_review",
  "approved",
  "rejected",
  "publishing",
  "published",
  "publish_failed",
]);

/** 投稿の試みの状態の列挙型（publish_attempt_state。specs/005-auto-post data-model.md）。 */
export const publishAttemptState = pgEnum("publish_attempt_state", [
  "in_progress",
  "retry_wait",
  "succeeded",
  "carried_over",
  "failed",
  "skipped",
]);

/** 失敗の理由・飛ばした理由・直前のチェックの理由の値（text に保存し、CHECK制約で絞る）。 */
const PUBLISH_ERRORS = ["network", "threads_server", "invalid_request", "container_error", "unknown"] as const;
// billing_inactive：オーナーが読むだけ（無料体験の終わり・支払いの失敗・解約の後。specs/013 research.md R8）
const SKIP_REASONS = ["no_drafts", "needs_reconnect", "rate_limited", "daily_limit", "auto_post_off", "billing_inactive"] as const;
const BLOCKED_REASONS = ["ng_word", "over_threads_limit"] as const;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

/** 登録のまとまり（data-model.md の draft_batches）。貼り付けの1回の送信。 */
export const draftBatches = pgTable(
  "draft_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Webが送信ごとに作るID。再試行では同じ値（research.md R5）
    clientRequestId: uuid("client_request_id").notNull(),
    draftCount: smallint("draft_count").notNull(),
    delimiterFound: boolean("delimiter_found").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    // 登録した時点のプロンプトの材料の版（specs/006-performance-feedback FR-002g）。006より前のバッチは NULL
    strategyUpdatedAt: timestamp("strategy_updated_at", { withTimezone: true, precision: 6 }),
    promotionsChangedAt: timestamp("promotions_changed_at", { withTimezone: true, precision: 6 }),
    researchChangedAt: timestamp("research_changed_at", { withTimezone: true, precision: 6 }),
    coreRulesChangedAt: timestamp("core_rules_changed_at", { withTimezone: true, precision: 6 }),
  },
  (t) => [
    uniqueIndex("draft_batches_account_request_unique").on(t.accountId, t.clientRequestId),
    check("draft_batches_draft_count_range", sql`${t.draftCount} BETWEEN 1 AND 50`),
  ],
);

/** 下書き（data-model.md の post_drafts）。 */
export const postDrafts = pgTable(
  "post_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => draftBatches.id, { onDelete: "cascade" }),
    // 登録のまとまりの中での順番（貼り付けたテキストの順。0始まり）
    position: smallint("position").notNull(),
    body: text("body").notNull(),
    status: postDraftStatus("status").notNull().default("needs_review"),
    version: versionColumn(),
    // 承認・却下の記録（specs/004-review-approval data-model.md、research.md R1）
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, precision: 6 }),
    rejectReasons: text("reject_reasons").array(),
    rejectNote: text("reject_note"),
    // 最後に状態を変えた操作のID。同じ操作の再試行だけを成功として扱う（research.md R2、PR #5 のCodexレビュー）
    lastReviewRequestId: uuid("last_review_request_id"),
    // 投稿の順（specs/005-auto-post data-model.md、research.md R4）
    prioritizedAt: timestamp("prioritized_at", { withTimezone: true, precision: 6 }),
    carryoverAttemptId: uuid("carryover_attempt_id").references((): AnyPgColumn => publishAttempts.id, {
      onDelete: "set null",
    }),
    // 投稿済み（FR-009）
    publishedAt: timestamp("published_at", { withTimezone: true, precision: 6 }),
    threadsMediaId: text("threads_media_id"),
    threadsPermalink: text("threads_permalink"),
    /** 投稿のURLの取り直しに最後に失敗した日時（失敗し続ける投稿を後回しにする。PR #6 のCodexレビュー） */
    permalinkCheckedAt: timestamp("permalink_checked_at", { withTimezone: true, precision: 6 }),
    // 投稿に失敗（FR-014）
    publishFailedAt: timestamp("publish_failed_at", { withTimezone: true, precision: 6 }),
    publishError: text("publish_error"),
    // 分析のための記録（specs/006-performance-feedback FR-002e・FR-002f、research.md R9）。
    // 本文を人が直したか：006より前の行は false（不明）、それ以後は true（記録している）
    bodyEditTracked: boolean("body_edit_tracked").notNull().default(true),
    bodyEditedAt: timestamp("body_edited_at", { withTimezone: true, precision: 6 }),
    // 登録した人と、最後に本文を直した人（specs/008 FR-053、research.md R10）。008より前の行はNULL
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    editedByUserId: uuid("edited_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    // 公開した時点の情報。publish_attempts は保存期間を過ぎると消えるので写しておく
    publishedSlotMinute: smallint("published_slot_minute"),
    publishedCarryover: boolean("published_carryover"),
    publishedPrioritized: boolean("published_prioritized"),
    // 投稿の直前のチェックで要確認に戻した（FR-007）
    blockedAt: timestamp("blocked_at", { withTimezone: true, precision: 6 }),
    blockedReason: text("blocked_reason"),
    blockedWords: text("blocked_words").array(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("post_drafts_batch_position_unique").on(t.batchId, t.position),
    // 却下理由の候補は、NULLの要素・空文字・知らないコードを入れない（PR #5 のCodexレビュー）
    check(
      "post_drafts_reject_reasons_valid",
      sql`${t.rejectReasons} IS NULL OR (cardinality(${t.rejectReasons}) >= 1
        AND array_position(${t.rejectReasons}, NULL) IS NULL
        AND ${t.rejectReasons} <@ ARRAY[${sql.raw(REJECT_REASON_CODES.map((c) => `'${c}'`).join(", "))}]::text[])`,
    ),
    index("post_drafts_account_status_reviewed_idx").on(t.accountId, t.status, t.reviewedAt.desc()),
    // 投稿の順（005 research.md R4）と、投稿済みの一覧（新しい順。R14）
    index("post_drafts_queue_idx").on(t.accountId, t.status, t.prioritizedAt.desc().nullsLast(), t.reviewedAt, t.id),
    index("post_drafts_published_idx").on(t.accountId, t.status, t.publishedAt.desc(), t.id),
    check("post_drafts_position_range", sql`${t.position} >= 0 AND ${t.position} < 50`),
    check("post_drafts_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 2000`),
    check("post_drafts_reject_note_length", sql`char_length(${t.rejectNote}) <= 200`),
    // 状態は status::text で比べる（ADD VALUE で足した値は、同じトランザクションの中で列挙型として使えないため）。
    // NULL との比較は CHECK を通ってしまうので、coalesce で必ず真か偽にする（理由のない却下を入れない。原則II）。
    // 005：投稿の記録・失敗の記録・投稿の順の列を、状態ごとに縛る（specs/005-auto-post data-model.md）
    check(
      "post_drafts_review_state",
      sql`(${t.status}::text = 'needs_review' AND ${t.reviewedAt} IS NULL AND ${t.rejectReasons} IS NULL AND ${t.rejectNote} IS NULL
          AND ${t.prioritizedAt} IS NULL AND ${t.carryoverAttemptId} IS NULL
          AND ${t.publishedAt} IS NULL AND ${t.publishFailedAt} IS NULL AND ${t.publishError} IS NULL)
        OR (${t.status}::text IN ('approved', 'publishing') AND ${t.reviewedAt} IS NOT NULL AND ${t.rejectReasons} IS NULL AND ${t.rejectNote} IS NULL
          AND ${t.publishedAt} IS NULL AND ${t.publishFailedAt} IS NULL AND ${t.publishError} IS NULL)
        OR (${t.status}::text = 'rejected' AND ${t.reviewedAt} IS NOT NULL
          AND (coalesce(cardinality(${t.rejectReasons}), 0) >= 1 OR coalesce(btrim(${t.rejectNote}), '') <> '')
          AND ${t.prioritizedAt} IS NULL AND ${t.carryoverAttemptId} IS NULL
          AND ${t.publishedAt} IS NULL AND ${t.publishFailedAt} IS NULL AND ${t.publishError} IS NULL)
        OR (${t.status}::text = 'published' AND ${t.reviewedAt} IS NOT NULL AND ${t.rejectReasons} IS NULL AND ${t.rejectNote} IS NULL
          AND ${t.prioritizedAt} IS NULL AND ${t.carryoverAttemptId} IS NULL
          AND ${t.publishedAt} IS NOT NULL AND ${t.publishFailedAt} IS NULL AND ${t.publishError} IS NULL)
        OR (${t.status}::text = 'publish_failed' AND ${t.reviewedAt} IS NOT NULL AND ${t.rejectReasons} IS NULL AND ${t.rejectNote} IS NULL
          AND ${t.prioritizedAt} IS NULL AND ${t.carryoverAttemptId} IS NULL
          AND ${t.publishedAt} IS NULL AND ${t.publishFailedAt} IS NOT NULL AND ${t.publishError} IS NOT NULL)`,
    ),
    // 投稿の直前のチェックの記録は、要確認のときだけ。日時と理由は両方あるか両方ないか
    check(
      "post_drafts_blocked_state",
      sql`(${t.blockedAt} IS NULL AND ${t.blockedReason} IS NULL AND ${t.blockedWords} IS NULL)
        OR (${t.status}::text = 'needs_review' AND ${t.blockedAt} IS NOT NULL AND ${t.blockedReason} IS NOT NULL)`,
    ),
    check("post_drafts_blocked_reason_valid", sql`${t.blockedReason} IS NULL OR ${t.blockedReason} IN (${inList(BLOCKED_REASONS)})`),
    check(
      "post_drafts_published_slot_minute_range",
      sql`${t.publishedSlotMinute} IS NULL OR ${t.publishedSlotMinute} BETWEEN 0 AND 1439`,
    ),
    check("post_drafts_publish_error_valid", sql`${t.publishError} IS NULL OR ${t.publishError} IN (${inList(PUBLISH_ERRORS)})`),
    // Threadsの投稿のIDとURLは、投稿済みのときだけ（投稿済みでも空のことがある。research.md R6）
    check(
      "post_drafts_threads_media_state",
      sql`(${t.threadsMediaId} IS NULL AND ${t.threadsPermalink} IS NULL) OR ${t.status}::text = 'published'`,
    ),
    check("post_drafts_threads_permalink_length", sql`char_length(${t.threadsPermalink}) <= 2000`),
  ],
);

// ---- 自動投稿（specs/005-auto-post/data-model.md）----

/** 投稿の設定（data-model.md の posting_schedules）。Account と1対1で、最初の保存で作る。 */
export const postingSchedules = pgTable(
  "posting_schedules",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    // 1日に投稿する時刻（日本時間、0時からの分）。昇順・重複なし・最大10件
    slotMinutes: smallint("slot_minutes").array().notNull().default(sql`'{}'::smallint[]`),
    jitter: boolean("jitter").notNull().default(true),
    // この時刻より後の予定だけを投稿する（FR-012・FR-016。research.md R1）
    effectiveFrom: timestamp("effective_from", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    // Threadsの投稿数の上限で止めたとき、翌日の0時（日本時間）（FR-017）
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    // 「投稿の直前に要確認へ戻した」の知らせを閉じた日時（research.md R8）
    blockedNoticeSeenAt: timestamp("blocked_notice_seen_at", { withTimezone: true, precision: 6 }),
    version: versionColumn(),
    // 最後に保存した人（specs/008 research.md R8。保存の衝突で名前を出す）
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("posting_schedules_enabled_idx").on(t.enabled).where(sql`${t.enabled}`),
    check("posting_schedules_slot_count", sql`cardinality(${t.slotMinutes}) <= 10`),
    check("posting_schedules_slot_range", sql`0 <= ALL(${t.slotMinutes}) AND 1439 >= ALL(${t.slotMinutes})`),
    check("posting_schedules_enabled_requires_slots", sql`NOT ${t.enabled} OR cardinality(${t.slotMinutes}) >= 1`),
  ],
);

/** 投稿の試み（data-model.md の publish_attempts）。1つの時刻での、1つのAccountの投稿の処理を1行で表す。 */
export const publishAttempts = pgTable(
  "publish_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // ずらした後の予定の時刻
    slotAt: timestamp("slot_at", { withTimezone: true }).notNull(),
    // 予定の日付（日本時間）と、設定の時刻（ずらす前）
    slotDate: date("slot_date", { mode: "string" }).notNull(),
    slotMinute: smallint("slot_minute").notNull(),
    draftId: uuid("draft_id").references((): AnyPgColumn => postDrafts.id, { onDelete: "set null" }),
    isCarryover: boolean("is_carryover").notNull().default(false),
    state: publishAttemptState("state").notNull(),
    skipReason: text("skip_reason"),
    retryCount: smallint("retry_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    // 作ったThreadsのコンテナーのID。公開を送る前に保存する（research.md R6）
    containerId: text("container_id"),
    // 公開を送った時刻。これがあり結果が未確定なら、新しいコンテナーを作らない
    publishRequestedAt: timestamp("publish_requested_at", { withTimezone: true, precision: 6 }),
    lastError: text("last_error"),
    // 処理している定期処理の持ち時間（待機では、次に確かめる時刻）
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    // 持ち時間を取った処理の札。試みの更新はこれが同じときだけ行う（持ち時間の切れた古い処理を締め出す）
    leaseToken: uuid("lease_token"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("publish_attempts_account_slot_unique").on(t.accountId, t.slotAt),
    index("publish_attempts_pending_idx")
      .on(t.state, t.nextRetryAt)
      .where(sql`${t.state} IN ('in_progress', 'retry_wait')`),
    index("publish_attempts_account_date_idx").on(t.accountId, t.slotDate),
    check("publish_attempts_slot_minute_range", sql`${t.slotMinute} BETWEEN 0 AND 1439`),
    check("publish_attempts_retry_count_range", sql`${t.retryCount} BETWEEN 0 AND 3`),
    check(
      "publish_attempts_skip_state",
      sql`(${t.state} = 'skipped' AND ${t.skipReason} IS NOT NULL AND ${t.draftId} IS NULL)
        OR (${t.state} <> 'skipped' AND ${t.skipReason} IS NULL)`,
    ),
    check("publish_attempts_skip_reason_valid", sql`${t.skipReason} IS NULL OR ${t.skipReason} IN (${inList(SKIP_REASONS)})`),
    check("publish_attempts_last_error_valid", sql`${t.lastError} IS NULL OR ${t.lastError} IN (${inList(PUBLISH_ERRORS)})`),
    check("publish_attempts_retry_wait_state", sql`${t.state} <> 'retry_wait' OR ${t.nextRetryAt} IS NOT NULL`),
    check(
      "publish_attempts_pending_has_draft",
      sql`${t.state} NOT IN ('in_progress', 'retry_wait') OR ${t.draftId} IS NOT NULL`,
    ),
  ],
);

/** NGワード（specs/004-review-approval data-model.md の ng_words）。 */
export const ngWords = pgTable(
  "ng_words",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // 入力のまま（前後の空白を除く）。画面とプロンプトに出す
    word: text("word").notNull(),
    // 照合と重複の判定に使う値（normalizeNgWord。research.md R4）
    normalized: text("normalized").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    // 登録の順番。1回の送信で足した語も入力の順に増える（日時の並びに頼らない。PR #5 のCodexレビュー）
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
  },
  (t) => [
    uniqueIndex("ng_words_account_normalized_unique").on(t.accountId, t.normalized),
    check("ng_words_word_length", sql`char_length(${t.word}) BETWEEN 1 AND 50`),
  ],
);

// ---- パフォーマンス分析と改善フィードバック（specs/006-performance-feedback data-model.md） ----

/** 反応数の記録の状態（metrics_state）。行がない投稿は「確定待ち（まだ取っていない）」。 */
export const metricsState = pgEnum("metrics_state", ["updating", "confirmed", "late_confirmed", "unmeasurable"]);
/** 取り込みの種類（metrics_kind）。24時間・3日・7日・遅れて確定。 */
export const metricsKind = pgEnum("metrics_kind", ["h24", "d3", "d7", "late"]);
/** 判定（judgment）。 */
export const judgment = pgEnum("judgment", ["good", "normal", "poor"]);

const UNMEASURABLE_REASONS = ["no_media_id", "not_found"] as const;
const METRICS_METHODS = ["slot", "daily"] as const;

const metricColumns = {
  views: integer("views"),
  likes: integer("likes"),
  replies: integer("replies"),
  reposts: integer("reposts"),
  quotes: integer("quotes"),
  shares: integer("shares"),
};

/** 反応数の記録（post_metrics）。投稿済みの下書きに0か1行。最初に取り込んだとき（または計測できないと分かったとき）に作る。 */
export const postMetrics = pgTable(
  "post_metrics",
  {
    draftId: uuid("draft_id")
      .primaryKey()
      .references(() => postDrafts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    state: metricsState("state").notNull(),
    ...metricColumns,
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true, precision: 6 }),
    lastElapsedMinutes: integer("last_elapsed_minutes"),
    lastKind: metricsKind("last_kind"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, precision: 6 }),
    unmeasurableReason: text("unmeasurable_reason"),
    // 確定したときに1回だけ入れる（research.md R5）
    judgment: judgment("judgment"),
    judgmentRatio: doublePrecision("judgment_ratio"),
    judgmentBaseline: doublePrecision("judgment_baseline"),
    judgedAt: timestamp("judged_at", { withTimezone: true, precision: 6 }),
    // 改善フィードバック（低調の投稿。FR-021）
    feedbackMemo: text("feedback_memo"),
    includeInPrompt: boolean("include_in_prompt").notNull().default(true),
    feedbackUpdatedAt: timestamp("feedback_updated_at", { withTimezone: true, precision: 6 }),
    // 改善メモの保存の衝突を見つける版と、最後に変えた人（specs/008 research.md R8）
    feedbackVersion: integer("feedback_version").notNull().default(1),
    feedbackUpdatedByUserId: uuid("feedback_updated_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    index("post_metrics_account_state_idx").on(t.accountId, t.state),
    index("post_metrics_account_poor_idx").on(t.accountId, t.judgment).where(sql`${t.judgment} = 'poor'`),
    check(
      "post_metrics_unmeasurable_reason",
      sql`(${t.state}::text = 'unmeasurable') = (${t.unmeasurableReason} IS NOT NULL)`,
    ),
    check("post_metrics_unmeasurable_reason_valid", sql`${t.unmeasurableReason} IS NULL OR ${t.unmeasurableReason} IN (${inList(UNMEASURABLE_REASONS)})`),
    check(
      "post_metrics_confirmed_at",
      sql`(${t.state}::text IN ('confirmed', 'late_confirmed')) = (${t.confirmedAt} IS NOT NULL)`,
    ),
    check(
      "post_metrics_judgment",
      sql`${t.judgment} IS NULL OR (${t.state}::text IN ('confirmed', 'late_confirmed') AND ${t.judgmentRatio} IS NOT NULL AND ${t.judgmentBaseline} > 0)`,
    ),
    check("post_metrics_feedback_memo_length", sql`char_length(${t.feedbackMemo}) <= 200`),
    check(
      "post_metrics_counts_nonnegative",
      sql`coalesce(${t.views}, 0) >= 0 AND coalesce(${t.likes}, 0) >= 0 AND coalesce(${t.replies}, 0) >= 0
        AND coalesce(${t.reposts}, 0) >= 0 AND coalesce(${t.quotes}, 0) >= 0 AND coalesce(${t.shares}, 0) >= 0`,
    ),
  ],
);

/** 取り込みの履歴（post_metric_snapshots）。1回の取り込みで1行。上書きしない（FR-002b）。 */
export const postMetricSnapshots = pgTable(
  "post_metric_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => postDrafts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: metricsKind("kind").notNull(),
    method: text("method").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, precision: 6 }).notNull(),
    elapsedMinutes: integer("elapsed_minutes").notNull(),
    ...metricColumns,
  },
  (t) => [
    uniqueIndex("post_metric_snapshots_draft_kind_unique").on(t.draftId, t.kind),
    index("post_metric_snapshots_account_fetched_idx").on(t.accountId, t.fetchedAt),
    check("post_metric_snapshots_method_valid", sql`${t.method} IN (${inList(METRICS_METHODS)})`),
  ],
);

/** フォロワー数の記録（follower_snapshots）。Accountに1日（日本時間）1行（FR-002c）。 */
export const followerSnapshots = pgTable(
  "follower_snapshots",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
    followersCount: integer("followers_count").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.snapshotDate] }),
    check("follower_snapshots_count_nonnegative", sql`${t.followersCount} >= 0`),
  ],
);

// ---- チーム運用（specs/008-team-operations data-model.md）----

/** 操作の記録の種類の列挙型（activity_kind。FR-052の絞り込みの単位）。 */
export const activityKind = pgEnum("activity_kind", ["review", "draft", "content", "settings", "member"]);

/** チーム（specs/011 data-model.md の teams）。管理者が作り、招待リンクを1本持つ。 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // 管理者。team_members の admin の行と同じ値を同じトランザクションで書く。
    // 利用者の削除（退会）は011の次のfeatureで作り、users の行を消す前にチームから外す（data-model.md）
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // 招待リンク（specs/008 research.md R4 と同じ仕組み）。照合はハッシュ、表示は暗号化した写し
    inviteTokenHash: text("invite_token_hash").notNull().unique(),
    inviteTokenCiphertext: bytea("invite_token_ciphertext").notNull(),
    inviteTokenIv: bytea("invite_token_iv").notNull(),
    inviteKeyVersion: smallint("invite_key_version").notNull(),
    inviteRotatedAt: timestamp("invite_rotated_at", { withTimezone: true, precision: 6 }),
    ...timestamps,
  },
  (t) => [
    check("teams_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 50`),
    index("teams_admin_idx").on(t.adminUserId),
  ],
);

/** チームの人（specs/011 data-model.md の team_members）。1チーム50人、編集者10人まで。 */
export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRole("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    // 管理者がこの人の参加の知らせを閉じた日時（research.md R9）
    joinedNoticeDismissedAt: timestamp("joined_notice_dismissed_at", { withTimezone: true, precision: 6 }),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    // 1チームに管理者は1人
    uniqueIndex("team_members_one_admin").on(t.teamId).where(sql`${t.role} = 'admin'`),
    index("team_members_user_idx").on(t.userId),
  ],
);

/** チームに入っているアカウント（specs/011 data-model.md の team_accounts）。shared は「チームに見せる」。 */
export const teamAccounts = pgTable(
  "team_accounts",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    addedByUserId: uuid("added_by_user_id").references(() => users.id, { onDelete: "set null" }),
    shared: boolean("shared").notNull().default(false),
    addedAt: timestamp("added_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.accountId] }),
    // 1つのアカウントは1つのチームにだけ入る（複数に広げるときはこの索引を外す。spec Clarifications）
    uniqueIndex("team_accounts_one_team_per_account").on(t.accountId),
  ],
);

/** 操作の記録（data-model.md の activity_logs）。チームがあるAccountだけ。90日で消す。 */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    actorRole: membershipRole("actor_role").notNull(),
    kind: activityKind("kind").notNull(),
    action: text("action").notNull(),
    itemCount: integer("item_count").notNull().default(1),
    summary: text("summary"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_logs_account_created_idx").on(t.accountId, t.createdAt.desc()),
    index("activity_logs_account_actor_idx").on(t.accountId, t.actorUserId, t.createdAt.desc()),
    index("activity_logs_created_idx").on(t.createdAt),
  ],
);

/** 契約（specs/013-billing data-model.md の subscriptions）。利用者に1行まで。はじめて「契約する」を押したときに作る。 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    // Stripeの契約の状態。まだ契約がなければ NULL
    status: text("status"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    // Stripeに伝えてある数（max(n,1)）
    quantity: integer("quantity"),
    // アカウントの数を合わせ直す要がある（research.md R6）
    quantitySyncNeeded: boolean("quantity_sync_needed").notNull().default(false),
    // 開いているCheckoutのセッション（作り直す前に期限切れにする。research.md R4）
    pendingCheckoutSessionId: text("pending_checkout_session_id"),
    // Stripeから最後に読み直した時刻。これより古い読み直しでは更新しない（research.md R5）
    stripeSyncedAt: timestamp("stripe_synced_at", { withTimezone: true, precision: 6 }),
    ...timestamps,
  },
  (t) => [
    check("subscriptions_status_valid", sql`${t.status} IS NULL OR ${t.status} IN (${inList(SUBSCRIPTION_STATUSES)})`),
  ],
);

/**
 * 退会した人（specs/013-billing data-model.md の withdrawn_users）。ログインの情報の削除をやり直し、
 * 消した後に残ったセッションのトークンで users の行が作り直されないようにする。メールアドレス・名前は持たない。
 */
export const withdrawnUsers = pgTable("withdrawn_users", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull(),
  clerkDeletedAt: timestamp("clerk_deleted_at", { withTimezone: true }),
});

// ---- テスト用のグループ（specs/016-test-groups data-model.md）----

/** テスト用のグループ。テスト版を渡す組織やコミュニティの単位。招待リンクを1本持つ（チームの招待と同じ仕組み）。 */
export const testGroups = pgTable(
  "test_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    // 招待リンク（research.md R8）。照合はハッシュ、運営者の画面に出すのは暗号化した写し（AADはid）
    inviteTokenHash: text("invite_token_hash").notNull().unique(),
    inviteTokenCiphertext: bytea("invite_token_ciphertext").notNull(),
    inviteTokenIv: bytea("invite_token_iv").notNull(),
    inviteKeyVersion: smallint("invite_key_version").notNull(),
    inviteRotatedAt: timestamp("invite_rotated_at", { withTimezone: true, precision: 6 }),
    // 閉じた時刻。閉じたグループは開き直さない
    closedAt: timestamp("closed_at", { withTimezone: true, precision: 6 }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    check("test_groups_name_length", sql`char_length(${t.name}) BETWEEN 1 AND ${sql.raw(String(TEST_GROUP_NAME_MAX))}`),
    check(
      "test_groups_capacity_range",
      sql`${t.capacity} BETWEEN ${sql.raw(String(TEST_GROUP_CAPACITY_MIN))} AND ${sql.raw(String(TEST_GROUP_CAPACITY_MAX))}`,
    ),
  ],
);

/** 今グループに入っている人（1人1グループ）。外す・閉じるときは行を消す（research.md R3）。 */
export const testGroupMembers = pgTable(
  "test_group_members",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => testGroups.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    // 入ったときに料金なしの印を付けた。出るときはこの人だけ印を戻す（research.md R7）
    grantedBillingExempt: boolean("granted_billing_exempt").notNull().default(false),
  },
  (t) => [index("test_group_members_group_idx").on(t.groupId)],
);

/** グループの出来事の記録（FR-013、research.md R6）。 */
export const testGroupEvents = pgTable(
  "test_group_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => testGroups.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    subjectName: text("subject_name"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    check("test_group_events_action_valid", sql`${t.action} IN (${inList(TEST_GROUP_EVENT_ACTIONS)})`),
    index("test_group_events_group_created_idx").on(t.groupId, t.createdAt.desc()),
  ],
);

/**
 * 機能のまとまりごとのON/OFF（specs/019-feature-switches data-model.md）。人の設定で、OFFのまとまりだけを行で持ち、行がなければON。
 * 人の設定（feature_disables）とグループの設定（group_feature_disables）の、どちらかでOFFなら使えない（FR-018）。
 */
export const featureDisables = pgTable(
  "feature_disables",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    disabledByUserId: uuid("disabled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ name: "feature_disables_pkey", columns: [t.userId, t.feature] }),
    check("feature_disables_feature_valid", sql`${t.feature} IN (${inList(FEATURES)})`),
  ],
);

/** グループ（組織）の設定（specs/019 FR-017）。閉じたグループの行は残すが、判定では使わない。 */
export const groupFeatureDisables = pgTable(
  "group_feature_disables",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => testGroups.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    disabledByUserId: uuid("disabled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ name: "group_feature_disables_pkey", columns: [t.groupId, t.feature] }),
    check("group_feature_disables_feature_valid", sql`${t.feature} IN (${inList(FEATURES)})`),
  ],
);

/** 機能の設定を変えた記録（specs/019 FR-014、research.md R7）。人かグループのどちらか一方。変えられた人が退会したら・グループを消したら消す。 */
export const featureSettingEvents = pgTable(
  "feature_setting_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "cascade" }),
    subjectGroupId: uuid("subject_group_id").references(() => testGroups.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    subjectName: text("subject_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    check("feature_setting_events_feature_valid", sql`${t.feature} IN (${inList(FEATURES)})`),
    check("feature_setting_events_action_valid", sql`${t.action} IN (${inList(FEATURE_EVENT_ACTIONS)})`),
    check("feature_setting_events_one_subject", sql`(${t.subjectUserId} IS NULL) <> (${t.subjectGroupId} IS NULL)`),
    index("feature_setting_events_created_idx").on(t.createdAt.desc()),
    index("feature_setting_events_subject_created_idx").on(t.subjectUserId, t.createdAt.desc()),
  ],
);
