// 使えない機能のまとまりの条件（specs/019-feature-switches data-model.md「判定」、research.md R10）。
// 使えないまとまり＝人の設定のOFF ∪ 入っている閉じていないグループの設定のOFF（どちらかでOFFならOFF。FR-018）。
// 判定の条件はここだけに置き、利用権（entitlement）と認証のミドルウェアがこれを使う（Constitution原則V）。
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { featureDisables, groupFeatureDisables, testGroupMembers, testGroups } from "../schema";

/**
 * その人の、まとまりごとのOFFの行（人の設定とグループの設定）を返す副問い合わせ。判定の条件はここだけに置く。
 * @param userId - users.id の列（外側の問い合わせの列）か値
 * @param app - アプリの番号（そのアプリの行だけ。specs/meguru/029 research.md R7・tasks.md T027）
 * @returns feature の1列を返す副問い合わせ
 */
function disabledRows(userId: AnyPgColumn | SQL, app: string): SQL {
  const own = sql` AND ${featureDisables.app} = ${app}`;
  const group = sql` AND ${groupFeatureDisables.app} = ${app}`;
  return sql`SELECT ${featureDisables.feature} AS feature FROM ${featureDisables} WHERE ${featureDisables.userId} = ${userId}${own}
    UNION
    SELECT ${groupFeatureDisables.feature} FROM ${testGroupMembers}
      JOIN ${testGroups} ON ${testGroups.id} = ${testGroupMembers.groupId} AND ${testGroups.closedAt} IS NULL
      JOIN ${groupFeatureDisables} ON ${groupFeatureDisables.groupId} = ${testGroupMembers.groupId}${group}
    WHERE ${testGroupMembers.userId} = ${userId}`;
}

/**
 * その人の、あるアプリの使えない機能の名前の配列（なければ空の配列。specs/meguru/029 research.md R7）。
 * @param userId - users.id の列か値
 * @param app - アプリの番号
 * @returns text[] の式
 */
export function disabledAppFeaturesSql(userId: AnyPgColumn | SQL, app: string): SQL<string[]> {
  return sql<string[]>`coalesce((SELECT array_agg(f.feature) FROM (${disabledRows(userId, app)}) f), '{}')`;
}

/**
 * 使えないまとまりの配列から、使えるまとまりの集合を作る。
 * @param disabled - 使えないまとまり（DBから読んだ配列）
 * @param keys - アプリが登録したまとまりの名前（登録の順）
 * @returns 使えるまとまり（登録の順）
 */
export function featuresFrom(disabled: readonly string[] | null | undefined, keys: readonly string[]): ReadonlySet<string> {
  const off = new Set(disabled ?? []);
  return new Set(keys.filter((f) => !off.has(f)));
}

