// Threadsの利用の数・利用の状態を数えて、共通へ伝える（specs/meguru/029-threads-pattern1 research.md R6、contracts/platform-entry.md 4）。
// 利用の数＝持ち主としてのアカウントの数（料金の数）。使っているか＝開けるアカウントがあるか、チームに入っているか
// （共通の /api/me の「使っているアプリ」は、この値で決まる。specs/028 research.md R6）。
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createDb, type Db, type TxDb } from "../../../kernel/db/client";
import { logger } from "../../../kernel/logger";
import { loadAppFeatures, reportUsage, usersWithUsage } from "../../../platform";
import { THREADS_APP } from "../registry";
import { memberships, teamMembers } from "../schema";

/** Threadsの利用の値。 */
export type ThreadsUsage = { quantity: number; using: boolean };

/**
 * その人のThreadsの利用の値を数える。チームを使えない人は、担当しているアカウントとチームを数えない（/api/me と同じ。specs/019 research.md R13）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - 利用者の番号
 * @returns 利用の数と、使っているか
 */
export async function countThreadsUsage(db: Db | TxDb, userId: string): Promise<ThreadsUsage> {
  const ownerM = alias(memberships, "owner_m");
  const [[owned], helpedOwners, [team]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner"))),
    db
      .select({ ownerUserId: ownerM.userId })
      .from(memberships)
      .innerJoin(ownerM, and(eq(ownerM.accountId, memberships.accountId), eq(ownerM.role, "owner")))
      .where(and(eq(memberships.userId, userId), inArray(memberships.role, ["editor"]))),
    db.select({ n: sql<number>`count(*)::int` }).from(teamMembers).where(eq(teamMembers.userId, userId)),
  ]);
  // チームのON/OFF（本人と、担当しているアカウントのオーナー）は、共通の入口の関数でまとめて読む（specs/meguru/029 tasks.md T036）
  const features = await loadAppFeatures(db, [userId, ...helpedOwners.map((r) => r.ownerUserId)], THREADS_APP);
  const quantity = Number(owned?.n ?? 0);
  const teamOn = features.get(userId)?.has("team") ?? false;
  const helped = helpedOwners.some((r) => features.get(r.ownerUserId)?.has("team"));
  const using = quantity > 0 || (teamOn && (helped || Number(team?.n ?? 0) > 0));
  return { quantity, using };
}

/**
 * その人のThreadsの利用の値を数えて、共通へ伝える。アカウントを作る・消す・Metaのデータ削除のトランザクションが
 * 終わったあと、応答を返す前に呼ぶ（チームの出入りでは「使っているか」は変わらない：チームに入るには自分のアカウントが要り、最後のアカウントを消すとチームからも外れる。
 * ずれは /api/threads/me と毎日の数え直しで直す。029 tasks.md PR5a の頭）。
 * 数える前の時刻を伝えるので、同時に伝えても古い値で上書きしない。失敗は例外のまま返す（呼ぶ側は trySyncThreadsUsage を使う）。
 * @param db - データベース
 * @param userId - 利用者の番号
 */
export async function syncThreadsUsage(db: Db | TxDb, userId: string): Promise<void> {
  const countedAt = new Date();
  const usage = await countThreadsUsage(db, userId);
  await reportUsage(db, userId, THREADS_APP, { ...usage, countedAt });
}

/**
 * syncThreadsUsage を呼び、失敗してもログに残すだけにする。トランザクションのあとで呼ぶので、ここで失敗しても
 * アカウントの作成・削除は成功のまま（ずれは /api/threads/me と毎日の数え直しで直す。research.md R6）。
 * @param db - データベース
 * @param userId - 利用者の番号
 * @returns 伝えられたら true
 */
export async function trySyncThreadsUsage(db: Db | TxDb, userId: string): Promise<boolean> {
  try {
    await syncThreadsUsage(db, userId);
    return true;
  } catch (err) {
    logger.error("threads usage: sync failed", { userId, err: String(err) });
    return false;
  }
}

/**
 * 毎日のまとめ処理：Threadsを使っている（使っていた）人全員の利用の値を数え直して伝える。
 * 伝えるのに失敗した分や、記録のずれを1日以内に直す（specs/meguru/029 research.md R6）。
 * @param env - Workers のバインディング（DATABASE_URL）
 * @returns 数え直した人数（1人の失敗で、ほかの人を止めない）
 */
export async function recountThreadsUsage(env: { DATABASE_URL: string }): Promise<number> {
  const db = createDb(env.DATABASE_URL);
  const [members, teamPeople, recorded] = await Promise.all([
    db.selectDistinct({ userId: memberships.userId }).from(memberships),
    db.selectDistinct({ userId: teamMembers.userId }).from(teamMembers),
    // 記録はあるが、もうアカウントもチームもない人も数え直す（0に戻す）
    usersWithUsage(db, THREADS_APP),
  ]);
  const ids = [...new Set([...members.map((r) => r.userId), ...teamPeople.map((r) => r.userId), ...recorded])];
  for (const id of ids) await trySyncThreadsUsage(db, id);
  return ids.length;
}
