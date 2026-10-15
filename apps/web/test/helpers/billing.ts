// /api/me の決済の部分のテスト用の値（specs/013）。既定は決済OFF（001〜012の画面のテストは今のまま）。
import type { MeBilling } from "@threads-grower/shared";

/** 決済OFFの環境の /api/me の billing と、退会の途中でないこと。 */
export const ME_BILLING_OFF: { billing: MeBilling; withdrawalInProgress: boolean } = {
  billing: {
    mode: "disabled",
    state: "billing_disabled",
    readOnlyReason: null,
    trialEndsAt: "2026-11-15T03:00:00.000Z",
    trialDaysLeft: null,
  },
  withdrawalInProgress: false,
};

/**
 * 決済ONの /api/me の billing を作る。
 * @param state - 使える状態
 * @param over - 上書きする値
 * @returns billing
 */
export function meBilling(state: MeBilling["state"], over: Partial<MeBilling> = {}): MeBilling {
  return {
    mode: "enabled",
    state,
    readOnlyReason: state === "read_only" ? "trial_ended" : null,
    trialEndsAt: "2026-11-15T03:00:00.000Z",
    trialDaysLeft: state === "trial" || state === "subscribed_trial" ? 20 : null,
    ...over,
  };
}
