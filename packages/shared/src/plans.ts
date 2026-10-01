// プランの順位と登録数上限（FR-014〜FR-016、research.md R9）。
// 並び順がそのまま順位（後ろほど上位）。

export const PLANS = ["auto-only", "auto-grower", "multi-account", "team"] as const;

export type Plan = (typeof PLANS)[number];

const LIMITS: Record<Plan, number> = {
  "auto-only": 1,
  "auto-grower": 1,
  "multi-account": 5,
  // プラン4の上限はプラン4のfeatureで定める。それまではプラン3と同じ（FR-015）
  team: 5,
};

export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

export function limitFor(plan: Plan): number {
  return LIMITS[plan];
}

export function highestPlan(plans: readonly Plan[]): Plan | null {
  let best: Plan | null = null;
  for (const plan of plans) {
    if (best === null || PLANS.indexOf(plan) > PLANS.indexOf(best)) best = plan;
  }
  return best;
}

/** ownerとして保有するAccountのプランから、ユーザーの登録数上限を求める */
export function limitForOwnedPlans(ownedPlans: readonly Plan[]): number {
  return limitFor(highestPlan(ownedPlans) ?? "auto-only");
}

/** 新しく作るAccountのプラン。最初の1件は auto-only、2件目以降は最上位プランを引き継ぐ */
export function initialPlanFor(ownedPlans: readonly Plan[]): Plan {
  return highestPlan(ownedPlans) ?? "auto-only";
}
