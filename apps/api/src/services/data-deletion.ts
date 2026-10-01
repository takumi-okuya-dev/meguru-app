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

const LEASE_MS = 15 * 60_000;
const IDENTIFIER_GRACE_MS = 15 * 60_000;
const RETENTION_TARGET_MS = 25 * 3600_000;

/** 受付（手順1・2）。重複なら既存の確認コードを返し、新しい行は作らない */
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

export type AttemptHooks = { beforeDelete?: () => void | Promise<void> };

/** 削除の試行（手順3・4）。claim できなければ何もしない */
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
        .select({ userId: memberships.userId })
        .from(accounts)
        .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
        .where(eq(accounts.threadsUserId, threadsUserId));
      for (const o of owners) {
        await lockUserRow(tx, o.userId);
        await tx.update(users).set({ lastAccountDeletedAt: now, updatedAt: now }).where(eq(users.id, o.userId));
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

/** Cron の再試行：最後に試みてから15分以上経った pending と failed（同じリースで扱う） */
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

/** 完了から15分以上経った要求の hmac を消し、残っている最古の行の経過時間をログに出す */
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
