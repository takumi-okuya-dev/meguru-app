// 宣伝内容・参考投稿・キーワードで共通の処理（specs/002-strategy-profile research.md R3・R4）。
// 表ごとのクエリは呼び出し側が渡し、ここでは「上限つきの追加」「version つきの更新」の手順だけを持つ。
import { sql } from "drizzle-orm";
import { withTransaction, type TxDb } from "../db/client";
import type { Env } from "../env";
import { AppError, itemNotFound, notFound, pgErrorCode } from "../lib/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 上限を数える種類。アドバイザリーロックのキーに使う。 */
export type ItemKind = "promotions" | "reference_posts" | "research_keywords";

/**
 * パスの子の行のIDを確かめる。UUID の形でなければ、DB のエラーにせず「見つからない」にする。
 * @param id - パスの ID
 * @returns そのままの ID
 * @throws AppError ITEM_NOT_FOUND（UUID の形でない）
 */
export function assertItemId(id: string): string {
  if (!UUID_RE.test(id)) throw itemNotFound();
  return id;
}

/**
 * 件数の上限を守って1件追加する（research.md R4）。
 * 「Account × 種類」単位のアドバイザリーロックで直列化してから数えるので、同時の追加でも上限を超えない。
 * @param env - Workers のバインディング（DATABASE_URL を使う）
 * @param accountId - accounts.id
 * @param kind - 種類（ロックのキー）
 * @param limit - 件数の上限
 * @param count - 今の件数を数える処理
 * @param insert - 1件追加して、追加した行を返す処理
 * @returns 追加した行
 * @throws AppError ITEM_LIMIT_REACHED（上限に達している）、ACCOUNT_NOT_FOUND（追加の途中でAccountが削除された）
 */
export async function insertWithLimit<T>(
  env: Env,
  accountId: string,
  kind: ItemKind,
  limit: number,
  count: (tx: TxDb) => Promise<number>,
  insert: (tx: TxDb) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(env.DATABASE_URL, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account_items:${accountId}:${kind}`}, 0))`);
      if ((await count(tx)) >= limit) throw new AppError("ITEM_LIMIT_REACHED", 409, "item limit reached");
      return insert(tx);
    });
  } catch (err) {
    // 外部キー違反：追加の途中でAccountが削除された
    if (pgErrorCode(err) === "23503") throw notFound();
    throw err;
  }
}

/**
 * version が一致する場合だけ更新する（research.md R3）。
 * @param update - `version = expectedVersion` を条件に更新し、更新した行を返す処理（0行なら空配列）
 * @param findCurrent - 今の行を取得する処理（なければ undefined）
 * @param toLatest - 409 のときに返す形にする関数
 * @param updatedByOf - 409 のときに、先に保存した人を求める関数（specs/008 FR-007）
 * @returns 更新した行
 * @throws AppError STALE_UPDATE（他で先に更新された。latest 付き）、ITEM_NOT_FOUND（削除された）
 */
export async function updateWithVersion<T>(
  update: () => Promise<T[]>,
  findCurrent: () => Promise<T | undefined>,
  toLatest: (row: T) => unknown,
  updatedByOf?: (row: T) => Promise<{ name: string } | null>,
): Promise<T> {
  const [updated] = await update();
  if (updated) return updated;
  const current = await findCurrent();
  if (!current) throw itemNotFound();
  // 先に保存した人の名前を添える（specs/008 FR-007、research.md R8）
  const updatedBy = updatedByOf ? await updatedByOf(current) : undefined;
  throw new AppError("STALE_UPDATE", 409, "updated elsewhere", toLatest(current), undefined, updatedBy === undefined ? undefined : { updatedBy });
}
