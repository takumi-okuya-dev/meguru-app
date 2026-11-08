// Accountの作成・更新・上限（FR-008〜FR-017、research.md R8・R9）
import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { normalizeUsername } from "@threads-grower/shared";
import type { Env } from "../env";
import { createDb, withTransaction, type Db, type TxDb } from "../db/client";
import { lockThreadsUser, lockThreadsUsername, lockUserRow } from "../db/locks";
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
import { billingModeOf, testerInvitesEnabledOf, type BillingMode } from "../lib/config";
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
import { authorizeAccount } from "./access";
import { loadEntitlement, markQuantityDirty, syncQuantity } from "./billing-service";
import { recordActivity } from "./activity-log";
import type { ConsumedState } from "./threads-oauth";
import { beforeAccountDeleted } from "./team-service";
import { advanceOnConnect, withdrawForAccountDeletion } from "./tester-application-service";
import { effectiveLimits } from "./limit-service";

// ---- 登録数の上限（specs/013 research.md R9。001 FR-015〜FR-017 を置き換えた） ----

/**
 * ユーザーが owner として持つ Account の数（Threadsにつないでいないものも数える。specs/013 FR-013）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @returns 数
 */
export async function countOwnedAccounts(db: Db | TxDb, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));
  return Number(row?.n ?? 0);
}

/**
 * ユーザーの登録数の上限と使用数を求める。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param mode - 決済のモード
 * @param env - Workers のバインディング（運営者の判定。specs/024）
 * @param now - 今の時刻
 * @returns 上限（max。null は上限なし、0 は作れない）、使用数（used）、使える状態、前からの無料体験の上限が効いているか（trialBound）、
 *   運営者が決める上限（limits）
 */
export async function accountLimitFor(
  db: Db | TxDb,
  userId: string,
  mode: BillingMode,
  env: Pick<Env, "OPERATOR_CLERK_USER_IDS">,
  now: Date = new Date(),
) {
  const [entitlement, used, limits] = await Promise.all([
    loadEntitlement(db, userId, mode, now),
    countOwnedAccounts(db, userId),
    effectiveLimits(db, env, userId),
  ]);
  // 使える状態の上限（前からの無料体験なら1。読むだけ・契約前なら0）と、運営者が決める上限の小さい方（specs/024 FR-018）
  const byState = entitlement ? entitlement.accountLimit : 0;
  const byOperator = limits.accountLimit;
  const max = byState === null ? byOperator : byOperator === null ? byState : Math.min(byState, byOperator);
  // 前からの無料体験の上限が効いているか（エラーの文で契約を案内する）
  const trialBound = entitlement?.state === "trial" && max === byState;
  return { max, used, entitlement, trialBound, limits };
}

/**
 * 新しい Account を追加できるかを確かめる（specs/013 FR-010・FR-011・FR-043）。
 * 読むだけなら BILLING_REQUIRED、無料体験中で上限に達していれば ACCOUNT_LIMIT_REACHED。
 * 上限を超えて持っている（このfeatureの前に作った）アカウントは消さない（FR-014）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param mode - 決済のモード
 * @param env - Workers のバインディング（運営者の判定。specs/024）
 * @returns 上限・使用数
 * @throws AppError BILLING_REQUIRED・ACCOUNT_LIMIT_REACHED
 */
export async function assertCanAddAccount(db: Db | TxDb, userId: string, mode: BillingMode, env: Pick<Env, "OPERATOR_CLERK_USER_IDS">) {
  const limit = await accountLimitFor(db, userId, mode, env);
  const e = limit.entitlement;
  if (e && !e.fullAccess) {
    throw new AppError("BILLING_REQUIRED", 403, "billing required", undefined, [e.readOnlyReason ?? "trial_ended"]);
  }
  if (limit.max !== null && limit.used >= limit.max) {
    throw new AppError("ACCOUNT_LIMIT_REACHED", 409, "account limit reached", undefined, limit.trialBound ? ["trial"] : undefined, {
      max: limit.max,
    });
  }
  return limit;
}

// ---- アカウントを作る（specs/012 research.md R3） ----

/**
 * 名前だけで、Threadsにつないでいないアカウントを作る（specs/012 FR-002〜FR-004）。
 * 利用者の行に鍵をかけて上限を数え直し、アカウントとオーナーの Membership を同じトランザクションで作る。
 * 初期の設定（宣伝投稿の割合・プロンプトで作る件数など）は列の既定値で、つないで作っていたときと同じ。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param name - アカウントの名前（前後の空白を除いたもの）
 * @returns 作ったアカウントの行
 * @throws AppError ACCOUNT_LIMIT_REACHED
 */
export async function createAccount(env: Env, userId: string, name: string) {
  const created = await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, userId);
    await assertCanAddAccount(tx, userId, billingModeOf(env), env);
    const [account] = await tx
      .insert(accounts)
      .values({
        name,
        connectionStatus: "not_connected",
        connectionMethod: null,
      })
      .returning();
    await tx.insert(memberships).values({ userId, accountId: account!.id, role: "owner" });
    // 契約があれば、数の合わせ直しの印を付ける（specs/013 research.md R6）
    await markQuantityDirty(tx, userId);
    return account!;
  });
  // トランザクションの後でStripeの数を合わせる。失敗しても作成は成功のまま（印が残り、日次で合わせる）
  await syncQuantity(env, userId);
  return created;
}

// ---- 接続の確定（research.md R8 の手順。specs/010 research.md R5 でトークンの接続と共通にした） ----

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
 * 「最後に使ったAccount」を記録する（FR-007、research.md R10）。
 * 1つの条件付き UPDATE で、(a) receivedAt が記録以前のもの、(b) 同じ clientId で openSeq が記録以下のもの、を反映しない。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param accountId - 開いた Account の ID
 * @param req - ページごとの乱数ID（clientId）と連番（openSeq）
 * @param receivedAt - サーバーがリクエストを受け取った時刻
 * @param touchAccount - オーナーのときだけ accounts.last_used_at を変える（specs/008 research.md R11）
 * @returns 記録を更新したら true。古いリクエストで反映しなかったら false
 */
export async function openAccount(
  env: Env,
  userId: string,
  accountId: string,
  req: { clientId: string; openSeq: number },
  receivedAt: Date,
  /** オーナーのときだけ accounts.last_used_at を変える（手伝う人の操作でオーナーの並びを動かさない。specs/008 research.md R11） */
  touchAccount = true,
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
  if (touchAccount) await db.update(accounts).set({ lastUsedAt: receivedAt }).where(eq(accounts.id, accountId));
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

// ---- 名前を直す（specs/012 FR-040） ----

/**
 * アカウントの名前を直す。オーナーだけ。チームに入っているアカウントでは、前後の名前を操作の記録に残す。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param accountId - accounts.id
 * @param name - 新しい名前（前後の空白を除いたもの）
 * @returns 直した後の Account の行
 * @throws AppError ACCOUNT_NOT_FOUND・ROLE_FORBIDDEN
 */
export async function renameAccount(env: Env, userId: string, accountId: string, name: string) {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const access = await authorizeAccount(tx, { id: userId, billing: billingModeOf(env) }, accountId, "owner");
    const from = access.account.name;
    const [row] = await tx
      .update(accounts)
      .set({ name, updatedAt: new Date() })
      .where(eq(accounts.id, access.account.id))
      .returning();
    if (from !== name) {
      await recordActivity(tx, access, { kind: "settings", action: "account_renamed", details: { from, to: name } });
    }
    return row!;
  });
}

// ---- Accountの削除（FR-022、research.md R13） ----

/**
 * Account を削除する（FR-022、research.md R13）。
 * 1つのトランザクションで users の行をロックし、last_account_deleted_at を記録してから削除する。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param accountId - 削除する Account の ID
 * @param confirmName - 確認のために入力されたアカウントの名前（前後の空白は問わない。specs/012 FR-043）
 * @throws AppError ACCOUNT_NOT_FOUND・CONFIRMATION_MISMATCH
 */
export async function deleteAccount(
  env: Env,
  userId: string,
  accountId: string,
  confirmName: string,
) {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, userId);
    const { account } = await authorizeAccount(tx, { id: userId, billing: billingModeOf(env) }, accountId, "remove");
    if (!confirmName.trim() || confirmName.trim() !== account.name) {
      throw new AppError("CONFIRMATION_MISMATCH", 422, "confirmation does not match");
    }
    // チームの最後のアカウントなら、同じトランザクションでチームを抜けたものとする（specs/011 FR-046、research.md R7）
    await beforeAccountDeleted(tx, account.id, userId);
    // 招待の申し込みを取り下げにする（枠を使っていれば「外してよい」。specs/024 data-model.md 5）
    await withdrawForAccountDeletion(tx, account.id);
    const now = new Date();
    await tx
      .update(users)
      .set({ lastAccountDeletedAt: now, updatedAt: now })
      .where(eq(users.id, userId));
    await tx.delete(accounts).where(eq(accounts.id, account.id));
    await markQuantityDirty(tx, userId);
  });
  // 次の請求から数を減らす（日割りの返金はしない。specs/013 FR-030）
  await syncQuantity(env, userId);
}
