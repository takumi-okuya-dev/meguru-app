// 自分のMetaアプリのトークンでの追加・接続し直し（specs/010-token-account-add research.md R1〜R9、contracts/api.md）。
// トークンの平文は、この関数の引数とローカルの変数の中だけで持つ。ログ・エラー・記録に渡さない（FR-043）。
import {
  TOKEN_ASSUMED_LIFETIME_DAYS,
  TOKEN_CHECK_FAILURE_LIMIT,
  TOKEN_CHECK_LOCK_MINUTES,
  TOKEN_CHECK_WINDOW_MINUTES,
  TOKEN_MIN_LIFETIME_HOURS,
  TOKEN_RECHECK_DELAY_MINUTES,
  cleanToken,
  isTokenShaped,
} from "@threads-grower/shared";
import { and, desc, eq, lt } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, withTransaction, type Db, type TxDb } from "../db/client";
import { lockUserRow } from "../db/locks";
import { tokenCheckFailures } from "../db/schema";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  THREADS_SCOPES,
  ThreadsAuthError,
  ThreadsApiError,
  ThreadsPermissionError,
  ThreadsRateLimitError,
  ThreadsTransientError,
  type ThreadsClient,
  type ThreadsProfile,
  type TokenDebugInfo,
} from "../lib/threads-client";
import { authorizeAccount, type RequestUser } from "./access";
import { completeConnection } from "./account-service";
import { notifyWake } from "./posting-schedule-service";
import { refreshUsernameOnlyMatch } from "./username-match";

const MIN = 60_000;

/** POST /api/threads/token-connect の要求（トークンは前後を取り除く前のもの）。connect ははじめてつなぐ（specs/012）。 */
export type TokenConnectRequest = { mode: "connect" | "reconnect"; accountId: string; token: string };

/** 権限がないものの案内（contracts/api.md）。 */
export type TokenWarning = "no_publish_permission" | "no_insights_permission";

/** つなぐ・接続し直しの結果。 */
export type TokenConnectResult = {
  accountId: string;
  kind: "connect" | "reconnect";
  username: string;
  warnings: TokenWarning[];
};

/** 失敗の理由（token_check_failures.reason）。確認中の予約は pending。 */
type FailureReason = "invalid_format" | "invalid" | "short_lived" | "account_mismatch";

/** 数える失敗（理由つき）として要求を終えるためのエラー。 */
class CountedFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    readonly error: AppError,
  ) {
    super(error.code);
  }
}

/**
 * 待ちの間かを確かめる（FR-015、research.md R9）。直近の5回の失敗が10分の間に収まり、5回目から10分たっていなければ待ち。
 * 待ちの間の要求は失敗に数えないので、待ちは延び続けない。
 * @param db - データベース
 * @param userId - users.id
 * @param now - 今
 * @throws AppError TOKEN_CHECK_LOCKED（429、details に残りの秒）
 */
export async function assertNotLocked(db: Db | TxDb, userId: string, now: Date): Promise<void> {
  const recent = await db
    .select({ failedAt: tokenCheckFailures.failedAt })
    .from(tokenCheckFailures)
    .where(eq(tokenCheckFailures.userId, userId))
    .orderBy(desc(tokenCheckFailures.failedAt))
    .limit(TOKEN_CHECK_FAILURE_LIMIT);
  if (recent.length < TOKEN_CHECK_FAILURE_LIMIT) return;
  const newest = recent[0]!.failedAt.getTime();
  const oldest = recent[recent.length - 1]!.failedAt.getTime();
  if (newest - oldest > TOKEN_CHECK_WINDOW_MINUTES * MIN) return;
  const remainingMs = newest + TOKEN_CHECK_LOCK_MINUTES * MIN - now.getTime();
  if (remainingMs <= 0) return;
  throw new AppError("TOKEN_CHECK_LOCKED", 429, "too many token check failures", undefined, [
    String(Math.ceil(remainingMs / 1000)),
  ]);
}

/**
 * 待ちの判定と、この確認の予約（pending の行）を、users の行ロックの中で行う（PR #12 のCodexレビュー）。
 * 同じ利用者の要求を並べて送っても、確認中の要求も数えるので、5回を超えてThreadsに問い合わせない。
 * 予約は、確認の終わりに失敗の理由へ書き換えるか、数えない結果（成功・一時的な失敗など）なら消す。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param now - 今
 * @returns 予約の行のID
 * @throws AppError TOKEN_CHECK_LOCKED
 */
async function reserveCheck(env: Env, userId: string, now: Date): Promise<string> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, userId);
    await assertNotLocked(tx, userId, now);
    const [row] = await tx
      .insert(tokenCheckFailures)
      .values({ userId, failedAt: now, reason: "pending" })
      .returning({ id: tokenCheckFailures.id });
    return row!.id;
  });
}

/**
 * 数える失敗にする。
 * @param reason - 理由
 * @param error - 利用者に返すエラー
 * @returns 投げるエラー
 */
const fail = (reason: FailureReason, error: AppError) => new CountedFailure(reason, error);

const invalid = () => new AppError("TOKEN_INVALID", 400, "token could not be verified");
const unavailable = () => new AppError("THREADS_UNAVAILABLE", 503, "threads temporarily unavailable");
const isTemporary = (err: unknown) => err instanceof ThreadsTransientError || err instanceof ThreadsRateLimitError;

/** トークンを調べた結果（research.md R2〜R4）。 */
type Inspection = {
  profile: ThreadsProfile;
  debug: TokenDebugInfo | null;
  warnings: TokenWarning[];
};

/**
 * トークンでThreadsに問い合わせる：プロフィール → debug_token → 投稿の上限 → フォロワー数（research.md R2〜R4）。
 * @param threads - Threads API のクライアント
 * @param token - トークン
 * @returns プロフィール・調べた結果・権限の案内。無効なら null
 * @throws AppError THREADS_UNAVAILABLE（一時的な失敗）
 */
async function inspectToken(threads: ThreadsClient, token: string): Promise<Inspection | null> {
  let profile: ThreadsProfile;
  try {
    profile = await threads.getProfile(token);
  } catch (err) {
    if (isTemporary(err)) throw unavailable();
    if (err instanceof ThreadsApiError || err instanceof ThreadsAuthError) return null;
    throw err;
  }

  let debug: TokenDebugInfo | null = null;
  try {
    debug = await threads.debugToken(token);
  } catch (err) {
    if (err instanceof ThreadsAuthError) return null;
    if (isTemporary(err)) throw unavailable();
    // 調べられない（権限・未対応など）ときは、60日とみなして後で確かめ直す（research.md R3）
    if (!(err instanceof ThreadsApiError)) throw err;
    logger.info("debug_token unavailable for pasted token", { kind: err.name });
  }

  const warnings: TokenWarning[] = [];
  // 権限の確かな判定は、005・006と同じ呼び出しで行う（research.md R4）
  for (const [warning, probe] of [
    ["no_publish_permission", () => threads.getPublishingLimit(token, profile.id)],
    ["no_insights_permission", () => threads.getFollowersCount(token, profile.id)],
  ] as const) {
    try {
      await probe();
    } catch (err) {
      if (err instanceof ThreadsAuthError) return null;
      if (err instanceof ThreadsPermissionError) warnings.push(warning);
      else if (!(err instanceof ThreadsApiError)) throw err;
      // 一時的な失敗などで確かめられない権限は、案内しない（次の確認で分かる）
    }
  }
  return { profile, debug, warnings };
}

/**
 * トークンで、未接続のAccountにはじめてつなぐ、または接続し直す（specs/010 contracts/api.md の手順、specs/012 research.md R4）。
 * @param env - Workers のバインディング
 * @param threads - Threads API のクライアント
 * @param user - ログインしたユーザー
 * @param req - 要求
 * @param now - 要求を受け取った時刻
 * @returns 確定したAccountと、権限の案内
 */
export async function connectWithToken(
  env: Env,
  threads: ThreadsClient,
  user: RequestUser,
  req: TokenConnectRequest,
  now: Date = new Date(),
): Promise<TokenConnectResult> {
  const db = createDb(env.DATABASE_URL);
  // つなぐ・接続し直すのはオーナーだけ（FR-034、specs/012 FR-015）。判定を先にして、権限のない人の要求や、
  // もうつながっているアカウントへの connect を失敗に数えない（specs/012 contracts/api.md）
  const { account } = await authorizeAccount(db, user, req.accountId, "owner");
  if (req.mode === "connect" && account.connectionStatus !== "not_connected")
    throw new AppError("ACCOUNT_ALREADY_CONNECTED", 409, "account already connected");
  if (req.mode === "reconnect" && account.connectionStatus === "not_connected")
    throw new AppError("ACCOUNT_NOT_CONNECTED", 409, "account not connected yet");
  const targetAccountId = account.id;

  const reservation = await reserveCheck(env, user.id, now);
  let failure: FailureReason | null = null;
  try {
    return await checkAndConnect(env, threads, user, req, targetAccountId, now);
  } catch (err) {
    if (err instanceof CountedFailure) {
      failure = err.reason;
      throw err.error;
    }
    throw err;
  } finally {
    // 失敗なら理由を書き、それ以外（成功・数えない失敗）は予約を消す。後片付けの失敗で、確定した結果や本来の
    // エラーを上書きしない（PR #12 のCodexレビュー）。消せなかった予約は失敗として数えられ、日次の処理で消える
    try {
      if (failure) {
        await db.update(tokenCheckFailures).set({ reason: failure }).where(eq(tokenCheckFailures.id, reservation));
      } else {
        await db.delete(tokenCheckFailures).where(eq(tokenCheckFailures.id, reservation));
      }
    } catch (err) {
      logger.error("failed to settle token check reservation", { err });
    }
  }
}

/**
 * トークンを確かめて、接続を確定する（予約の中で行う）。
 * @param env - Workers のバインディング
 * @param threads - Threads API のクライアント
 * @param user - ログインしたユーザー
 * @param req - 要求
 * @param targetAccountId - つなぐ・接続し直すAccount
 * @param now - 要求を受け取った時刻
 * @returns 確定したAccountと、権限の案内
 * @throws CountedFailure（数える失敗）、AppError（数えない失敗）
 */
async function checkAndConnect(
  env: Env,
  threads: ThreadsClient,
  user: { id: string },
  req: TokenConnectRequest,
  targetAccountId: string,
  now: Date,
): Promise<TokenConnectResult> {
  const token = cleanToken(req.token);
  if (!isTokenShaped(token)) throw fail("invalid_format", invalid());
  // つなぐことではアカウントは増えないので、登録の上限は判定しない（specs/012 FR-016）

  const found = await inspectToken(threads, token);
  if (!found) throw fail("invalid", invalid());
  const { profile, debug, warnings } = found;

  // 期限が短いトークンは短期トークンとみなす（research.md R3）
  if (debug?.expiresAt && debug.expiresAt.getTime() - now.getTime() < TOKEN_MIN_LIFETIME_HOURS * 60 * MIN) {
    throw fail("short_lived", new AppError("TOKEN_SHORT_LIVED", 400, "token is short-lived"));
  }
  const expiresAt = debug?.expiresAt ?? new Date(now.getTime() + TOKEN_ASSUMED_LIFETIME_DAYS * 24 * 60 * MIN);
  const recheckAt = debug ? null : new Date(now.getTime() + TOKEN_RECHECK_DELAY_MINUTES * MIN);

  // ユーザー名だけが一致するAccountがあれば、その今の名前を確かめてから確定する（FR-023、research.md R6）
  await refreshUsernameOnlyMatch(env, threads, profile);

  let result;
  try {
    result = await completeConnection(env, {
      request: { userId: user.id, mode: req.mode, targetAccountId, startedAt: now, method: "token" },
      threadsUserId: profile.id,
      profile,
      accessToken: token,
      expiresAt,
      authorizedAt: now,
      issuedAt: debug?.issuedAt ?? now,
      scopes: debug?.scopes.length ? debug.scopes : THREADS_SCOPES,
      recheckAt,
      insightsDenied: warnings.includes("no_insights_permission"),
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "RECONNECT_ACCOUNT_MISMATCH") throw fail("account_mismatch", err);
    throw err;
  }
  // 知らせの時刻は、確定の後の今にする。確認の間に定期処理が関所を書いていても、その開始より後になるように
  // （要求を受け取った時刻だと、関所に無視される。PR #12 のCodexレビュー）
  if (recheckAt) await notifyWake(env.AUTOPOST_KV, new Date());
  return {
    accountId: result.accountId,
    kind: result.kind,
    username: profile.username,
    warnings,
  };
}

/**
 * 1日より前の失敗の記録を消す（日次の処理。data-model.md）。
 * @param env - Workers のバインディング
 * @param now - 今
 */
export async function purgeTokenCheckFailures(env: Env, now: Date): Promise<void> {
  await createDb(env.DATABASE_URL)
    .delete(tokenCheckFailures)
    .where(and(lt(tokenCheckFailures.failedAt, new Date(now.getTime() - 24 * 60 * MIN))));
}
