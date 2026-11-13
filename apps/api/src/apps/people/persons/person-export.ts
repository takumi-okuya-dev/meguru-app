// 人の一覧の書き出し（specs/people/002-sales-list plan.md 3、FR-111）。絞り込みに合う人を CSV（UTF-8・BOM）にする。
// ファイルは残さない（返すだけ）。Excel で式として読まれる頭の文字（= + - @ と、タブ・改行）は ' を付けて逃がす。
import { jstDate, type PersonListQuery } from "@meguru/shared/people";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { peoplePersonFieldValues, peoplePersonLinks, peoplePersons, peopleResponses } from "../schema";
import { listFields } from "../fields/field-service";
import { queryPersons } from "./person-list";

/** 書き出せる人数の上限。 */
const EXPORT_LIMIT = 10_000;
/** 来てくれそう度の名前。 */
const LIKELIHOOD_LABEL: Record<number, string> = { 3: "高", 2: "中", 1: "低" };

/**
 * CSV の1つの値（式の頭の文字を逃がし、" で囲む）。
 * @param v - 値
 * @returns CSV の値
 */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * 人の一覧を CSV にする。
 * @param db - データベース
 * @param userId - 作り手
 * @param query - 人の一覧と同じ絞り込み
 * @param now - 今の時刻（ファイル名の日付）
 * @returns ファイル名と CSV のバイト（BOM つき）
 */
export async function exportPersons(db: Db, userId: string, query: PersonListQuery, now = new Date()): Promise<{ filename: string; body: Uint8Array<ArrayBuffer> }> {
  const [{ persons }, fields] = await Promise.all([queryPersons(db, userId, query, [], { limit: EXPORT_LIMIT, offset: 0 }), listFields(db, userId)]);
  const ids = persons.map((p) => p.id);
  const [memos, lines, values, links] = ids.length
    ? await Promise.all([
        db
          .select({ id: peoplePersons.id, appearance: peoplePersons.memoAppearance, talk: peoplePersons.memoTalk })
          .from(peoplePersons)
          .where(and(eq(peoplePersons.userId, userId), inArray(peoplePersons.id, ids))),
        db
          .selectDistinct({ personId: peopleResponses.personId, lineName: peopleResponses.lineName })
          .from(peopleResponses)
          .where(and(eq(peopleResponses.userId, userId), inArray(peopleResponses.personId, ids))),
        db
          .select({ personId: peoplePersonFieldValues.personId, fieldId: peoplePersonFieldValues.fieldId, value: peoplePersonFieldValues.value })
          .from(peoplePersonFieldValues)
          .where(and(eq(peoplePersonFieldValues.userId, userId), inArray(peoplePersonFieldValues.personId, ids))),
        db
          .select({ personId: peoplePersonLinks.personId, kind: peoplePersonLinks.kind, url: peoplePersonLinks.url })
          .from(peoplePersonLinks)
          .where(and(eq(peoplePersonLinks.userId, userId), inArray(peoplePersonLinks.personId, ids))),
      ])
    : [[], [], [], []];
  const memoOf = new Map(memos.map((m) => [m.id, m]));
  const linesOf = new Map<string, string[]>();
  for (const l of lines) linesOf.set(l.personId, [...(linesOf.get(l.personId) ?? []), l.lineName]);
  const valueOf = new Map(values.map((v) => [`${v.personId}|${v.fieldId}`, v.value]));
  const linkOf = new Map(links.map((l) => [`${l.personId}|${l.kind}`, l.url]));

  const header = [
    "名前",
    "LINE名",
    "別名",
    "タグ",
    "最後に会った日",
    "初めて会った日",
    "自分の会に来た回数",
    "交流会への誘いの同意",
    "仕事の相談先へのつなぎの同意",
    "来てくれそう度",
    "次にやること（日付）",
    "次にやること",
    "誕生日",
    "次回参加",
    "欲しいつながり",
    "キャリアの興味",
    "見た目の特徴",
    "話したこと",
    "Instagram",
    "X",
    "Facebook",
    ...fields.map((f) => f.label),
  ];
  const rows = persons.map((p) => {
    const memo = memoOf.get(p.id);
    const others = (linesOf.get(p.id) ?? []).filter((n) => n !== p.lineName);
    return [
      p.displayName,
      p.lineName,
      others.join(" / "),
      p.tags.map((t) => t.name).join(" / "),
      p.lastMetOn,
      p.firstMetOn,
      p.ownEventCount,
      p.consent.invite ? "あり" : "なし",
      p.consent.work ? "あり" : "なし",
      p.likelihood ? LIKELIHOOD_LABEL[p.likelihood] : "",
      p.nextAction?.on,
      p.nextAction?.note,
      p.birthdayMd,
      p.latestAnswers?.nextAttendance,
      p.latestAnswers?.wantedConnections.join(" / "),
      p.latestAnswers?.careerInterests.join(" / "),
      memo?.appearance,
      memo?.talk,
      linkOf.get(`${p.id}|instagram`),
      linkOf.get(`${p.id}|x`),
      linkOf.get(`${p.id}|facebook`),
      ...fields.map((f) => valueOf.get(`${p.id}|${f.id}`)),
    ];
  });
  const text = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const bytes = new TextEncoder().encode(text);
  const body = new Uint8Array(new ArrayBuffer(bytes.length + 3));
  body.set([0xef, 0xbb, 0xbf]);
  body.set(bytes, 3);
  return { filename: `people-${jstDate(now).replaceAll("-", "")}.csv`, body };
}
