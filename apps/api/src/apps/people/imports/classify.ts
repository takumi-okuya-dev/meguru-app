// 取り込みの行の読み方と判定（specs/people/001-people-memo research.md R5・R8・R9、contracts/api.md 3-1）。
// プレビューと書く方の両方が、同じ判定を使う（書く方は直前にやり直す）。
import {
  CHOICE_MAX,
  CHOICES_MAX,
  consentFromChoices,
  nameKey,
  parseSubmittedAt,
  PERSON_NAME_MAX,
  SINGLE_ANSWER_MAX,
  splitChoices,
  type Consent,
  type ConsentPurpose,
  type ImportCandidate,
  type ImportColumn,
  type ImportField,
  type ImportInvalidReason,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRowStatus,
} from "@meguru/shared/people";
import { and, eq, inArray } from "drizzle-orm";
import { sha256Hex } from "../../../kernel/identifier-hash";
import type { PeopleDb } from "../access";
import { peopleErasedResponses, peopleResponses, type ResponseAnswer } from "../schema";
import { buildCandidates, loadPersonIndex, matchPersons } from "./candidates";

/** 読んだ行。 */
export type ParsedRow = {
  row: number;
  lineName: string;
  lineNameKey: string;
  realName: string | null;
  submittedAt: Date | null;
  nextAttendance: string | null;
  bringFriends: string | null;
  wantedConnections: string[];
  careerInterests: string[];
  consentChoices: string[];
  consent: Consent;
  answers: ResponseAnswer[];
  dedupeHash: string;
  status: ImportRowStatus;
  invalidReason?: ImportInvalidReason;
  groupId?: number;
  candidates: ImportCandidate[];
};

/** 判定の結果。 */
export type Classified = { rows: ParsedRow[]; summary: ImportPreview["summary"] };

/**
 * 1つの値（空なら null。上限を超える分は切る。全部の答えは answers に残る）。
 * @param v - 値
 * @param max - 上限
 * @returns 値
 */
function single(v: string | undefined, max: number): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : cut(s, max);
}

/**
 * 文字の数（コードポイント）で切る（絵文字を半分に切らない）。
 * @param s - 文字
 * @param max - 上限
 * @returns 切った文字
 */
function cut(s: string, max: number): string {
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join("") : s;
}

/**
 * 複数選択の値（数と長さの上限で切る）。
 * @param v - 値
 * @returns 選んだもの
 */
function multi(v: string | undefined): string[] {
  return splitChoices(v)
    .slice(0, CHOICES_MAX)
    .map((c) => cut(c, CHOICE_MAX));
}

/**
 * 行を読み、判定する。
 * @param db - データベース（書く方ではトランザクション）
 * @param userId - 作り手
 * @param eventId - イベント
 * @param columns - 列の対応（誤りのないもの）
 * @param rows - 行
 * @param purposes - 同意の選択肢の対応
 * @returns 行ごとの判定と数
 */
export async function classifyRows(
  db: PeopleDb,
  userId: string,
  eventId: string,
  columns: readonly ImportColumn[],
  rows: readonly (readonly string[])[],
  purposes: ReadonlyMap<string, ConsentPurpose>,
): Promise<Classified> {
  const col = (f: ImportField) => columns.findIndex((c) => c.field === f);
  const idx = {
    line: col("line_name"),
    real: col("real_name"),
    at: col("submitted_at"),
    next: col("next_attendance"),
    friends: col("bring_friends"),
    wanted: col("wanted_connections"),
    career: col("career_interests"),
    consent: col("contact_consent"),
  };
  const at = (r: readonly string[], i: number) => (i < 0 ? undefined : r[i]);

  const parsed: ParsedRow[] = await Promise.all(
    rows.map(async (r, row): Promise<ParsedRow> => {
      const lineName = (at(r, idx.line) ?? "").trim();
      const realName = single(at(r, idx.real), Number.MAX_SAFE_INTEGER);
      // 同意は、切る前の全部の選択肢で決める（31個目の「希望しない」を落として案内してよいにしない。PR #111 の Codex レビュー）
      const allConsentChoices = splitChoices(at(r, idx.consent));
      const consentChoices = multi(at(r, idx.consent));
      const lineNameKey = nameKey(lineName);
      // 二重の印：イベント・回答の時刻の文字・LINE名（時刻の列がない・時刻が空なら全部の列の値）。名前を含まないハッシュにする（R8・R18）。
      // 時刻が空の行を時刻とLINE名だけで見ると、同じLINE名の別の人が1つの回答にまとまってしまう（PR #111 のセルフレビュー）
      const atText = (at(r, idx.at) ?? "").trim();
      const seed = atText !== "" ? `${eventId}|${atText}|${lineNameKey}` : `${eventId}|${r.join("\u001f")}`;
      let invalidReason: ImportInvalidReason | undefined;
      if (lineName === "") invalidReason = "line_name_empty";
      else if ([...lineName].length > PERSON_NAME_MAX) invalidReason = "line_name_too_long";
      else if (realName && [...realName].length > PERSON_NAME_MAX) invalidReason = "real_name_too_long";
      return {
        row,
        lineName,
        lineNameKey,
        realName,
        submittedAt: parseSubmittedAt(at(r, idx.at)),
        nextAttendance: single(at(r, idx.next), SINGLE_ANSWER_MAX),
        bringFriends: single(at(r, idx.friends), SINGLE_ANSWER_MAX),
        wantedConnections: multi(at(r, idx.wanted)),
        careerInterests: multi(at(r, idx.career)),
        consentChoices,
        consent: idx.consent < 0 ? { invite: false, work: false } : consentFromChoices(allConsentChoices, purposes),
        answers: columns.map((c, i) => ({ q: c.header, a: r[i] ?? "" })),
        dedupeHash: await sha256Hex(seed),
        status: invalidReason ? "invalid" : "new",
        ...(invalidReason ? { invalidReason } : {}),
        candidates: [],
      };
    }),
  );

  // もう取り込んだ・消した人の回答（同じイベントのハッシュ）
  const hashes = [...new Set(parsed.filter((p) => p.status !== "invalid").map((p) => p.dedupeHash))];
  if (hashes.length > 0) {
    const [imported, erased] = await Promise.all([
      db
        .select({ hash: peopleResponses.dedupeHash })
        .from(peopleResponses)
        .where(and(eq(peopleResponses.eventId, eventId), eq(peopleResponses.userId, userId), inArray(peopleResponses.dedupeHash, hashes))),
      db
        .select({ hash: peopleErasedResponses.dedupeHash })
        .from(peopleErasedResponses)
        .where(and(eq(peopleErasedResponses.eventId, eventId), eq(peopleErasedResponses.userId, userId), inArray(peopleErasedResponses.dedupeHash, hashes))),
    ]);
    const importedSet = new Set(imported.map((r) => r.hash));
    const erasedSet = new Set(erased.map((r) => r.hash));
    for (const p of parsed) {
      if (p.status !== "new") continue;
      if (erasedSet.has(p.dedupeHash)) p.status = "erased";
      else if (importedSet.has(p.dedupeHash)) p.status = "already_imported";
    }
  }

  // 1つのCSVの中で同じLINE名（nameKey）の行は組にする
  const live = parsed.filter((p) => p.status === "new");
  const byKey = new Map<string, ParsedRow[]>();
  for (const p of live) byKey.set(p.lineNameKey, [...(byKey.get(p.lineNameKey) ?? []), p]);
  let groupId = 0;
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const p of group) {
      p.status = "duplicate_in_file";
      p.groupId = groupId;
    }
    groupId++;
  }

  // 同じ人の候補（DBの人と比べる）
  if (live.length > 0) {
    const index = await loadPersonIndex(db, userId);
    const matches = live.map((p) => matchPersons(index, { lineName: p.lineName, realName: p.realName }));
    const built = await buildCandidates(db, userId, index, matches);
    live.forEach((p, i) => {
      p.candidates = built[i] ?? [];
      if (p.status === "new" && p.candidates.length > 0) p.status = "candidate";
    });
  }

  const count = (s: ImportRowStatus) => parsed.filter((p) => p.status === s).length;
  return {
    rows: parsed,
    summary: {
      newCount: count("new"),
      candidateCount: count("candidate"),
      duplicateInFileCount: count("duplicate_in_file"),
      skippedCount: count("already_imported") + count("erased") + count("invalid"),
    },
  };
}

/**
 * 判定した行を、プレビューの返りの形にする（取り込めない行は、番号と理由だけ）。
 * @param p - 判定した行
 * @returns プレビューの行
 */
export function toPreviewRow(p: ParsedRow): ImportPreviewRow {
  if (p.status === "invalid") return { row: p.row, status: p.status, ...(p.invalidReason ? { invalidReason: p.invalidReason } : {}) };
  return {
    row: p.row,
    status: p.status,
    ...(p.groupId === undefined ? {} : { groupId: p.groupId }),
    lineName: p.lineName,
    realName: p.realName,
    answers: { nextAttendance: p.nextAttendance, wantedConnections: p.wantedConnections, careerInterests: p.careerInterests },
    consent: p.consent,
    ...(p.candidates.length > 0 ? { candidates: p.candidates } : {}),
  };
}
