// 運営の上限の画面が使う、上限の一覧（specs/meguru/029-threads-pattern1 tasks.md T070）。
// 名前・表示名・範囲・短い名前はアプリが登録し、GET /api/operator/app-registry で受け取る（共通の画面はアプリの名前を書かない）。
// 扱うのは、登録の一覧で operatorLimits が付いたアプリ（API が決めて返す）。
import type { OperatorAppRegistry } from "@meguru/shared";
import { useOperatorRegistry } from "./feature-defs";

/** 上限1つ。 */
export type LimitDef = OperatorAppRegistry["apps"][number]["limits"][number];

/**
 * 登録の一覧から、運営の上限の画面が扱うアプリの上限を取り出す。
 * @param registry - 登録の一覧
 * @returns 上限（登録の順）
 */
export function limitDefsOf(registry: OperatorAppRegistry): LimitDef[] {
  return registry.apps.find((a) => a.operatorLimits)?.limits ?? [];
}

/**
 * 上限の一覧を読む（運営者だけが呼べる）。
 * @returns TanStack Query の結果と、取り出した上限（読めるまでは undefined）
 */
export function useLimitDefs() {
  const registry = useOperatorRegistry();
  return { query: registry, defs: registry.data ? limitDefsOf(registry.data) : undefined };
}
