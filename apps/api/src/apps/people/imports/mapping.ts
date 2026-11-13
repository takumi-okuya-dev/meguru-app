// 列の対応と同意の選択肢の対応（specs/people/001-people-memo research.md R6・R7）。
// 列は「送ったもの → 覚えたもの → 初めから用意した質問文 → null」の順で決める。鍵は質問文（questionKey）。
import {
  CONSENT_CHOICE_PRESETS,
  QUESTION_PRESETS,
  questionKey,
  splitChoices,
  type ConsentPurpose,
  type ImportColumn,
  type ImportField,
  type ImportMappingError,
} from "@meguru/shared/people";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "../../../kernel/db/client";
import type { PeopleDb } from "../access";
import { peopleChoiceMappings, peopleColumnMappings } from "../schema";

/** 鍵の長さの上限（表の check と同じ）。 */
const KEY_MAX = 500;

/**
 * 列の対応を決める。
 * @param db - データベース
 * @param userId - 作り手
 * @param headers - 見出し（質問文）
 * @param sent - 画面が選んだ項目（列の順。null は選んでいない）
 * @returns 列ごとの項目と、どこから決めたか
 */
export async function resolveColumns(db: PeopleDb, userId: string, headers: readonly string[], sent?: readonly (ImportField | null)[]): Promise<ImportColumn[]> {
  const keys = [...new Set(headers.map(questionKey).filter((k) => k !== "" && k.length <= KEY_MAX))];
  const remembered = new Map<string, ImportField>();
  if (keys.length > 0) {
    const rows = await db
      .select({ key: peopleColumnMappings.questionKey, field: peopleColumnMappings.field })
      .from(peopleColumnMappings)
      .where(and(eq(peopleColumnMappings.userId, userId), inArray(peopleColumnMappings.questionKey, keys)));
    for (const r of rows) remembered.set(r.key, r.field as ImportField);
  }
  return headers.map((header, i) => {
    const key = questionKey(header);
    const chosen = sent?.[i];
    if (chosen) return { header, field: chosen, source: "sent" };
    const mine = remembered.get(key);
    if (mine) return { header, field: mine, source: "remembered" };
    const preset = QUESTION_PRESETS.get(key);
    if (preset) return { header, field: preset, source: "preset" };
    return { header, field: null, source: "none" };
  });
}

/**
 * 列の対応の誤り：LINE名の列がない・同じ項目に2列（other は何列でもよい）。
 * @param columns - 列の対応
 * @returns 誤り（なければ空）
 */
export function mappingErrorsOf(columns: readonly ImportColumn[]): ImportMappingError[] {
  const errors: ImportMappingError[] = [];
  const fields = columns.map((c) => c.field).filter((f): f is ImportField => f !== null);
  if (!fields.includes("line_name")) errors.push({ code: "line_name_missing" });
  const seen = new Set<ImportField>();
  const dup = new Set<ImportField>();
  for (const f of fields) {
    if (f === "other") continue;
    if (seen.has(f)) dup.add(f);
    seen.add(f);
  }
  for (const f of dup) errors.push({ code: "duplicate_field", field: f });
  return errors;
}

/**
 * 同意の選択肢の対応を決める（初めから用意したもの → 覚えたもの → 送ったものの順に上書き）。
 * @param db - データベース
 * @param userId - 作り手
 * @param sent - 画面が選んだ対応（選択肢の文 → 目的）
 * @returns 選択肢の鍵（questionKey）→ 目的
 */
export async function resolveChoicePurposes(db: PeopleDb, userId: string, sent?: Readonly<Record<string, ConsentPurpose>>): Promise<Map<string, ConsentPurpose>> {
  const purposes = new Map(CONSENT_CHOICE_PRESETS);
  const rows = await db
    .select({ key: peopleChoiceMappings.choiceKey, purpose: peopleChoiceMappings.purpose })
    .from(peopleChoiceMappings)
    .where(eq(peopleChoiceMappings.userId, userId));
  for (const r of rows) purposes.set(r.key, r.purpose as ConsentPurpose);
  for (const [text, purpose] of Object.entries(sent ?? {})) purposes.set(questionKey(text), purpose);
  return purposes;
}

/**
 * 同意の列に出てくる選択肢（重なりを除く。出てきた順。文は最初に出てきた形）。
 * @param columns - 列の対応
 * @param rows - 行
 * @returns 選択肢の文
 */
export function consentChoicesIn(columns: readonly ImportColumn[], rows: readonly (readonly string[])[]): string[] {
  const idx = columns.findIndex((c) => c.field === "contact_consent");
  if (idx < 0) return [];
  const seen = new Map<string, string>();
  for (const r of rows) {
    for (const choice of splitChoices(r[idx])) {
      const key = questionKey(choice);
      if (key !== "" && !seen.has(key)) seen.set(key, choice);
    }
  }
  return [...seen.values()];
}

/**
 * 取り込み（書く方）が成功したときに、列の対応と同意の選択肢の対応を覚える（作り手ごとに上書き）。
 * @param tx - トランザクション
 * @param userId - 作り手
 * @param columns - 列の対応（すべて項目があるもの）
 * @param choices - この取り込みに出てきた選択肢の文
 * @param purposes - 選択肢の鍵 → 目的
 */
export async function rememberMappings(
  tx: TxDb,
  userId: string,
  columns: readonly ImportColumn[],
  choices: readonly string[],
  purposes: ReadonlyMap<string, ConsentPurpose>,
): Promise<void> {
  const now = new Date();
  // 同じ質問文の列が2つあれば、あとの方を覚える（1つの文で同じ鍵を2回書かない）
  const cols = new Map<string, { questionKey: string; questionText: string; field: string }>();
  for (const c of columns) {
    const key = questionKey(c.header);
    if (!c.field || key === "" || key.length > KEY_MAX || c.header.trim().length > KEY_MAX) continue;
    cols.set(key, { questionKey: key, questionText: c.header.trim(), field: c.field });
  }
  if (cols.size > 0) {
    await tx
      .insert(peopleColumnMappings)
      .values([...cols.values()].map((c) => ({ ...c, userId, updatedAt: now })))
      .onConflictDoUpdate({
        target: [peopleColumnMappings.userId, peopleColumnMappings.questionKey],
        set: { questionText: sql`excluded.question_text`, field: sql`excluded.field`, updatedAt: now },
      });
  }
  const chs = new Map<string, { choiceKey: string; choiceText: string; purpose: ConsentPurpose }>();
  for (const text of choices) {
    const key = questionKey(text);
    const purpose = purposes.get(key);
    if (!purpose || key === "" || key.length > KEY_MAX || text.trim().length > KEY_MAX) continue;
    chs.set(key, { choiceKey: key, choiceText: text.trim(), purpose });
  }
  if (chs.size > 0) {
    await tx
      .insert(peopleChoiceMappings)
      .values([...chs.values()].map((c) => ({ ...c, userId, updatedAt: now })))
      .onConflictDoUpdate({
        target: [peopleChoiceMappings.userId, peopleChoiceMappings.choiceKey],
        set: { choiceText: sql`excluded.choice_text`, purpose: sql`excluded.purpose`, updatedAt: now },
      });
  }
}
