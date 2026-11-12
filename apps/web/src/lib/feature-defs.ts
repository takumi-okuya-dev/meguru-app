// 運営の画面が使う、機能のまとまりの一覧（specs/meguru/029-threads-pattern1 tasks.md T070）。
// まとまりの名前・表示名・説明はアプリが登録し、GET /api/operator/app-registry で受け取る（共通の画面はアプリの名前を書かない）。
// 機能のON/OFFは、まとまりを登録したただ1つのアプリのもの（API の requireFeatureSettingsApp と同じ決まり）。
import { useQuery } from "@tanstack/react-query";
import type { OperatorAppRegistry } from "@meguru/shared";
import { api } from "./api-client";
import { queryKeys } from "./query";

/** 機能のまとまり1つ。 */
export type FeatureDef = OperatorAppRegistry["apps"][number]["features"][number];

/**
 * 登録の一覧から、機能のまとまりを取り出す（まとまりを登録したアプリのもの）。
 * @param registry - 登録の一覧
 * @returns まとまり（登録の順）
 */
export function featureDefsOf(registry: OperatorAppRegistry): FeatureDef[] {
  return registry.apps.find((a) => a.features.length > 0)?.features ?? [];
}

/**
 * 機能のまとまりの一覧を読む（運営者だけが呼べる）。
 * @returns まとまり（読み込み中は undefined）
 */
export function useFeatureDefs(): FeatureDef[] | undefined {
  const registry = useQuery({ queryKey: queryKeys.appRegistry, queryFn: api.appRegistry, staleTime: Infinity });
  return registry.data ? featureDefsOf(registry.data) : undefined;
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
