// 運営の画面が使う、機能のまとまりの一覧（specs/meguru/029-threads-pattern1 tasks.md T070）。
// まとまりの名前・表示名・説明はアプリが登録し、GET /api/operator/app-registry で受け取る（共通の画面はアプリの名前を書かない）。
// 機能のON/OFFは、登録の一覧で featureSwitches が付いたアプリのもの（API が決めて返す。Web では決め直さない）。
import { useQuery } from "@tanstack/react-query";
import type { OperatorAppRegistry } from "@meguru/shared";
import { api } from "./api-client";
import { queryKeys } from "./query";

/** 機能のまとまり1つ。 */
export type FeatureDef = OperatorAppRegistry["apps"][number]["features"][number];

/**
 * 登録の一覧から、機能のON/OFFを持つアプリのまとまりを取り出す。
 * @param registry - 登録の一覧
 * @returns まとまり（登録の順）
 */
export function featureDefsOf(registry: OperatorAppRegistry): FeatureDef[] {
  return registry.apps.find((a) => a.featureSwitches)?.features ?? [];
}

/**
 * 機能のまとまりの一覧を読む（運営者だけが呼べる）。
 * @returns TanStack Query の結果と、取り出したまとまり（読めるまでは undefined）
 */
export function useFeatureDefs() {
  const registry = useQuery({ queryKey: queryKeys.appRegistry, queryFn: api.appRegistry, staleTime: Infinity });
  return { query: registry, defs: registry.data ? featureDefsOf(registry.data) : undefined };
}

/**
 * まとまりの名前から表示名を引く関数を作る（知らない名前はそのまま出す）。
 * @param defs - まとまり
 * @returns 名前 → 表示名
 */
export function featureLabeler(defs: readonly FeatureDef[] | undefined): (key: string) => string {
  const labels = new Map((defs ?? []).map((d) => [d.key, d.label]));
  return (key) => labels.get(key) ?? key;
}
