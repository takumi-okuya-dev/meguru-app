// 集金管理のエラーコードと文言（specs/collect/001-event-day-collection contracts/api.md 0）。apps/app-errors.ts がまとめて errors.ts に足す（specs/meguru/031）。
import type { ErrorMessage } from "../../errors";

/** 集金管理のエラーコード。 */
export const COLLECT_ERROR_CODES = [
  "TIER_IN_USE",
  "IMAGE_TOO_LARGE",
  "ALREADY_RECORDED",
  "HELPER_NAME_TAKEN",
  "LINK_INACTIVE",
  "DEVICE_REQUIRED",
  "RECORD_NOT_YOURS",
] as const;

/** 集金管理のエラーの文言。 */
export const COLLECT_ERROR_MESSAGES: Record<(typeof COLLECT_ERROR_CODES)[number], ErrorMessage> = {
  TIER_IN_USE: {
    message: "この料金の区分は、名簿の人か受付の記録が使っているので消せません。",
    action: "none",
  },
  IMAGE_TOO_LARGE: { message: "画像が大きすぎます。300KB以内にしてください。", action: "none" },
  ALREADY_RECORDED: { message: "この人はもう受付済みです。", action: "reload" },
  HELPER_NAME_TAKEN: { message: "同じ名前の人がもう受付をしています。", action: "none" },
  LINK_INACTIVE: { message: "この受付用リンクは止められたか、期限が過ぎました。", action: "none" },
  DEVICE_REQUIRED: { message: "名前を入れ直してから、もう一度お試しください。", action: "none" },
  RECORD_NOT_YOURS: { message: "ほかの人が受け取った記録は取り消せません。", action: "none" },
};
