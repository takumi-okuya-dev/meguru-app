// 同じ人の候補（specs/people/001-people-memo research.md R9）。
// 作り手の人の名前の鍵を1回読み、Workerの中で nameKey・looseKey で比べる。候補は1行に5人まで（来たイベントの新しい順）。
import { CANDIDATES_MAX, looseKey, nameKey, type AnswerSummary, type ImportCandidate } from "@meguru/shared/people";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PeopleDb } from "../access";
import { displayNameOf } from "../access";
import { peopleEvents, peopleManualAttendances, peoplePersons, peopleResponses } from "../schema";

/** 比べる行（LINE名と本名）。 */
export type CandidateQuery = { lineName: string; realName: string | null };
/** 候補の理由。 */
type Reason = ImportCandidate["reasons"][number];

/** 作り手の人の名前の索引。 */
export type PersonIndex = {
  /** LINE名（今・手で足したとき・回答）の nameKey → 人 */
  byLine: Map<string, Set<string>>;
  /** LINE名の looseKey → 人 */
  byLoose: Map<string, Set<string>>;
  /** 本名の nameKey → 人 */
  byReal: Map<string, Set<string>>;
  /** 人の名前 */
  persons: Map<string, { realName: string | null; lineName: string | null; lineNames: Set<string> }>;
};

/**
 * 作り手の人の名前の索引を作る（人と回答のLINE名を、user_id の索引で1回ずつ読む）。
 * @param db - データベース
 * @param userId - 作り手
 * @returns 索引
 */
export async function loadPersonIndex(db: PeopleDb, userId: string): Promise<PersonIndex> {
  const [persons, lines] = await Promise.all([
    db
      .select({ id: peoplePersons.id, realName: peoplePersons.realName, lineName: peoplePersons.lineName, enteredLineName: peoplePersons.enteredLineName })
      .from(peoplePersons)
      .where(eq(peoplePersons.userId, userId)),
    db
      .selectDistinct({ personId: peopleResponses.personId, lineName: peopleResponses.lineName })
      .from(peopleResponses)
      .where(eq(peopleResponses.userId, userId)),
  ]);
  const index: PersonIndex = { byLine: new Map(), byLoose: new Map(), byReal: new Map(), persons: new Map() };
  const add = (map: Map<string, Set<string>>, key: string | null, id: string) => {
    if (!key) return;
    const set = map.get(key);
    if (set) set.add(id);
    else map.set(key, new Set([id]));
  };
  const addLine = (id: string, name: string | null) => {
    if (!name) return;
    add(index.byLine, nameKey(name), id);
    add(index.byLoose, looseKey(name), id);
    index.persons.get(id)?.lineNames.add(name);
  };
  for (const p of persons) {
    index.persons.set(p.id, { realName: p.realName, lineName: p.lineName, lineNames: new Set() });
    addLine(p.id, p.lineName);
    addLine(p.id, p.enteredLineName);
    if (p.realName) add(index.byReal, nameKey(p.realName), p.id);
  }
  for (const l of lines) addLine(l.personId, l.lineName);
  return index;
}

/**
 * 1行の候補の人と理由を出す（並べ替えと5人までの切り取りは attachCandidates で行う）。
 * @param index - 作り手の人の名前の索引
 * @param q - 行のLINE名と本名
 * @returns 人 → 理由
 */
export function matchPersons(index: PersonIndex, q: CandidateQuery): Map<string, Reason[]> {
  const found = new Map<string, Reason[]>();
  const mark = (ids: Set<string> | undefined, reason: Reason) => {
    for (const id of ids ?? []) {
      const list = found.get(id);
      if (!list) found.set(id, [reason]);
      else if (!list.includes(reason)) list.push(reason);
    }
  };
  const lineKey = nameKey(q.lineName);
  mark(index.byLine.get(lineKey), "line_name");
  const loose = looseKey(q.lineName);
  if (loose) {
    // nameKey で同じ人は、理由を「LINE名が同じ」だけにする
    const exact = index.byLine.get(lineKey);
    mark(new Set([...(index.byLoose.get(loose) ?? [])].filter((id) => !exact?.has(id))), "line_name_loose");
  }
  if (q.realName) mark(index.byReal.get(nameKey(q.realName)), "real_name");
  return found;
}

/**
 * 候補の人の、見分けるための中身（来たイベント3つ・いちばん新しい回答の答え）を読み、行ごとの候補を作る。
 * @param db - データベース
 * @param userId - 作り手
 * @param index - 作り手の人の名前の索引
 * @param matches - 行ごとの「人 → 理由」
 * @returns 行ごとの候補（来たイベントの新しい順に5人まで）
 */
export async function buildCandidates(db: PeopleDb, userId: string, index: PersonIndex, matches: readonly Map<string, Reason[]>[]): Promise<ImportCandidate[][]> {
  const ids = [...new Set(matches.flatMap((m) => [...m.keys()]))];
  if (ids.length === 0) return matches.map(() => []);
  const attended = sql`(
    SELECT ${peopleResponses.personId} AS person_id, ${peopleResponses.eventId} AS event_id FROM ${peopleResponses}
      WHERE ${peopleResponses.userId} = ${userId} AND ${inArray(peopleResponses.personId, ids)}
    UNION
    SELECT ${peopleManualAttendances.personId}, ${peopleManualAttendances.eventId} FROM ${peopleManualAttendances}
      WHERE ${peopleManualAttendances.userId} = ${userId} AND ${inArray(peopleManualAttendances.personId, ids)}
  )`;
  const [eventsRes, latest] = await Promise.all([
    db.execute<{ person_id: string; name: string; held_on: string }>(sql`SELECT a.person_id, e.name, e.held_on::text AS held_on
      FROM ${attended} a JOIN ${peopleEvents} e ON e.id = a.event_id
      ORDER BY a.person_id, e.held_on DESC, e.created_at DESC`),
    db
      .selectDistinctOn([peopleResponses.personId], {
        personId: peopleResponses.personId,
        nextAttendance: peopleResponses.nextAttendance,
        wantedConnections: peopleResponses.wantedConnections,
        careerInterests: peopleResponses.careerInterests,
      })
      .from(peopleResponses)
      .innerJoin(peopleEvents, eq(peopleEvents.id, peopleResponses.eventId))
      .where(and(eq(peopleResponses.userId, userId), inArray(peopleResponses.personId, ids)))
      .orderBy(peopleResponses.personId, sql`${peopleEvents.heldOn} DESC`, sql`${peopleResponses.submittedAt} DESC NULLS LAST`, sql`${peopleResponses.createdAt} DESC`),
  ]);
  const eventsOf = new Map<string, { name: string; heldOn: string }[]>();
  for (const r of eventsRes.rows) {
    const list = eventsOf.get(r.person_id) ?? [];
    list.push({ name: r.name, heldOn: r.held_on });
    eventsOf.set(r.person_id, list);
  }
  const answersOf = new Map<string, AnswerSummary>(
    latest.map((r) => [r.personId, { nextAttendance: r.nextAttendance, wantedConnections: r.wantedConnections, careerInterests: r.careerInterests }]),
  );
  return matches.map((m) =>
    [...m.entries()]
      .map(([personId, reasons]): ImportCandidate => {
        const p = index.persons.get(personId);
        const realName = p?.realName ?? null;
        const lineName = p?.lineName ?? null;
        return {
          personId,
          displayName: displayNameOf({ realName, lineName }),
          lineName,
          otherLineNames: [...(p?.lineNames ?? [])].filter((n) => n !== lineName),
          realName,
          reasons,
          recentEvents: (eventsOf.get(personId) ?? []).slice(0, 3),
          latestAnswers: answersOf.get(personId) ?? null,
        };
      })
      .sort((a, b) => (b.recentEvents[0]?.heldOn ?? "").localeCompare(a.recentEvents[0]?.heldOn ?? "") || a.displayName.localeCompare(b.displayName, "ja"))
      .slice(0, CANDIDATES_MAX),
  );
}
