// Threads接続フローの開始と state の扱い（research.md R3・R4）。
// state は32バイトの乱数。DBには SHA-256 だけを保存し、有効期限は10分、使えるのは1回だけ。
import { eq, lt } from "drizzle-orm";
import type { ConnectRequest } from "@meguru/shared";
import { createDb, type Db } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { oauthStates } from "../schema";
import { sha256Hex } from "../../../kernel/identifier-hash";
import type { ThreadsClient } from "../../../adapters/threads-api";
import { AppError } from "../../../kernel/errors";
import { authorizeAccount, type RequestUser } from "../access/access";

const STATE_TTL_MS = 10 * 60 * 1000;

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Threads接続フローを始め、認可URLを返す（research.md R3・R4）。
 * はじめてつなぐ（connect）も接続し直す（reconnect）も、対象のアカウントのオーナーかを確かめる。上限は判定しない
 * （アカウントは増えない。specs/012 FR-016）。connect は、対象がもうつながっていれば止める（specs/012 FR-018）。
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param user - リクエストしたユーザー（決済のモードを含む）
 * @param req - connect か reconnect と、対象のアカウント
 * @returns Threads の認可URL（state を含む）
 * @throws AppError ACCOUNT_NOT_FOUND（関わっていない Account）・ROLE_FORBIDDEN（オーナーではない）・ACCOUNT_ALREADY_CONNECTED・
 *   ACCOUNT_NOT_CONNECTED（未接続のアカウントの接続し直し）
 */
export async function startConnect(
  db: Db,
  threads: ThreadsClient,
  user: RequestUser,
  req: ConnectRequest,
): Promise<string> {
  const userId = user.id;
  // 接続はオーナーだけ（specs/008 FR-044、specs/012 FR-015。担当の人は ROLE_FORBIDDEN。読むだけなら BILLING_REQUIRED）
  const { account } = await authorizeAccount(db, user, req.accountId, "owner");
  if (req.mode === "connect" && account.connectionStatus !== "not_connected") {
    throw new AppError("ACCOUNT_ALREADY_CONNECTED", 409, "account already connected");
  }
  // 未接続のアカウントの接続し直しは、許可の画面に進む前に止める（callback でThreadsに問い合わせないように。PR #15 のCodexレビュー）
  if (req.mode === "reconnect" && account.connectionStatus === "not_connected") {
    throw new AppError("ACCOUNT_NOT_CONNECTED", 409, "account not connected yet");
  }
  const targetAccountId = account.id;

  const state = randomState();
  const now = Date.now();
  await db.insert(oauthStates).values({
    stateHash: await sha256Hex(state),
    userId,
    mode: req.mode,
    targetAccountId,
    expiresAt: new Date(now + STATE_TTL_MS),
    createdAt: new Date(now),
  });
  return threads.buildAuthorizeUrl(state);
}

/** 消費した state の行。 */
export type ConsumedState = typeof oauthStates.$inferSelect;

/**
 * state を1回だけ消費する。
 * @param db - データベース
 * @param state - callback で受け取った state（平文）
 * @returns state の行。ない・期限切れなら null
 */
export async function consumeState(db: Db, state: string): Promise<ConsumedState | null> {
  const [row] = await db
    .delete(oauthStates)
    .where(eq(oauthStates.stateHash, await sha256Hex(state)))
    .returning();
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

/**
 * 期限の過ぎた認可の state を消す（毎日の処理。027で jobs/daily-jobs.ts から移した）。
 * @param env - Workers のバインディング
 * @param now - 基準の時刻
 * @returns 消した数
 */
export async function cleanupExpiredOauthStates(env: Pick<Env, "DATABASE_URL">, now: Date) {
  return { deleted: (await createDb(env.DATABASE_URL).delete(oauthStates).where(lt(oauthStates.expiresAt, now)).returning()).length };
}
