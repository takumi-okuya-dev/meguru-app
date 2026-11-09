// Threadsとの接続の確定と確かめ（specs/001・010・012・024）。027で account-service から切り出した（接続はThreadsのもの。docs/module-map.md 2-2）。
import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { normalizeUsername } from "@threads-grower/shared";
import type { Env } from "../../../kernel/env";
import { createDb, withTransaction, type TxDb } from "../../../kernel/db/client";
import { lockThreadsUser, lockThreadsUsername, lockUserRow } from "../../../kernel/db/locks";
import { postDrafts, postingSchedules, publishAttempts, threadsConnections, threadsDeletionRequests, threadsRevocations } from "../schema";
import { accounts, memberships, authorizeAccount, recordActivity } from "../../../platform";
import { billingModeOf, testerInvitesEnabledOf } from "../../../kernel/config";
import { createTokenCipher } from "../../../kernel/crypto";
import { AppError } from "../../../kernel/errors";
import { threadsUserHmac } from "../../../kernel/identifier-hash";
import { logger } from "../../../kernel/logger";
import { THREADS_SCOPES, ThreadsAuthError, type ThreadsClient, type ThreadsProfile } from "../../../adapters/threads-api";
import type { ConsumedState } from "./threads-oauth";
import { advanceOnConnect } from "../tester-invites/tester-application-service";

/**
 * 接続の要求。OAuth では state の行から、トークンではリクエストから作る（specs/010 research.md R5）。
 * connect は未接続のアカウントにはじめてつなぐ、reconnect は接続し直す（specs/012 research.md R4）。
 */
export type ConnectionRequest = {
  userId: string;
  mode: "connect" | "reconnect";
  /** つなぐ・接続し直すAccount */
  targetAccountId: string;
  /** 接続を始めた時刻（OAuth は state の作成、トークンは要求を受け取った時刻） */
  startedAt: Date;
  /** 接続の方法 */
  method: "app" | "token";
};

/**
 * OAuth の state の行から接続の要求を作る。
 * @param state - 消費した state
 * @returns 接続の要求。012 より前の「つないで作る」（mode = new）の state なら NULL
 * @throws AppError ACCOUNT_NOT_FOUND（許可の画面にいる間に対象のアカウントが消された。specs/012 contracts/api.md）
 */
export function requestFromState(state: ConsumedState): ConnectionRequest | null {
  if (state.mode === "new") return null;
  if (!state.targetAccountId) throw new AppError("ACCOUNT_NOT_FOUND", 404, "target account deleted during connect");
  return {
    userId: state.userId,
    mode: state.mode,
    targetAccountId: state.targetAccountId,
    startedAt: state.createdAt,
    method: "app",
  };
}

/** 接続を確定するときの入力。 */
export type CompleteConnectionInput = {
  request: ConnectionRequest;
  threadsUserId: string;
  profile: ThreadsProfile;
  accessToken: string;
  expiresAt: Date;
  /** callback がリダイレクトを受け取った時刻（research.md R7）。トークンでは要求を受け取った時刻 */
  authorizedAt: Date;
  /** トークンの発行の時刻（トークンで debug_token が読めたとき。なければ今） */
  issuedAt?: Date;
  /** 許可された権限（トークンで debug_token が読めたとき。なければ001の3つ） */
  scopes?: readonly string[];
  /** 確かめ直しの時刻（トークンで期限を読めなかったとき。specs/010 research.md R8） */
  recheckAt?: Date | null;
  /** 反応数を読む権限がない（specs/006 の insights_denied_at を今にする） */
  insightsDenied?: boolean;
  /** 返信の権限がない（specs/023 の replies_denied_at を今にする） */
  repliesDenied?: boolean;
};

/** 接続を確定した結果。connect（はじめてつないだ）、reconnect（接続し直した）。 */
export type CompleteConnectionResult = {
  accountId: string;
  username: string;
  kind: "connect" | "reconnect";
};

/**
 * 接続を確定する（research.md R8 の手順を1つのトランザクションで行う。specs/012 research.md R4 で connect を足した）。
 * ロック → 取り消し・削除要求の確認 → 対象のアカウント（オーナーか・状態）→ 同じThreadsアカウントの照合 → 書き込み。
 * アカウントは作らない（名前だけで作る。createAccount）。
 * @param env - Workers のバインディング
 * @param input - 接続の要求・Threadsのユーザー・プロフィール・トークンなど
 * @returns 確定した Account と、その種類
 * @throws AppError THREADS_AUTH_REVOKED・THREADS_DATA_DELETION_REQUESTED・ACCOUNT_NOT_FOUND・ROLE_FORBIDDEN・
 *   ACCOUNT_ALREADY_CONNECTED・ACCOUNT_NOT_CONNECTED・RECONNECT_ACCOUNT_MISMATCH・ACCOUNT_ALREADY_REGISTERED・THREADS_ACCOUNT_TAKEN
 */
export async function completeConnection(
  env: Env,
  input: CompleteConnectionInput,
): Promise<CompleteConnectionResult> {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  const hmac = await threadsUserHmac(env.IDENTIFIER_HASH_KEY, input.threadsUserId);
  const state = input.request;

  return withTransaction(env.DATABASE_URL, async (tx) => {
    // 1・2. ロックの順序は「Threadsユーザー → ユーザー名（specs/010 research.md R6）→ users の行ロック」
    await lockThreadsUser(tx, input.threadsUserId);
    await lockThreadsUsername(tx, normalizeUsername(input.profile.username));
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
            gte(threadsDeletionRequests.completedAt, state.startedAt),
          ),
        ),
      )
      .limit(1);
    if (tombstone)
      throw new AppError("THREADS_DATA_DELETION_REQUESTED", 409, "data deletion requested");

    // 5. 対象のアカウント。許可の画面にいる間に消された・オーナーでなくなったら止める（specs/012 contracts/api.md）。
    //    接続はオーナーだけ（specs/008 FR-044、specs/012 FR-015）。トランザクションの中でも確かめ、記録に使う
    const [target] = await tx.select().from(accounts).where(eq(accounts.id, state.targetAccountId)).for("update").limit(1);
    if (!target) throw new AppError("ACCOUNT_NOT_FOUND", 404, "target account no longer exists");
    const access = await authorizeAccount(tx, { id: state.userId, billing: billingModeOf(env) }, target.id, "owner");
    const norm = normalizeUsername(input.profile.username);
    if (state.mode === "connect") {
      // 同じアカウントへの同時のつなぐ操作は、後の方を止める（黙って接続し直しにしない。specs/012 FR-018）
      if (target.connectionStatus !== "not_connected")
        throw new AppError("ACCOUNT_ALREADY_CONNECTED", 409, "account already connected");
    } else {
      if (target.connectionStatus === "not_connected" || target.username === null)
        throw new AppError("ACCOUNT_NOT_CONNECTED", 409, "account not connected yet");
      // 再接続は同じ Threads アカウントでだけ認める（FR-020）。同じかはユーザーIDかユーザー名で見る（specs/010 FR-032）
      if (target.threadsUserId !== input.threadsUserId && normalizeUsername(target.username) !== norm) {
        throw new AppError("RECONNECT_ACCOUNT_MISMATCH", 409, "reconnect with a different threads account");
      }
    }

    // 6. 同じThreadsアカウントの別のAccountを、ユーザーIDとユーザー名で探す（ユーザーIDはMetaアプリごとに違いうる。
    //    specs/010 research.md R6）。あれば書き換えない。自分のものならその名前を添え、他人なら登録した人を明かさない
    //    （specs/012 FR-021・FR-022。中身を移す操作はない）
    const [other] = await tx
      .select({ account: accounts, ownerId: memberships.userId })
      .from(accounts)
      .leftJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
      .where(
        and(
          ne(accounts.id, target.id),
          or(eq(accounts.threadsUserId, input.threadsUserId), sql`lower(${accounts.username}) = ${norm}`),
        ),
      )
      .orderBy(sql`${accounts.threadsUserId} = ${input.threadsUserId} DESC`)
      .limit(1);
    if (other) {
      if (other.ownerId === state.userId) {
        throw new AppError("ACCOUNT_ALREADY_REGISTERED", 409, "threads account already registered", undefined, [
          other.account.id,
          other.account.name,
          other.account.username ?? input.profile.username,
        ]);
      }
      throw new AppError("THREADS_ACCOUNT_TAKEN", 409, "threads account owned by another user");
    }

    // 7. 書き込む。チームがあるAccountでは、どちらの方法でも記録する（specs/010 FR-035、specs/012 FR-019）
    await writeConnection(tx, cipher, target.id, input);
    // 招待の申し込みを同じトランザクションで進める（specs/024 research.md R5）
    await advanceOnConnect(tx, {
      accountId: target.id,
      userId: state.userId,
      method: state.method,
      username: input.profile.username,
      threadsUserId: input.threadsUserId,
      invites: testerInvitesEnabledOf(env),
    });
    await recordActivity(tx, access, {
      kind: "settings",
      action: state.mode === "connect" ? "threads_connected" : "threads_reconnected",
      details: { method: state.method },
    });
    return { accountId: target.id, username: input.profile.username, kind: state.mode };
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
    scopes: [...(input.scopes ?? THREADS_SCOPES)],
    expiresAt: input.expiresAt,
    issuedAt: input.issuedAt ?? now,
    authorizedAt: input.authorizedAt,
    recheckAt: input.recheckAt ?? null,
    updatedAt: now,
  };
  await tx
    .insert(threadsConnections)
    .values({ accountId, ...values })
    .onConflictDoUpdate({ target: threadsConnections.accountId, set: values });
  await tx
    .update(accounts)
    .set({
      // 接続の方法を変えるとユーザーIDも変わりうる（specs/010 research.md R7）
      threadsUserId: input.threadsUserId,
      username: input.profile.username,
      displayName: input.profile.name,
      profilePictureUrl: input.profile.profilePictureUrl,
      connectionStatus: "connected",
      connectionMethod: input.request.method,
      reconnectHint: null,
      connectionGeneration: sql`${accounts.connectionGeneration} + 1`,
      // 再接続で反応数を読む権限が戻りうるので、権限のない印を消す（specs/006 research.md R11）。
      // トークンで権限がないと分かっているときは、今にする（specs/010 research.md R4）
      insightsDeniedAt: input.insightsDenied ? now : null,
      // つなぎ直しで返信の権限が戻りうるので消す。トークンで権限がないと分かっているときは今にする（specs/023 research.md R1）
      repliesDeniedAt: input.repliesDenied ? now : null,
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

// ---- 名前を直す（specs/012 FR-040） ----
