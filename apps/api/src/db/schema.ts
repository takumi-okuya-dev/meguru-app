// DBスキーマ（specs/001-login-account-setup/data-model.md）。
// Accountに紐づくテーブルはすべて ON DELETE CASCADE とする（後続featureも守る規約。research.md R13）。
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { PLANS } from "@threads-grower/shared";

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

export const accountPlan = pgEnum("account_plan", PLANS);
export const membershipRole = pgEnum("membership_role", ["owner", "member"]);
export const connectionStatus = pgEnum("connection_status", ["connected", "needs_reconnect"]);
export const oauthMode = pgEnum("oauth_mode", ["new", "reconnect"]);
export const deletionStatus = pgEnum("deletion_status", ["pending", "completed", "failed"]);

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
  ...timestamps,
});

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

