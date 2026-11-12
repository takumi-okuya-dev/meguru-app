// 運営の上限の画面が使う、上限の一覧（specs/meguru/029-threads-pattern1 tasks.md T070）。
// 名前・表示名・範囲・短い名前はアプリが登録し、GET /api/operator/app-registry で受け取る（共通の画面はアプリの名前を書かない）。
// 扱うのは、登録の一覧で operatorLimits が付いたアプリ（API が決めて返す）。
import { useQuery } from "@tanstack/react-query";
import type { OperatorAppRegistry } from "@meguru/shared";
import { api } from "./api-client";
import { queryKeys } from "./query";

/** 上限1つ。 */
export type LimitDef = OperatorAppRegistry["apps"][number]["limits"][number];

/**
 * 上限の一覧を読む（運営者だけが呼べる）。
 * @returns TanStack Query の結果と、運営の上限の画面が扱うアプリの上限（読めるまでは undefined）
 */
export function useLimitDefs() {
  const registry = useQuery({ queryKey: queryKeys.appRegistry, queryFn: api.appRegistry, staleTime: Infinity });
  return { query: registry, defs: registry.data ? (registry.data.apps.find((a) => a.operatorLimits)?.limits ?? []) : undefined };
}
