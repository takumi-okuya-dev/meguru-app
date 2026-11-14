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

// ---- 002（声かけリスト）----

/** 来てくれそう度の名前（3＝高・2＝中・1＝低）。 */
export const LIKELIHOOD_LABELS: Record<number, string> = { 3: "高", 2: "中", 1: "低" };

/** 来てくれそう度の選び方（絞り込みの値：3・2・1・none）。 */
export const LIKELIHOOD_CHOICES: readonly { value: string; label: string }[] = [
  { value: "3", label: "高" },
  { value: "2", label: "中" },
  { value: "1", label: "低" },
  { value: "none", label: "なし" },
];

/** 連絡の記録の「何で」の名前（done は次にやることを終えた記録）。 */
export const CONTACT_CHANNEL_LABELS = { line: "LINE", venue: "会場で", other: "そのほか", done: "やったこと" } as const;

/** SNS のリンクの名前。 */
export const LINK_KIND_LABELS = { instagram: "Instagram", x: "X", facebook: "Facebook" } as const;

/** 並べ方の名前。 */
export const PERSON_SORT_LABELS = {
  last_met: "最後に会った順",
  first_met: "初めて会った順",
  updated: "更新順",
  kana: "あいうえお順",
  likelihood: "来てくれそう度順",
} as const;

/** まとめた表示の名前。 */
export const PERSON_GROUP_LABELS = { none: "まとめない", month: "年月ごと", tag: "タグごと", kana: "あいうえおの行ごと" } as const;
