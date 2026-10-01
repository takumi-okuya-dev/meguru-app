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

export type ConsumedState = typeof oauthStates.$inferSelect;

/** state を1回だけ消費する。ない・期限切れなら null */
export async function consumeState(db: Db, state: string): Promise<ConsumedState | null> {
  const [row] = await db
    .delete(oauthStates)
    .where(eq(oauthStates.stateHash, await sha256Hex(state)))
    .returning();
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row;
}
