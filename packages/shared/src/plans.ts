// プランの順位と登録数上限（FR-014〜FR-016、research.md R9）。
// 並び順がそのまま順位（後ろほど上位）。

/** Accountの契約プランの一覧（PRD Glossary の Account.plan）。並び順がそのまま順位で、後ろほど上位。 */
export const PLANS = ["auto-only", "auto-grower", "multi-account", "team"] as const;

/** Accountの契約プラン。 */
export type Plan = (typeof PLANS)[number];

const LIMITS: Record<Plan, number> = {
  "auto-only": 1,
  "auto-grower": 1,
  "multi-account": 5,
  // プラン4の上限はプラン4のfeatureで定める。それまではプラン3と同じ（FR-015）
  team: 5,
};

/**
 * 文字列が契約プランの値かを確かめる。
 * @param value - 確かめる文字列
 * @returns プランの値なら true
 */
export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

/**
 * プランごとの登録数上限を返す（FR-015）。
 * @param plan - 契約プラン
 * @returns そのプランで1ユーザーが登録できるAccount数
 */
export function limitFor(plan: Plan): number {
  return LIMITS[plan];
}

/**
 * プランの一覧から最上位のプランを選ぶ（FR-016）。
 * @param plans - プランの一覧
 * @returns 最上位のプラン。一覧が空なら null
 */
export function highestPlan(plans: readonly Plan[]): Plan | null {
  let best: Plan | null = null;
  for (const plan of plans) {
    if (best === null || PLANS.indexOf(plan) > PLANS.indexOf(best)) best = plan;
  }
  return best;
}

/**
 * ownerとして保有するAccountのプランから、ユーザーの登録数上限を求める（FR-016）。
 * 保有が0件なら auto-only の上限（1件）とする。
 * @param ownedPlans - ownerとして保有するAccountのプラン
 * @returns ユーザーの登録数上限
 */
export function limitForOwnedPlans(ownedPlans: readonly Plan[]): number {
  return limitFor(highestPlan(ownedPlans) ?? "auto-only");
}

/**
 * 新しく作るAccountのプランを決める（FR-014）。
 * 最初の1件は auto-only、2件目以降は保有Accountの最上位プランを引き継ぐ。
 * @param ownedPlans - ownerとして保有するAccountのプラン
 * @returns 新しいAccountのプラン
 */
export function initialPlanFor(ownedPlans: readonly Plan[]): Plan {
  return highestPlan(ownedPlans) ?? "auto-only";
}
