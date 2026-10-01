// Accountの作成・更新・上限（FR-008〜FR-017、research.md R8・R9）
import { and, eq, gt, gte, inArray, or, sql } from "drizzle-orm";
import { initialPlanFor, limitForOwnedPlans, type Plan } from "@threads-grower/shared";
import type { Env } from "../env";
import { withTransaction, type Db, type TxDb } from "../db/client";
import { lockThreadsUser, lockUserRow } from "../db/locks";
import {
  accounts,
  memberships,
  threadsConnections,
  threadsDeletionRequests,
  threadsRevocations,
  users,
} from "../db/schema";
import { createTokenCipher } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { threadsUserHmac } from "../lib/identifier-hash";
import { THREADS_SCOPES, type ThreadsProfile } from "../lib/threads-client";
import type { ConsumedState } from "./threads-oauth";

// ---- 登録数の上限（FR-015〜FR-017） ----

export async function ownedPlans(db: Db | TxDb, userId: string): Promise<Plan[]> {
  const rows = await db
    .select({ plan: accounts.plan })
    .from(accounts)
    .innerJoin(memberships, eq(memberships.accountId, accounts.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));
  return rows.map((r) => r.plan);
}

export async function accountLimitFor(db: Db | TxDb, userId: string) {
  const plans = await ownedPlans(db, userId);
  return { max: limitForOwnedPlans(plans), used: plans.length, plans };
}

/** 新しいAccountを追加できなければ ACCOUNT_LIMIT_REACHED */
export async function assertCanAddAccount(db: Db | TxDb, userId: string) {
  const limit = await accountLimitFor(db, userId);
  if (limit.used >= limit.max) throw new AppError("ACCOUNT_LIMIT_REACHED", 409, "account limit reached");
  return limit;
}

// ---- callback での接続の確定（research.md R8 の手順） ----

export type CompleteConnectionInput = {
  state: ConsumedState;
  threadsUserId: string;
  profile: ThreadsProfile;
  accessToken: string;
  expiresAt: Date;
  /** callback がリダイレクトを受け取った時刻（research.md R7） */
  authorizedAt: Date;
};

export type CompleteConnectionResult = {
  accountId: string;
  username: string;
  kind: "new" | "updated" | "reconnect";
};

export async function completeConnection(env: Env, input: CompleteConnectionInput): Promise<CompleteConnectionResult> {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  const hmac = await threadsUserHmac(env.IDENTIFIER_HASH_KEY, input.threadsUserId);
  const { state } = input;

  return withTransaction(env.DATABASE_URL, async (tx) => {
    // 1・2. ロックの順序は「アドバイザリーロック → users の行ロック」
    await lockThreadsUser(tx, input.threadsUserId);
    await lockUserRow(tx, state.userId);

    // 3. 認可の後に発行された取り消しがあれば拒否（callback の最中の連携解除）
    const [revoked] = await tx
      .select({ id: threadsRevocations.id })
      .from(threadsRevocations)
      .where(and(eq(threadsRevocations.threadsUserHmac, hmac), gte(threadsRevocations.issuedAt, input.authorizedAt)))
      .limit(1);
    if (revoked) throw new AppError("THREADS_AUTH_REVOKED", 409, "authorization revoked during callback");

    // 4. 未完了の削除要求、または認可フローの開始以降に完了した削除要求があれば拒否
    const [tombstone] = await tx
      .select({ code: threadsDeletionRequests.confirmationCode })
      .from(threadsDeletionRequests)
      .where(
        and(
          eq(threadsDeletionRequests.threadsUserHmac, hmac),
          or(
            inArray(threadsDeletionRequests.status, ["pending", "failed"]),
            gte(threadsDeletionRequests.completedAt, state.createdAt),
          ),
        ),
      )
      .limit(1);
    if (tombstone) throw new AppError("THREADS_DATA_DELETION_REQUESTED", 409, "data deletion requested");

    // 5. 認可フローの開始後にユーザーがAccountを削除していたら拒否（mode = new。research.md R13）
    if (state.mode === "new") {
      const [deletedAfter] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, state.userId), gt(users.lastAccountDeletedAt, state.createdAt)))
        .limit(1);
      if (deletedAfter) throw new AppError("ACCOUNT_DELETED_DURING_CONNECT", 409, "account deleted during connect");
    }

    // 6. Threadsユーザーで既存のAccountを探す
    const [existing] = await tx
      .select({ account: accounts, ownerId: memberships.userId })
      .from(accounts)
      .leftJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
      .where(eq(accounts.threadsUserId, input.threadsUserId))
      .limit(1);

    if (state.mode === "reconnect") {
      const [target] = await tx.select().from(accounts).where(eq(accounts.id, state.targetAccountId!)).limit(1);
      if (!target) throw new AppError("OAUTH_STATE_INVALID", 400, "reconnect target no longer exists");
      // 再接続は同じ Threads アカウントでだけ認める（FR-020）
      if (target.threadsUserId !== input.threadsUserId) {
        throw new AppError("RECONNECT_ACCOUNT_MISMATCH", 409, "reconnect with a different threads account");
      }
      await writeConnection(tx, cipher, target.id, input);
      return { accountId: target.id, username: input.profile.username, kind: "reconnect" };
    }

    if (existing) {
      // 7. 自分のAccountなら接続を更新（FR-013）。他人なら拒否（FR-012）
      if (existing.ownerId !== state.userId) {
        throw new AppError("THREADS_ACCOUNT_TAKEN", 409, "threads account owned by another user");
      }
      await writeConnection(tx, cipher, existing.account.id, input);
      return { accountId: existing.account.id, username: input.profile.username, kind: "updated" };
    }

    // 8. 上限を行ロックを持ったまま再判定してから作成する（FR-017、research.md R8）
    const limit = await assertCanAddAccount(tx, state.userId);
    const accountId = crypto.randomUUID();
    await tx.insert(accounts).values({
      id: accountId,
      threadsUserId: input.threadsUserId,
      username: input.profile.username,
      displayName: input.profile.name,
      profilePictureUrl: input.profile.profilePictureUrl,
      plan: initialPlanFor(limit.plans),
      connectionStatus: "connected",
      connectionGeneration: 0,
    });
    await tx.insert(memberships).values({ userId: state.userId, accountId, role: "owner" });
    await writeConnection(tx, cipher, accountId, input);
    return { accountId, username: input.profile.username, kind: "new" };
  });
}

/**
 * 接続（トークン）を条件なしで書き込み、世代番号を1増やす。
 * ユーザーの再認可はつねに優先する（research.md R6）。
 */
async function writeConnection(
  tx: TxDb,
  cipher: ReturnType<typeof createTokenCipher>,
  accountId: string,
  input: CompleteConnectionInput,
) {
  const enc = await cipher.encrypt(input.accessToken, accountId);
  const now = new Date();
  const values = {
    accessTokenCiphertext: enc.ciphertext,
    accessTokenIv: enc.iv,
    keyVersion: enc.keyVersion,
    scopes: [...THREADS_SCOPES],
    expiresAt: input.expiresAt,
    issuedAt: now,
    authorizedAt: input.authorizedAt,
    updatedAt: now,
  };
  await tx
    .insert(threadsConnections)
    .values({ accountId, ...values })
    .onConflictDoUpdate({ target: threadsConnections.accountId, set: values });
  await tx
    .update(accounts)
    .set({
      username: input.profile.username,
      displayName: input.profile.name,
      profilePictureUrl: input.profile.profilePictureUrl,
      connectionStatus: "connected",
      connectionGeneration: sql`${accounts.connectionGeneration} + 1`,
      updatedAt: now,
    })
    .where(eq(accounts.id, accountId));
}
