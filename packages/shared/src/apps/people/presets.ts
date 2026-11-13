// 初めから用意した質問文と同意の選択肢（specs/people/001-people-memo research.md R6・R7）。
// IT交流会のGoogleフォーム（2026-10-11の回。brief-people-memo/addendum.md）の質問文を写したもの。質問文が完全に同じ（questionKey が同じ）
// ときだけ当てる。作り手が覚えた対応があれば、そちらを先に使う。
import type { ConsentPurpose } from "./answers";
import type { ImportField } from "./fields";
import { questionKey } from "./names";

/** 質問文 → 項目（文は書いたまま。鍵は QUESTION_PRESETS で questionKey にする）。 */
const QUESTION_TEXTS: readonly (readonly [string, ImportField])[] = [
  ["タイムスタンプ", "submitted_at"],
  ["Timestamp", "submitted_at"],
  ["あなたのLINE名を教えて下さい", "line_name"],
  ["あなたのLINE名を教えてください", "line_name"],
  ["お名前（フルネーム・任意）", "real_name"],
  ["次回のIT交流会は参加できそうか", "next_attendance"],
  ["次回のIT交流会は参加できそうですか？", "next_attendance"],
  ["次回、友達も誘って参加できそうか", "bring_friends"],
  ["次回、友達も誘って参加できそうですか？", "bring_friends"],
  ["今後どんなつながりがあると嬉しいか", "wanted_connections"],
  ["今後どんなつながりがあると嬉しいですか？", "wanted_connections"],
  ["今後のキャリアや働き方で興味があること", "career_interests"],
  ["今後のキャリアや働き方で興味があることはありますか？", "career_interests"],
  ["今後、情報や機会があれば個別に案内してよいか", "contact_consent"],
  ["今後、情報や機会があれば個別にご案内してもよろしいですか？", "contact_consent"],
];

/** 初めから用意した質問文（鍵は questionKey）→ 項目。 */
export const QUESTION_PRESETS: ReadonlyMap<string, ImportField> = new Map(QUESTION_TEXTS.map(([text, field]) => [questionKey(text), field]));

/** 初めから用意した同意の選択肢（鍵は questionKey）→ 目的。 */
export const CONSENT_CHOICE_PRESETS: ReadonlyMap<string, ConsentPurpose> = new Map(
  (
    [
      ["交流会・勉強会の案内", "invite"],
      ["転職・求人情報", "work"],
      ["副業・業務委託案件", "work"],
      ["個別の案内は希望しない", "decline"],
    ] as const
  ).map(([text, purpose]) => [questionKey(text), purpose]),
);
