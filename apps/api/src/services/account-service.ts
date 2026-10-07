// Accountの作成・更新・上限（FR-008〜FR-017、research.md R8・R9）
import { and, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  initialPlanFor,
  limitForOwnedPlans,
  normalizeUsername,
  type Plan,
} from "@threads-grower/shared";
import type { Env } from "../env";
import { createDb, withTransaction, type Db, type TxDb } from "../db/client";
import { lockThreadsUser, lockUserRow } from "../db/locks";
import {
  accounts,
  memberships,
  postDrafts,
  postingSchedules,
  publishAttempts,
  threadsConnections,
  threadsDeletionRequests,
  threadsRevocations,
  users,
} from "../db/schema";
import { createTokenCipher } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { threadsUserHmac } from "../lib/identifier-hash";
import { logger } from "../lib/logger";
import {
  THREADS_SCOPES,
  ThreadsAuthError,
  type ThreadsClient,
  type ThreadsProfile,
} from "../lib/threads-client";
import { findOwnedAccount } from "./access";
import type { ConsumedState } from "./threads-oauth";

// ---- 登録数の上限（FR-015〜FR-017） ----

/**
 * ユーザーが owner として持つ Account のプランを取得する。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @returns プランの一覧
 */
export async function ownedPlans(db: Db | TxDb, userId: string): Promise<Plan[]> {
  const rows = await db
    .select({ plan: accounts.plan })
    .from(accounts)
    .innerJoin(memberships, eq(memberships.accountId, accounts.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));
  return rows.map((r) => r.plan);
}

/**
 * ユーザーの登録数上限と使用数を求める（FR-015・FR-016）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @returns 上限（max）、使用数（used）、保有Accountのプラン（plans）
 */
export async function accountLimitFor(db: Db | TxDb, userId: string) {
  const plans = await ownedPlans(db, userId);
  return { max: limitForOwnedPlans(plans), used: plans.length, plans };
}

/**
 * 新しい Account を追加できるかを確かめる（FR-017）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @returns 上限・使用数・保有Accountのプラン
 * @throws AppError ACCOUNT_LIMIT_REACHED（上限に達しているとき）
 */
export async function assertCanAddAccount(db: Db | TxDb, userId: string) {
  const limit = await accountLimitFor(db, userId);
  if (limit.used >= limit.max)
    throw new AppError("ACCOUNT_LIMIT_REACHED", 409, "account limit reached");
  return limit;
}

// ---- callback での接続の確定（research.md R8 の手順） ----

/** callback で接続を確定するときの入力。 */
export type CompleteConnectionInput = {
  state: ConsumedState;
  threadsUserId: string;
  profile: ThreadsProfile;
  accessToken: string;
  expiresAt: Date;
  /** callback がリダイレクトを受け取った時刻（research.md R7） */
  authorizedAt: Date;
};

/** callback で接続を確定した結果。new（新規）、updated（既存を更新）、reconnect（再接続）。 */
export type CompleteConnectionResult = {
  accountId: string;
  username: string;
  kind: "new" | "updated" | "reconnect";
};

/**
 * callback で接続を確定する（research.md R8 の手順を1つのトランザクションで行う）。
 * ロック → 取り消し・削除要求・Account削除の確認 → 既存の Account の更新、または上限を再判定して作成。
 * @param env - Workers のバインディング
 * @param input - 消費した state・Threadsのユーザー・プロフィール・トークンなど
 * @returns 確定した Account と、その種類
 * @throws AppError THREADS_AUTH_REVOKED・THREADS_DATA_DELETION_REQUESTED・ACCOUNT_DELETED_DURING_CONNECT・RECONNECT_ACCOUNT_MISMATCH・THREADS_ACCOUNT_TAKEN・ACCOUNT_LIMIT_REACHED など
 */
export async function completeConnection(
  env: Env,
  input: CompleteConnectionInput,
): Promise<CompleteConnectionResult> {
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
      .where(
        and(
          eq(threadsRevocations.threadsUserHmac, hmac),
          gte(threadsRevocations.issuedAt, input.authorizedAt),
        ),
      )
      .limit(1);
    if (revoked)
      throw new AppError("THREADS_AUTH_REVOKED", 409, "authorization revoked during callback");

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
    if (tombstone)
      throw new AppError("THREADS_DATA_DELETION_REQUESTED", 409, "data deletion requested");

    // 5. 認可フローの開始後にユーザーがAccountを削除していたら拒否（mode = new。research.md R13）
    if (state.mode === "new") {
      const [deletedAfter] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, state.userId), gt(users.lastAccountDeletedAt, state.createdAt)))
        .limit(1);
      if (deletedAfter)
        throw new AppError("ACCOUNT_DELETED_DURING_CONNECT", 409, "account deleted during connect");
    }

    // 6. Threadsユーザーで既存のAccountを探す
    const [existing] = await tx
      .select({ account: accounts, ownerId: memberships.userId })
      .from(accounts)
      .leftJoin(
        memberships,
        and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")),
      )
      .where(eq(accounts.threadsUserId, input.threadsUserId))
      .limit(1);

    if (state.mode === "reconnect") {
      const [target] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, state.targetAccountId!))
        .limit(1);
      if (!target)
        throw new AppError("OAUTH_STATE_INVALID", 400, "reconnect target no longer exists");
      // 再接続は同じ Threads アカウントでだけ認める（FR-020）
      if (target.threadsUserId !== input.threadsUserId) {
        throw new AppError(
          "RECONNECT_ACCOUNT_MISMATCH",
          409,
          "reconnect with a different threads account",
        );
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
 * 接続（トークン）を条件なしで書き込み、世代番号を1増やす。ユーザーの再認可はつねに優先する（research.md R6）。
 * @param tx - トランザクション
 * @param cipher - トークンの暗号器
 * @param accountId - accounts.id（暗号化の AAD にも使う）
 * @param input - トークン・有効期限・認可の時刻・プロフィール
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
  // 再接続より前の時刻を拾わない。設定の版は変えない（005 FR-016）。
  await tx
    .update(postingSchedules)
    .set({ effectiveFrom: now })
    .where(eq(postingSchedules.accountId, accountId));
  // 再接続より前に取り、まだ公開を送っていない試みは進めない：飛ばして（要再接続）、下書きを承認済みに戻す。
  // 札を消すので、実行中の古い処理は以後の更新も公開もできない。公開の結果がわからない試みは確かめ続ける（005 PR #6）
  const stale = await tx
    .select({
      id: publishAttempts.id,
      draftId: publishAttempts.draftId,
      isCarryover: publishAttempts.isCarryover,
    })
    .from(publishAttempts)
    .where(
      and(
        eq(publishAttempts.accountId, accountId),
        inArray(publishAttempts.state, ["in_progress", "retry_wait"]),
        isNull(publishAttempts.publishRequestedAt),
      ),
    )
    .for("update");
  if (stale.length === 0) return;
  await tx
    .update(publishAttempts)
    .set({
      state: "skipped",
      skipReason: "needs_reconnect",
      draftId: null,
      leaseUntil: null,
      leaseToken: null,
      updatedAt: now,
    })
    .where(
      inArray(
        publishAttempts.id,
        stale.map((a) => a.id),
      ),
    );
  // 持ち越しの試みなら、持ち越しの印を付け直す（取り出しで消しているので。次の時刻の優先と「持ち越しは1回だけ」を保つ）
  for (const a of stale) {
    if (!a.draftId) continue;
    await tx
      .update(postDrafts)
      .set({
        status: "approved",
        ...(a.isCarryover ? { carryoverAttemptId: a.id } : {}),
        version: sql`${postDrafts.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(postDrafts.id, a.draftId), eq(postDrafts.status, "publishing")));
  }
}

// ---- Accountの画面を開いたとき（research.md R10・R14） ----

/**
 * 「最後に使ったAccount」を記録する（FR-007、research.md R10）。
 * 1つの条件付き UPDATE で、(a) receivedAt が記録以前のもの、(b) 同じ clientId で openSeq が記録以下のもの、を反映しない。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param accountId - 開いた Account の ID
 * @param req - ページごとの乱数ID（clientId）と連番（openSeq）
 * @param receivedAt - サーバーがリクエストを受け取った時刻
 * @returns 記録を更新したら true。古いリクエストで反映しなかったら false
 */
export async function openAccount(
  env: Env,
  userId: string,
  accountId: string,
  req: { clientId: string; openSeq: number },
  receivedAt: Date,
): Promise<boolean> {
  const db = createDb(env.DATABASE_URL);
  const updated = await db
    .update(users)
    .set({
      lastAccountId: accountId,
      lastAccountClientId: req.clientId,
      lastAccountOpenSeq: req.openSeq,
      lastAccountOpenReceivedAt: receivedAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, userId),
        or(
          isNull(users.lastAccountOpenReceivedAt),
          lt(users.lastAccountOpenReceivedAt, receivedAt),
        ),
        or(
          isNull(users.lastAccountClientId),
          ne(users.lastAccountClientId, req.clientId),
          isNull(users.lastAccountOpenSeq),
          lt(users.lastAccountOpenSeq, req.openSeq),
        ),
      ),
    )
    .returning({ id: users.id });
  if (updated.length === 0) return false;
  await db.update(accounts).set({ lastUsedAt: receivedAt }).where(eq(accounts.id, accountId));
  return true;
}

/**
 * 保存しているトークンでプロフィールを取得して、接続を確かめる（FR-018、research.md R14）。
 * 成功ならプロフィールを最新にし、認証エラーなら needs_reconnect にする。それ以外の失敗では状態を変えない。
 * 書き込みは、読んだ時点の connection_generation を条件にする（research.md R6）。
 * @param env - Workers のバインディング
 * @param accountId - accounts.id
 * @param threads - Threads API のクライアント
 */
export async function verifyConnection(
  env: Env,
  accountId: string,
  threads: ThreadsClient,
): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  const [row] = await db
    .select({ generation: accounts.connectionGeneration, conn: threadsConnections })
    .from(accounts)
    .innerJoin(threadsConnections, eq(threadsConnections.accountId, accounts.id))
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row) return;

  const sameGeneration = and(
    eq(accounts.id, accountId),
    eq(accounts.connectionGeneration, row.generation),
  );
  let token: string;
  try {
    const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
    token = await cipher.decrypt(
      {
        ciphertext: row.conn.accessTokenCiphertext,
        iv: row.conn.accessTokenIv,
        keyVersion: row.conn.keyVersion,
      },
      accountId,
    );
  } catch (err) {
    // 鍵の設定ミスなどで復号できないときは、接続状態を変えずにログだけ残す（research.md R5）
    logger.error("failed to decrypt threads token", { accountId, err });
    return;
  }

  try {
    const profile = await threads.getProfile(token);
    await db
      .update(accounts)
      .set({
        username: profile.username,
        displayName: profile.name,
        profilePictureUrl: profile.profilePictureUrl,
        updatedAt: new Date(),
      })
      .where(sameGeneration);
  } catch (err) {
    if (err instanceof ThreadsAuthError) {
      await db
        .update(accounts)
        .set({ connectionStatus: "needs_reconnect", updatedAt: new Date() })
        .where(sameGeneration);
      return;
    }
    logger.warn("threads profile check failed", { accountId, err });
  }
}

// ---- Accountの削除（FR-022、research.md R13） ----

/**
 * Account を削除する（FR-022、research.md R13）。
 * 1つのトランザクションで users の行をロックし、last_account_deleted_at を記録してから削除する。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param accountId - 削除する Account の ID
 * @param confirmUsername - 確認のために入力されたユーザー名（@の有無・大文字小文字は問わない）
 * @throws AppError ACCOUNT_NOT_FOUND・CONFIRMATION_MISMATCH
 */
export async function deleteAccount(
  env: Env,
  userId: string,
  accountId: string,
  confirmUsername: string,
) {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, userId);
    const account = await findOwnedAccount(tx, userId, accountId);
    if (
      normalizeUsername(confirmUsername) !== normalizeUsername(account.username) ||
      !confirmUsername.trim()
    ) {
      throw new AppError("CONFIRMATION_MISMATCH", 422, "confirmation does not match");
    }
    const now = new Date();
    await tx
      .update(users)
      .set({ lastAccountDeletedAt: now, updatedAt: now })
      .where(eq(users.id, userId));
    await tx.delete(accounts).where(eq(accounts.id, account.id));
  });
}
