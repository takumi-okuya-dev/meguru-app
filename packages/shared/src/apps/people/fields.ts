// 取り込みの列の項目（specs/people/001-people-memo research.md R6、data-model.md 2-3）。

/**
 * 列の項目。line_name（LINE名・必須）・real_name（本名）・submitted_at（回答の時刻）・next_attendance（次回参加）・
 * bring_friends（友達を誘えるか）・wanted_connections（欲しいつながり・複数）・career_interests（キャリアの興味・複数）・
 * contact_consent（個別の案内の同意・複数）・other（どれにもあたらない。答えは回答の一部として残す）。
 */
export const IMPORT_FIELDS = [
  "line_name",
  "real_name",
  "submitted_at",
  "next_attendance",
  "bring_friends",
  "wanted_connections",
  "career_interests",
  "contact_consent",
  "other",
] as const;
/** 列の項目。 */
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** 画面に出す項目の名前。 */
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  line_name: "LINE名",
  real_name: "本名",
  submitted_at: "回答の時刻",
  next_attendance: "次回参加",
  bring_friends: "友達を誘えるか",
  wanted_connections: "欲しいつながり",
  career_interests: "キャリアの興味",
  contact_consent: "個別の案内の同意",
  other: "そのほか（答えは残す）",
};

/** 名前と答えの文字の上限（data-model.md 2-5・2-6）。 */
export const PERSON_NAME_MAX = 100;
/** 人の一覧の1ページの人数（R22）。 */
export const PERSONS_PAGE_SIZE = 100;
/** 探す言葉の上限。 */
export const SEARCH_QUERY_MAX = 100;
/** 見た目の特徴の上限。 */
export const MEMO_APPEARANCE_MAX = 300;
/** 話したことの上限。 */
export const MEMO_TALK_MAX = 1000;
/** 次回参加・友達を誘えるかの答えの上限。 */
export const SINGLE_ANSWER_MAX = 500;
/** 複数選択の答えの数の上限。 */
export const CHOICES_MAX = 30;
/** 複数選択の答え1つの上限。 */
export const CHOICE_MAX = 500;
/** 同じ人の候補の上限（1行あたり）。 */
export const CANDIDATES_MAX = 5;
