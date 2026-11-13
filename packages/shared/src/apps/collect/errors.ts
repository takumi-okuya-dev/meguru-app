// 集金管理のエラーコードと文言（specs/collect/001-event-day-collection contracts/api.md 0）。apps/app-errors.ts がまとめて errors.ts に足す（specs/meguru/031）。
import type { ErrorMessage } from "../../errors";

/** 集金管理のエラーコード。 */
export const COLLECT_ERROR_CODES = ["TIER_IN_USE", "IMAGE_TOO_LARGE"] as const;

/** 集金管理のエラーの文言。 */
export const COLLECT_ERROR_MESSAGES: Record<(typeof COLLECT_ERROR_CODES)[number], ErrorMessage> = {
  TIER_IN_USE: {
    message: "この料金の区分は、名簿の人か受付の記録が使っているので消せません。",
    action: "none",
  },
  IMAGE_TOO_LARGE: { message: "画像が大きすぎます。300KB以内にしてください。", action: "none" },
};
