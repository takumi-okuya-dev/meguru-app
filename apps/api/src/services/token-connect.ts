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
import { createDb, type Db } from "../db/client";
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
import { authorizeAccount } from "./access";
import { assertCanAddAccount, completeConnection } from "./account-service";
import { notifyWake } from "./posting-schedule-service";
import { refreshUsernameOnlyMatch } from "./username-match";

const MIN = 60_000;

/** POST /api/threads/token-connect の要求（トークンは前後を取り除く前のもの）。 */
export type TokenConnectRequest = { mode: "new"; token: string } | { mode: "reconnect"; accountId: string; token: string };

/** 権限がないものの案内（contracts/api.md）。 */
export type TokenWarning = "no_publish_permission" | "no_insights_permission";

/** 追加・接続し直しの結果。 */
export type TokenConnectResult = {
  accountId: string;
  kind: "new" | "reconnect";
  username: string;
  warnings: TokenWarning[];
};

/** 失敗の理由（token_check_failures.reason）。 */
type FailureReason = "invalid_format" | "invalid" | "short_lived" | "account_mismatch";

/**
 * 待ちの間かを確かめる（FR-015、research.md R9）。直近の5回の失敗が10分の間に収まり、5回目から10分たっていなければ待ち。
 * 待ちの間の要求は失敗に数えないので、待ちは延び続けない。
 * @param db - データベース
 * @param userId - users.id
 * @param now - 今
 * @throws AppError TOKEN_CHECK_LOCKED（429、details に残りの秒）
 */
export async function assertNotLocked(db: Db, userId: string, now: Date): Promise<void> {
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
 * 失敗を記録して、そのエラーを投げる。
 * @param db - データベース
 * @param userId - users.id
 * @param reason - 理由
 * @param error - 投げるエラー
 * @param now - 今
 */
async function fail(db: Db, userId: string, reason: FailureReason, error: AppError, now: Date): Promise<never> {
  await db.insert(tokenCheckFailures).values({ userId, failedAt: now, reason });
  throw error;
}

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
 * トークンでAccountを追加する、または接続し直す（contracts/api.md の手順）。
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
  user: { id: string },
  req: TokenConnectRequest,
  now: Date = new Date(),
): Promise<TokenConnectResult> {
  const db = createDb(env.DATABASE_URL);
  // 接続し直しはオーナーだけ（FR-034）。判定を先にして、権限のない人の要求を失敗に数えない
  const targetAccountId =
    req.mode === "reconnect" ? (await authorizeAccount(db, user, req.accountId, "owner")).account.id : null;

  await assertNotLocked(db, user.id, now);
  const token = cleanToken(req.token);
  if (!isTokenShaped(token)) await fail(db, user.id, "invalid_format", invalid(), now);
  if (req.mode === "new") await assertCanAddAccount(db, user.id);

  const found = await inspectToken(threads, token);
  if (!found) return fail(db, user.id, "invalid", invalid(), now);
  const { profile, debug, warnings } = found;

  // 期限が短いトークンは短期トークンとみなす（research.md R3）
  if (debug?.expiresAt && debug.expiresAt.getTime() - now.getTime() < TOKEN_MIN_LIFETIME_HOURS * 60 * MIN) {
    await fail(db, user.id, "short_lived", new AppError("TOKEN_SHORT_LIVED", 400, "token is short-lived"), now);
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
    if (err instanceof AppError && err.code === "RECONNECT_ACCOUNT_MISMATCH") {
      await fail(db, user.id, "account_mismatch", err, now);
    }
    throw err;
  }
  if (recheckAt) await notifyWake(env.AUTOPOST_KV, now);
  return {
    accountId: result.accountId,
    kind: result.kind === "reconnect" ? "reconnect" : "new",
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
