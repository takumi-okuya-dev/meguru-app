// 人物メモのエラーコードと文言（specs/people/001-people-memo contracts/api.md 0）。apps/app-errors.ts がまとめて errors.ts に足す（specs/meguru/031）。
import type { ErrorMessage } from "../../errors";

/** 人物メモのエラーコード。 */
export const PEOPLE_ERROR_CODES = [
  "IMPORT_TOO_LARGE",
  "IMPORT_MAPPING_INVALID",
  "IMPORT_DECISIONS_REQUIRED",
  "PEOPLE_CONFIRM_REQUIRED",
  "OUTREACH_NEEDS_APPROVAL",
  "OUTREACH_NO_CONSENT",
] as const;

/** 人物メモのエラーの文言。 */
export const PEOPLE_ERROR_MESSAGES: Record<(typeof PEOPLE_ERROR_CODES)[number], ErrorMessage> = {
  IMPORT_TOO_LARGE: {
    message: "CSVが大きすぎます。500行・60列まで、1つの答えは5,000文字までにしてください。",
    action: "none",
  },
  IMPORT_MAPPING_INVALID: {
    message: "列の対応を見直してください（LINE名の列が要ります。同じ項目は1列だけ選べます）。",
    action: "none",
  },
  IMPORT_DECISIONS_REQUIRED: {
    message:
      "まだ決めていない行があります。同じ人の候補と同意の選択肢を選んでから、もう一度取り込んでください。",
    action: "none",
  },
  PEOPLE_CONFIRM_REQUIRED: {
    message: "メモや声かけを書き足した人がいます。残すか消すかを選んでください。",
    action: "none",
  },
  OUTREACH_NEEDS_APPROVAL: {
    message: "先に「OKをもらった」にしてください。本人のOKのあとでつなげます。",
    action: "none",
  },
  OUTREACH_NO_CONSENT: {
    message: "この人は、この目的の個別の案内に同意していません。",
    action: "none",
  },
};
