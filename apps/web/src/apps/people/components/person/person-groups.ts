// 人の一覧のまとめた表示（なし・年月ごと・タグごと・あいうえおの行ごと。specs/people/002-sales-list FR-103）。
// まとめるのは、今のページの人（APIが並べた順のまま）。タグごとでは、複数のタグを持つ人は各まとまりに出る。
import type { PersonGroup, PersonListItem } from "@meguru/shared/people";

/** まとまり。 */
export type PersonGroupBlock<T> = { key: string; label: string | null; persons: T[] };

/** あいうえおの行（ひらがなの範囲の頭の文字の符号と、行の名前）。 */
const KANA_ROWS: readonly [number, string][] = [
  [0x3041, "あ行"],
  [0x304b, "か行"],
  [0x3055, "さ行"],
  [0x305f, "た行"],
  [0x306a, "な行"],
  [0x306f, "は行"],
  [0x307e, "ま行"],
  [0x3083, "や行"],
  [0x3089, "ら行"],
  [0x308e, "わ行"],
];
/** 英字のまとまりの名前。 */
const LATIN_ROW = "A〜Z";
/** 読めない文字（漢字など）のまとまりの名前。 */
const OTHER_ROW = "そのほか（漢字など）";

/**
 * 名前の頭の文字の、あいうえおの行。カタカナはひらがなに読み替える。漢字は読みがわからないので「そのほか」。
 * @param name - 表示名
 * @returns 行の名前
 */
export function kanaRowOf(name: string): string {
  const first = name.normalize("NFKC").trim().codePointAt(0);
  if (first === undefined) return OTHER_ROW;
  // カタカナ（ァ〜ヶ）はひらがなへ
  const code = first >= 0x30a1 && first <= 0x30f6 ? first - 0x60 : first;
  if (code >= 0x3041 && code <= 0x3096) {
    let row = KANA_ROWS[0]![1];
    for (const [start, label] of KANA_ROWS) if (code >= start) row = label;
    return row;
  }
  if (/^[a-z]$/i.test(String.fromCodePoint(code))) return LATIN_ROW;
  return OTHER_ROW;
}

/**
 * 年月の名前（最後に会った日）。
 * @param ymd - 最後に会った日（なければ null）
 * @returns 名前
 */
function monthLabel(ymd: string | null): string {
  if (!ymd) return "会ったイベントなし";
  const [y, m] = ymd.split("-");
  return `${Number(y)}年${Number(m)}月`;
}

/**
 * 人をまとめる。まとまりの順：年月は新しい順（会っていない人は最後）、タグは名前の順（タグなしは最後）、行はあいうえおの順（英字・そのほかは最後）。
 * @param persons - 人（APIが並べた順）
 * @param group - まとめ方
 * @returns まとまり
 */
export function groupPersons<T extends Pick<PersonListItem, "displayName" | "lastMetOn" | "tags">>(persons: T[], group: PersonGroup): PersonGroupBlock<T>[] {
  if (group === "none") return [{ key: "all", label: null, persons }];
  const blocks = new Map<string, PersonGroupBlock<T>>();
  /**
   * まとまりに足す。
   * @param key - まとまりの鍵（並べ方にも使う）
   * @param label - 名前
   * @param p - 人
   */
  const push = (key: string, label: string, p: T) => {
    const b = blocks.get(key) ?? { key, label, persons: [] };
    b.persons.push(p);
    blocks.set(key, b);
  };
  for (const p of persons) {
    if (group === "month") push(p.lastMetOn ? p.lastMetOn.slice(0, 7) : "", monthLabel(p.lastMetOn), p);
    else if (group === "tag") {
      if (p.tags.length === 0) push("￿", "タグなし", p);
      for (const t of p.tags) push(`t:${t.name}:${t.id}`, `#${t.name}`, p);
    } else {
      const row = kanaRowOf(p.displayName);
      const index = KANA_ROWS.findIndex(([, label]) => label === row);
      push(index >= 0 ? String(index).padStart(2, "0") : row === LATIN_ROW ? "90" : "99", row, p);
    }
  }
  const list = [...blocks.values()];
  if (group === "month") return list.sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.key < b.key ? 1 : -1));
  if (group === "tag") return list.sort((a, b) => (a.key === "￿" ? 1 : b.key === "￿" ? -1 : a.key.localeCompare(b.key, "ja")));
  return list.sort((a, b) => (a.key < b.key ? -1 : 1));
}
