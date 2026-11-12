// 共通（platform）の表の定義：17表＋029の5表（docs/module-map.md 2-1、specs/027-modular-monolith research.md R6）。
// Accountに紐づくテーブルはすべて ON DELETE CASCADE とする（後続featureも守る規約。specs/001 research.md R13）。
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
  POST_LENGTH_DEFAULTS,
  PROMOTION_RATIO_DEFAULT,
  PROMPT_COUNT_DEFAULT,
  SUBSCRIPTION_STATUSES,
  TEST_GROUP_CAPACITY_MAX,
  TEST_GROUP_CAPACITY_MIN,
  TEST_GROUP_EVENT_ACTIONS,
  TEST_GROUP_NAME_MAX,
  ACCOUNT_LIMIT_MAX,
  DAILY_POST_LIMIT_MAX,
  DEFAULT_ACCOUNT_LIMIT,
  DEFAULT_DAILY_POST_LIMIT,
  TESTER_SLOT_CAPACITY_DEFAULT,
  TESTER_SLOT_CAPACITY_MAX,
  TESTER_SLOT_CAPACITY_MIN,
} from "@meguru/shared";
import { bytea, timestamps, inList } from "../kernel/db/columns";
// 境界の例外（docs/module-map.md 4）：operator_events.application_id の外部キーのためだけに、Threadsの表を読む（参照は遅延で、読みこみの循環でも壊れない）
// eslint-disable-next-line local/module-boundaries
import { testerApplications } from "../apps/threads/schema";

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

/** 操作の記録の種類の列挙型（activity_kind。FR-052の絞り込みの単位）。 */
export const activityKind = pgEnum("activity_kind", ["review", "draft", "content", "settings", "member"]);

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
  /** 最後に使ったアプリ（@meguru/shared の APP_CATALOG の ID。PUT /api/me/last-app だけが書く。specs/028 data-model.md 1） */
  lastAppId: text("last_app_id"),
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
  // この人だけのアカウントの数・1日の投稿数の上限。NULLなら既定値（operator_settings。specs/024 data-model.md 2-1）
  accountLimit: integer("account_limit"),
  dailyPostLimit: integer("daily_post_limit"),
  // 024の前からいた人（無料体験を使える。specs/024 research.md R8）。既定は true にして、列を足してから新しいAPIに
  // 替わるまでの間に古いAPIが作った人も締め出さない。新しいAPIは作るときに必ず false を渡す（016 の signed_up_open と同じ）
  legacyTrial: boolean("legacy_trial").notNull().default(true),
  ...timestamps,
}, (t) => [
  index("users_referred_by_idx").on(t.referredByUserId),
  check("users_not_self_referred", sql`${t.referredByUserId} <> ${t.id}`),
  check("users_account_limit_range", sql`${t.accountLimit} IS NULL OR ${t.accountLimit} BETWEEN 1 AND ${sql.raw(String(ACCOUNT_LIMIT_MAX))}`),
  check("users_daily_post_limit_range", sql`${t.dailyPostLimit} IS NULL OR ${t.dailyPostLimit} BETWEEN 1 AND ${sql.raw(String(DAILY_POST_LIMIT_MAX))}`),
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
  // 返信の権限がないと分かった時刻（specs/023 research.md R1）。つなぎ直すとNULL
  repliesDeniedAt: timestamp("replies_denied_at", { withTimezone: true, precision: 6 }),
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
    // アプリの番号（specs/meguru/029 research.md R7）。名前（feature）の意味はアプリが決める
    app: text("app").notNull().default("threads"),
    feature: text("feature").notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    disabledByUserId: uuid("disabled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ name: "feature_disables_pkey", columns: [t.userId, t.app, t.feature] }),
    check("feature_disables_feature_valid", sql`${t.feature} ~ '^[a-z_]{1,30}$'`),
    check("feature_disables_app_valid", sql`${t.app} ~ '^[a-z][a-z0-9-]{0,30}$'`),
  ],
);

/** グループ（組織）の設定（specs/019 FR-017）。閉じたグループの行は残すが、判定では使わない。 */
export const groupFeatureDisables = pgTable(
  "group_feature_disables",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => testGroups.id, { onDelete: "cascade" }),
    app: text("app").notNull().default("threads"),
    feature: text("feature").notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    disabledByUserId: uuid("disabled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ name: "group_feature_disables_pkey", columns: [t.groupId, t.app, t.feature] }),
    check("group_feature_disables_feature_valid", sql`${t.feature} ~ '^[a-z_]{1,30}$'`),
    check("group_feature_disables_app_valid", sql`${t.app} ~ '^[a-z][a-z0-9-]{0,30}$'`),
  ],
);

/** 機能の設定を変えた記録（specs/019 FR-014、research.md R7）。人かグループのどちらか一方。変えられた人が退会したら・グループを消したら消す。 */
export const featureSettingEvents = pgTable(
  "feature_setting_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "cascade" }),
    subjectGroupId: uuid("subject_group_id").references(() => testGroups.id, { onDelete: "cascade" }),
    app: text("app").notNull().default("threads"),
    feature: text("feature").notNull(),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    subjectName: text("subject_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    check("feature_setting_events_feature_valid", sql`${t.feature} ~ '^[a-z_]{1,30}$'`),
    check("feature_setting_events_app_valid", sql`${t.app} ~ '^[a-z][a-z0-9-]{0,30}$'`),
    check("feature_setting_events_action_valid", sql`${t.action} IN (${inList(FEATURE_EVENT_ACTIONS)})`),
    check("feature_setting_events_one_subject", sql`(${t.subjectUserId} IS NULL) <> (${t.subjectGroupId} IS NULL)`),
    index("feature_setting_events_created_idx").on(t.createdAt.desc()),
    index("feature_setting_events_subject_created_idx").on(t.subjectUserId, t.createdAt.desc()),
  ],
);

// ---- テスター招待・上限（specs/024-tester-invite-connect data-model.md）----

/** 運営者が決める値（1行だけ。data-model.md 1-2、research.md R6）。 */
export const operatorSettings = pgTable(
  "operator_settings",
  {
    id: smallint("id").primaryKey(),
    defaultAccountLimit: integer("default_account_limit").notNull().default(DEFAULT_ACCOUNT_LIMIT),
    defaultDailyPostLimit: integer("default_daily_post_limit").notNull().default(DEFAULT_DAILY_POST_LIMIT),
    testerSlotCapacity: integer("tester_slot_capacity").notNull().default(TESTER_SLOT_CAPACITY_DEFAULT),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    check("operator_settings_singleton", sql`${t.id} = 1`),
    check(
      "operator_settings_account_limit_range",
      sql`${t.defaultAccountLimit} BETWEEN 1 AND ${sql.raw(String(ACCOUNT_LIMIT_MAX))}`,
    ),
    check(
      "operator_settings_daily_post_limit_range",
      sql`${t.defaultDailyPostLimit} BETWEEN 1 AND ${sql.raw(String(DAILY_POST_LIMIT_MAX))}`,
    ),
    check(
      "operator_settings_slot_capacity_range",
      sql`${t.testerSlotCapacity} BETWEEN ${sql.raw(String(TESTER_SLOT_CAPACITY_MIN))} AND ${sql.raw(String(TESTER_SLOT_CAPACITY_MAX))}`,
    ),
  ],
);

/**
 * 招待の管理と上限の記録（data-model.md 1-3、research.md R14・R15）。detail には Threads のユーザー名・名前・メールアドレスを入れない。
 * 利用者の申し込み・取り消しも記録し、回数の制限に使う。
 */
export const operatorEvents = pgTable(
  "operator_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    applicationId: uuid("application_id").references(() => testerApplications.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    index("operator_events_actor_action_idx").on(t.actorUserId, t.action, t.createdAt),
    index("operator_events_created_idx").on(t.createdAt.desc()),
  ],
);

// ---- アプリを分けるための共通の土台（specs/meguru/029-threads-pattern1 data-model.md 2）----

/** 出来事（共通で起きたことを、あとからアプリに伝える。research.md R5）。中身に入れるのは番号だけ。 */
export const platformEvents = pgTable(
  "platform_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    check("platform_events_type_valid", sql`${t.type} ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'`),
    index("platform_events_created_idx").on(t.createdAt),
  ],
);

/** 出来事の届け先ごとの状態（research.md R5）。 */
export const platformEventDeliveries = pgTable(
  "platform_event_deliveries",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => platformEvents.id, { onDelete: "cascade" }),
    consumer: text("consumer").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, precision: 6 }),
  },
  (t) => [
    primaryKey({ name: "platform_event_deliveries_pkey", columns: [t.eventId, t.consumer] }),
    check("platform_event_deliveries_status_valid", sql`${t.status} IN ('pending', 'done', 'failed')`),
    check("platform_event_deliveries_attempts_range", sql`${t.attempts} >= 0`),
    index("platform_event_deliveries_due_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  ],
);

/** 利用の数・利用の状態（アプリが伝える。料金と「使っているアプリ」に使う。research.md R6）。 */
export const appUsage = pgTable(
  "app_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    quantity: integer("quantity").notNull().default(0),
    // 使っているか（using は Postgres の予約語なので列の名前は in_use）
    inUse: boolean("in_use").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "app_usage_pkey", columns: [t.userId, t.app] }),
    check("app_usage_quantity_range", sql`${t.quantity} >= 0`),
  ],
);

/** 利用者ごとの上限（アプリ・名前。research.md R7）。行がなければ既定の値。 */
export const userAppLimits = pgTable(
  "user_app_limits",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    key: text("key").notNull(),
    value: integer("value").notNull(),
  },
  (t) => [
    primaryKey({ name: "user_app_limits_pkey", columns: [t.userId, t.app, t.key] }),
    check("user_app_limits_value_range", sql`${t.value} >= 0`),
  ],
);

/** 上限の既定の値（アプリ・名前。research.md R7）。 */
export const appLimitDefaults = pgTable(
  "app_limit_defaults",
  {
    app: text("app").notNull(),
    key: text("key").notNull(),
    value: integer("value").notNull(),
  },
  (t) => [
    primaryKey({ name: "app_limit_defaults_pkey", columns: [t.app, t.key] }),
    check("app_limit_defaults_value_range", sql`${t.value} >= 0`),
  ],
);

// ---- 外部媒体展開（specs/021-external-media data-model.md）----
