// Threads接続フローの開始と state の扱い（research.md R3・R4）。
// state は32バイトの乱数。DBには SHA-256 だけを保存し、有効期限は10分、使えるのは1回だけ。
import { eq } from "drizzle-orm";
import type { ConnectRequest } from "@threads-grower/shared";
import type { Db } from "../db/client";
import { oauthStates } from "../db/schema";
import { sha256Hex } from "../lib/identifier-hash";
import type { ThreadsClient } from "../lib/threads-client";
import { assertCanAddAccount } from "./account-service";
import { findOwnedAccount } from "./access";

const STATE_TTL_MS = 10 * 60 * 1000;

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Threads接続フローを始め、認可URLを返す（research.md R3・R4）。
 * 新規なら認可に進む前に上限を判定する。再接続なら自分の Account かを確かめ、上限は判定しない。
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param userId - users.id
 * @param req - 新規（new）か再接続（reconnect と accountId）
 * @returns Threads の認可URL（state を含む）
 * @throws AppError ACCOUNT_LIMIT_REACHED（新規で上限に達している）・ACCOUNT_NOT_FOUND（再接続で自分の Account ではない）
 */
export async function startConnect(
  db: Db,
  threads: ThreadsClient,
  userId: string,
  req: ConnectRequest,
): Promise<string> {
  let targetAccountId: string | null = null;
  if (req.mode === "new") {
    // 認可に進む前に上限を判定する（FR-017）。callback でも行ロックを取って再判定する
    await assertCanAddAccount(db, userId);
  } else {
    // 再接続は既存Accountの認可し直し。上限の判定はしない（FR-013・FR-020）
    targetAccountId = (await findOwnedAccount(db, userId, req.accountId)).id;
  }

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
