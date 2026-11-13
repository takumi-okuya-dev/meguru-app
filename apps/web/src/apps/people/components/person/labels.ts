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
