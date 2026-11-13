// 人の画面で使う言葉（同意の目的の名前など）。

/** 同意の目的の名前。 */
export const CONSENT_LABELS = {
  invite: "交流会への誘い",
  work: "仕事の相談先へのつなぎ",
} as const;

/** 同意の目的。 */
export type ConsentKey = keyof typeof CONSENT_LABELS;

/** 同意の目的の並び。 */
export const CONSENT_KEYS: readonly ConsentKey[] = ["invite", "work"];

/** 声かけの進み具合の名前（目的ごと。research.md R16）。 */
export const OUTREACH_STAGE_LABELS = {
  invite: { asked: "興味を聞いた", link_sent: "参加リンクを送った", attended: "来た" },
  work: { asked: "本人に聞いた", approved: "OKをもらった", connected: "つないだ" },
} as const;
