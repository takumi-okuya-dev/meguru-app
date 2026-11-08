// /api/me の決済の部分のテスト用の値（specs/013）。既定は決済OFF（001〜012の画面のテストは今のまま）。
import { FEATURES, type MeBilling, type MeResponse } from "@threads-grower/shared";

/** テスト用のグループがOFFの環境の /api/me の testGroups（specs/016）。 */
export const ME_TEST_GROUPS_OFF: MeResponse["testGroups"] = { enabled: false, admitted: true, operator: false };

/** 決済OFFの環境の /api/me の billing と、退会の途中でないこと。テスト用のグループもOFF（specs/016）。運営者ではない（specs/019）。 */
export const ME_BILLING_OFF: {
  billing: MeBilling;
  withdrawalInProgress: boolean;
  testGroups: MeResponse["testGroups"];
  operator: boolean;
  features: MeResponse["features"];
  dailyPostLimit: MeResponse["dailyPostLimit"];
  testerInvites: MeResponse["testerInvites"];
} = {
  billing: {
    mode: "disabled",
    state: "billing_disabled",
    readOnlyReason: null,
    trialEndsAt: "2026-11-15T03:00:00.000Z",
    trialDaysLeft: null,
  },
  withdrawalInProgress: false,
  testGroups: ME_TEST_GROUPS_OFF,
  operator: false,
  features: [...FEATURES],
  // 上限の既定値と、招待の管理OFF（specs/024。001〜023の画面のテストは今のまま）
  dailyPostLimit: 10,
  testerInvites: { enabled: false },
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
