// DBスキーマ（specs/001-login-account-setup/data-model.md）。
// Accountに紐づくテーブルはすべて ON DELETE CASCADE とする（後続featureも守る規約。research.md R13）。
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { PLANS, PROMOTION_RATIO_DEFAULT, PROMPT_COUNT_DEFAULT } from "@threads-grower/shared";

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

/** Accountの契約プランの列挙型（account_plan）。 */
export const accountPlan = pgEnum("account_plan", PLANS);
/** Membershipのロールの列挙型（membership_role）。member はプラン4限定で、本featureでは作らない。 */
export const membershipRole = pgEnum("membership_role", ["owner", "member"]);
/** Threads接続の状態の列挙型（connection_status）。 */
export const connectionStatus = pgEnum("connection_status", ["connected", "needs_reconnect"]);
/** 接続フローの種類の列挙型（oauth_mode）。 */
export const oauthMode = pgEnum("oauth_mode", ["new", "reconnect"]);
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
  ...timestamps,
});

/** Threadsアカウント1件に対応する運用単位（data-model.md の accounts）。 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadsUserId: text("threads_user_id").notNull().unique(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  profilePictureUrl: text("profile_picture_url"),
  plan: accountPlan("plan").notNull(),
  connectionStatus: connectionStatus("connection_status").notNull().default("connected"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, precision: 6 }),
  connectionGeneration: bigint("connection_generation", { mode: "number" }).notNull().default(0),
  // 宣伝投稿の割合（specs/002-strategy-profile data-model.md、research.md R7）
  promotionRatioPercent: smallint("promotion_ratio_percent").notNull().default(PROMOTION_RATIO_DEFAULT),
  // プロンプトで作る件数（specs/003-prompt-bulk-register data-model.md、research.md R11）
  promptPostCount: smallint("prompt_post_count").notNull().default(PROMPT_COUNT_DEFAULT),
  ...timestamps,
}, (t) => [
  check("accounts_promotion_ratio_range", sql`${t.promotionRatioPercent} BETWEEN 0 AND 100`),
  check("accounts_prompt_post_count_range", sql`${t.promptPostCount} BETWEEN 1 AND 50`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_account_unique").on(t.userId, t.accountId),
    // 1つのAccountにownerは1人だけ
    uniqueIndex("memberships_one_owner_per_account").on(t.accountId).where(sql`${t.role} = 'owner'`),
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
  ...timestamps,
});

/** Threads接続フローの使い捨ての state（data-model.md の oauth_states）。平文は保存しない。 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: oauthMode("mode").notNull(),
    targetAccountId: uuid("target_account_id").references(() => accounts.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "oauth_states_target_required_for_reconnect",
      sql`(${t.mode} = 'reconnect') = (${t.targetAccountId} IS NOT NULL)`,
    ),
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
    version: versionColumn(),
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
    version: versionColumn(),
    ...timestamps,
  },
  (t) => [
    index("reference_posts_account_created_idx").on(t.accountId, t.createdAt.desc()),
    check("reference_posts_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 2000`),
    check("reference_posts_keyword_length", sql`char_length(${t.keyword}) <= 100`),
    check("reference_posts_post_url_length", sql`char_length(${t.postUrl}) <= 2000`),
    check("reference_posts_why_good_length", sql`char_length(${t.whyGood}) <= 2000`),
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
    ...timestamps,
  },
  (t) => [
    uniqueIndex("research_keywords_account_keyword_unique").on(t.accountId, t.keywordNormalized),
    check("research_keywords_keyword_length", sql`char_length(${t.keyword}) BETWEEN 1 AND 100`),
    check("research_keywords_purpose_length", sql`char_length(${t.purpose}) <= 100`),
  ],
);

// ---- 投稿ストック（specs/003-prompt-bulk-register/data-model.md）----

/** 下書きの状態の列挙型（post_draft_status）。003では要確認だけ。004で approved・rejected を足す。 */
export const postDraftStatus = pgEnum("post_draft_status", ["needs_review"]);

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
    ...timestamps,
  },
  (t) => [
    uniqueIndex("post_drafts_batch_position_unique").on(t.batchId, t.position),
    index("post_drafts_account_status_idx").on(t.accountId, t.status),
    check("post_drafts_position_range", sql`${t.position} >= 0 AND ${t.position} < 50`),
    check("post_drafts_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 2000`),
  ],
);
