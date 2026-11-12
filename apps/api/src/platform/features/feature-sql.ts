// 使えない機能のまとまりの条件（specs/019-feature-switches data-model.md「判定」、research.md R10）。
// 使えないまとまり＝人の設定のOFF ∪ 入っている閉じていないグループの設定のOFF（どちらかでOFFならOFF。FR-018）。
// 判定の条件はここだけに置き、authorizeAccount・認証のミドルウェア・定期処理のすべてがこれを使う（Constitution原則V）。
import { FEATURES, type Feature } from "@meguru/shared";
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { featureDisables, groupFeatureDisables, testGroupMembers, testGroups } from "../schema";

/**
 * その人の、まとまりごとのOFFの行（人の設定とグループの設定）を返す副問い合わせ。判定の条件はここだけに置く。
 * @param userId - users.id の列（外側の問い合わせの列）か値
 * @param app - アプリの番号（渡すとそのアプリの行だけ。specs/meguru/029 research.md R7）
 * @returns feature の1列を返す副問い合わせ
 */
function disabledRows(userId: AnyPgColumn | SQL, app?: string): SQL {
  const own = app === undefined ? sql`` : sql` AND ${featureDisables.app} = ${app}`;
  const group = app === undefined ? sql`` : sql` AND ${groupFeatureDisables.app} = ${app}`;
  return sql`SELECT ${featureDisables.feature} AS feature FROM ${featureDisables} WHERE ${featureDisables.userId} = ${userId}${own}
    UNION
    SELECT ${groupFeatureDisables.feature} FROM ${testGroupMembers}
      JOIN ${testGroups} ON ${testGroups.id} = ${testGroupMembers.groupId} AND ${testGroups.closedAt} IS NULL
      JOIN ${groupFeatureDisables} ON ${groupFeatureDisables.groupId} = ${testGroupMembers.groupId}${group}
    WHERE ${testGroupMembers.userId} = ${userId}`;
}

/**
 * その人の使えないまとまりの配列（なければ空の配列）。
 * @param userId - users.id の列
 * @returns text[] の式
 */
export function disabledFeaturesSql(userId: AnyPgColumn | SQL): SQL<string[]> {
  return sql<string[]>`coalesce((SELECT array_agg(f.feature) FROM (${disabledRows(userId)}) f), '{}')`;
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
 * その人がまとまりを使えるか（定期処理の WHERE に足す）。
 * @param userId - users.id の列
 * @param feature - まとまり
 * @returns 真偽の式
 */
export function featureOnSql(userId: AnyPgColumn | SQL, feature: Feature): SQL<boolean> {
  return sql<boolean>`NOT EXISTS (SELECT 1 FROM (${disabledRows(userId)}) f WHERE f.feature = ${feature})`;
}

/**
 * 使えないまとまりの配列から、使えるまとまりの集合を作る。
 * @param disabled - 使えないまとまり（DBから読んだ配列）
 * @returns 使えるまとまり（FEATURES の順）
 */
export function featuresFrom(disabled: readonly string[] | null | undefined): ReadonlySet<Feature> {
  const off = new Set(disabled ?? []);
  return new Set(FEATURES.filter((f) => !off.has(f)));
}

