// Metaのデータ削除要求（research.md R7、contracts/api.md の data-deletion）。
// - 再送は検証済み signed_request 全体の SHA-256（request_fingerprint）で重複を除く
// - 削除の試行は、受付時もCronの再試行も、1つのトランザクションで
//   「アドバイザリーロック → 読み直し → 条件付き UPDATE で claim → 削除 → 完了の記録」の順に行う
// - 完了したら平文の threads_user_id を消し、tombstone 用の hmac は完了から15分以上経ったら日次Cronで消す
// 時刻の列は、読み戻した値と一致させるため、必ず JavaScript の Date で書く（DBの now() は使わない）
import { and, eq, inArray, isNotNull, lt, min, ne, sql } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, withTransaction } from "../db/client";
import { lockThreadsUser, lockUserRow } from "../db/locks";
import { accounts, memberships, threadsDeletionRequests, users } from "../db/schema";
import { sha256Hex, threadsUserHmac, toHex } from "../lib/identifier-hash";
import { logger } from "../lib/logger";
import { verifySignedRequest } from "../lib/signed-request";
import { markQuantityDirty } from "./billing-service";
import { beforeAccountDeleted } from "./team-service";

const LEASE_MS = 15 * 60_000;
const IDENTIFIER_GRACE_MS = 15 * 60_000;
const RETENTION_TARGET_MS = 25 * 3600_000;

/**
 * Meta のデータ削除要求を受け付ける（research.md R7 の手順1・2）。
 * signed_request 全体の SHA-256 で重複を除き、再送なら既存の確認コードを返して新しい行は作らない。
 * @param env - Workers のバインディング
 * @param signedRequest - Meta から受け取った signed_request
 * @param now - 受け付けた時刻
 * @returns 確認コードと、新しい要求かどうか
 * @throws SignedRequestError signed_request が不正なとき
 */
export async function receiveDeletion(
  env: Env,
  signedRequest: string,
  now: Date,
): Promise<{ code: string; isNew: boolean }> {
  const payload = await verifySignedRequest(signedRequest, env.THREADS_APP_SECRET);
  const fingerprint = await sha256Hex(signedRequest);
  const db = createDb(env.DATABASE_URL);
  const code = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const inserted = await db
    .insert(threadsDeletionRequests)
    .values({
      confirmationCode: code,
      requestFingerprint: fingerprint,
      threadsUserId: payload.userId,
      threadsUserHmac: await threadsUserHmac(env.IDENTIFIER_HASH_KEY, payload.userId),
      status: "pending",
      receivedAt: now,
      lastAttemptedAt: now,
    })
    .onConflictDoNothing({ target: threadsDeletionRequests.requestFingerprint })
    .returning({ code: threadsDeletionRequests.confirmationCode });
  if (inserted[0]) return { code: inserted[0].code, isNew: true };
  const [existing] = await db
    .select({ code: threadsDeletionRequests.confirmationCode })
    .from(threadsDeletionRequests)
    .where(eq(threadsDeletionRequests.requestFingerprint, fingerprint))
    .limit(1);
  return { code: existing!.code, isNew: false };
}

/** 削除の試行に差し込む処理（テストで失敗を起こすために使う）。 */
export type AttemptHooks = { beforeDelete?: () => void | Promise<void> };

/**
 * 削除を1回試みる（research.md R7「試行ごとの原子的なclaim」）。
 * 1つのトランザクションで、ロック → 読み直し → last_attempted_at を条件にした UPDATE で claim → Account の削除 → 完了の記録を行う。
 * claim できなければ何もしない。失敗したらロールバックし、別のトランザクションで failed を記録する。
 * @param env - Workers のバインディング
 * @param code - 確認コード
 * @param observedLastAttemptedAt - 最初に読み取った last_attempted_at（claim の条件）
 * @param hooks - 差し込む処理（テスト用）
 * @returns completed（削除した）・skipped（claim できなかった）・failed（失敗した）
 */
export async function attemptDeletion(
  env: Env,
  code: string,
  observedLastAttemptedAt: Date,
  hooks: AttemptHooks = {},
): Promise<"completed" | "skipped" | "failed"> {
  const db = createDb(env.DATABASE_URL);
  const [snapshot] = await db
    .select({ threadsUserId: threadsDeletionRequests.threadsUserId, status: threadsDeletionRequests.status })
    .from(threadsDeletionRequests)
    .where(eq(threadsDeletionRequests.confirmationCode, code))
    .limit(1);
  if (!snapshot || snapshot.status === "completed" || !snapshot.threadsUserId) return "skipped";
  const threadsUserId = snapshot.threadsUserId;

  try {
    return await withTransaction(env.DATABASE_URL, async (tx) => {
      // 1. ロック（callback と同じキー）
      await lockThreadsUser(tx, threadsUserId);
      // 2. 読み直して確かめる
      const [fresh] = await tx
        .select()
        .from(threadsDeletionRequests)
        .where(eq(threadsDeletionRequests.confirmationCode, code))
        .for("update")
        .limit(1);
      if (
        !fresh ||
        (fresh.status !== "pending" && fresh.status !== "failed") ||
        fresh.threadsUserId !== threadsUserId ||
        fresh.lastAttemptedAt.getTime() !== observedLastAttemptedAt.getTime()
      ) {
        return "skipped" as const;
      }
      // 3. 条件付き UPDATE で claim
      const now = new Date();
      const claimed = await tx
        .update(threadsDeletionRequests)
        .set({ attempts: fresh.attempts + 1, lastAttemptedAt: now })
        .where(
          and(
            eq(threadsDeletionRequests.confirmationCode, code),
            inArray(threadsDeletionRequests.status, ["pending", "failed"]),
            eq(threadsDeletionRequests.lastAttemptedAt, observedLastAttemptedAt),
          ),
        )
        .returning({ threadsUserId: threadsDeletionRequests.threadsUserId });
      if (claimed.length === 0) return "skipped" as const;

      await hooks.beforeDelete?.();

      // 4. Accountを削除する。所有者の users 行をロックして last_account_deleted_at を記録する（research.md R13）
      const owners = await tx
        .select({ userId: memberships.userId, accountId: accounts.id })
        .from(accounts)
        .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
        .where(eq(accounts.threadsUserId, threadsUserId));
      for (const o of owners) {
        await lockUserRow(tx, o.userId);
        // チームの最後のアカウントなら、チームを抜けたものとする（specs/011 FR-046。アカウントの削除と同じ）
        await beforeAccountDeleted(tx, o.accountId, o.userId);
        await tx.update(users).set({ lastAccountDeletedAt: now, updatedAt: now }).where(eq(users.id, o.userId));
        // 契約があれば、数の合わせ直しの印（日次の処理で合わせる。specs/013 research.md R6）
        await markQuantityDirty(tx, o.userId);
      }
      await tx.delete(accounts).where(eq(accounts.threadsUserId, threadsUserId));

      // 5. 完了を記録し、平文のIDを消す（hmac は完了の直前に始めた認可フローの照合に使うので残す）
      await tx
        .update(threadsDeletionRequests)
        .set({ status: "completed", completedAt: now, threadsUserId: null })
        .where(eq(threadsDeletionRequests.confirmationCode, code));
      return "completed" as const;
    });
  } catch (err) {
    logger.error("data deletion attempt failed", { code, err });
    // claim の更新もロールバックされているので、ここで試行を記録し直す
    await db
      .update(threadsDeletionRequests)
      .set({ status: "failed", lastAttemptedAt: new Date(), attempts: sql`${threadsDeletionRequests.attempts} + 1` })
      .where(and(eq(threadsDeletionRequests.confirmationCode, code), ne(threadsDeletionRequests.status, "completed")));
    return "failed";
  }
}

/**
 * Cron で削除要求を再試行する。最後に試みてから15分以上経った pending と failed を対象にする。
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻
 * @returns 試行した件数と、結果ごとの件数
 */
export async function retryDeletions(env: Env, now: Date) {
  const due = await createDb(env.DATABASE_URL)
    .select({ code: threadsDeletionRequests.confirmationCode, lastAttemptedAt: threadsDeletionRequests.lastAttemptedAt })
    .from(threadsDeletionRequests)
    .where(
      and(
        inArray(threadsDeletionRequests.status, ["pending", "failed"]),
        lt(threadsDeletionRequests.lastAttemptedAt, new Date(now.getTime() - LEASE_MS)),
      ),
    );
  const result = { attempted: 0, completed: 0, skipped: 0, failed: 0 };
  for (const r of due) {
    result.attempted += 1;
    const outcome = await attemptDeletion(env, r.code, r.lastAttemptedAt);
    result[outcome] += 1;
  }
  return result;
}

/**
 * 完了から15分以上経った削除要求の鍵付きハッシュを消し、残っている最古の行の経過時間をログに出す（25時間を超えたらエラー）。
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻
 * @returns 消した件数と、残っている最古の行の経過時間（ミリ秒。なければ null）
 */
export async function cleanupDeletionIdentifiers(env: Env, now: Date) {
  const db = createDb(env.DATABASE_URL);
  const cleared = await db
    .update(threadsDeletionRequests)
    .set({ threadsUserHmac: null })
    .where(
      and(
        eq(threadsDeletionRequests.status, "completed"),
        isNotNull(threadsDeletionRequests.threadsUserHmac),
        lt(threadsDeletionRequests.completedAt, new Date(now.getTime() - IDENTIFIER_GRACE_MS)),
      ),
    )
    .returning({ code: threadsDeletionRequests.confirmationCode });

  const [oldest] = await db
    .select({ completedAt: min(threadsDeletionRequests.completedAt) })
    .from(threadsDeletionRequests)
    .where(and(eq(threadsDeletionRequests.status, "completed"), isNotNull(threadsDeletionRequests.threadsUserHmac)));
  const oldestAgeMs = oldest?.completedAt ? now.getTime() - new Date(oldest.completedAt).getTime() : null;
  const fields = { cleared: cleared.length, oldestRemainingAgeMs: oldestAgeMs };
  if (oldestAgeMs !== null && oldestAgeMs > RETENTION_TARGET_MS) {
    logger.error("deletion identifiers retained longer than 25 hours", fields);
  } else {
    logger.info("deletion identifiers cleanup", fields);
  }
  return { cleared: cleared.length, oldestRemainingAgeMs: oldestAgeMs };
}

/**
 * データ削除要求の状況を返す。識別子は返さない。
 * @param env - Workers のバインディング
 * @param code - 確認コード
 * @returns 状態・受付日時・完了日時。確認コードが存在しなければ null
 */
export async function deletionStatus(env: Env, code: string) {
  const [row] = await createDb(env.DATABASE_URL)
    .select()
    .from(threadsDeletionRequests)
    .where(eq(threadsDeletionRequests.confirmationCode, code))
    .limit(1);
  if (!row) return null;
  return {
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
