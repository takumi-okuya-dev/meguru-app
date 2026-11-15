// 人の一覧と選べる値（specs/people/001-people-memo contracts/api.md 4、research.md R22、tasks.md T052）。
// 同意に関わらず、作り手の人をすべて出す（FR-017）。答えの絞り込みは、いちばん新しい回答の答えで比べる。
import {
  nameKey,
  PERSONS_PAGE_SIZE,
  type FacetValue,
  type PeopleFacets,
  type PersonList,
  type PersonListItem,
  type PersonListQuery,
  type PersonSort,
} from "@meguru/shared/people";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { displayNameOf } from "../access";
import { peopleContactLogs, peoplePersonFieldValues, peoplePersons, peoplePersonTags, peopleResponses, peopleTags } from "../schema";
import { attendanceSql, latestResponseSql, likePattern, personStatsSql } from "./person-query";

/** 一覧の1行（DBから読んだ形）。 */
type Row = {
  id: string;
  real_name: string | null;
  line_name: string | null;
  consent_invite: boolean;
  consent_work: boolean;
  last_met_on: string | null;
  own_count: number | null;
  has_response: boolean;
  next_attendance: string | null;
  wanted_connections: string[] | null;
  career_interests: string[] | null;
  tags: { id: string; name: string }[] | null;
  likelihood: number | null;
  next_action_on: string | null;
  next_action_note: string | null;
  first_met_on: string | null;
  birthday_md: string | null;
};

/** 絞り込みのない一覧のクエリ（ホーム・会ごとの声かけの一覧が使う）。 */
export const NO_FILTER: PersonListQuery = { next: [], wanted: [], career: [], tag: [], likelihood: [], offset: 0 };

/** 人の一覧の1行（ホームの誕生日にも使う）。 */
export type PersonRow = PersonListItem & { birthdayMd: string | null };

/** 並べ方ごとの ORDER BY（同じなら名前・番号の順）。 */
const SORT_SQL: Record<PersonSort, SQL> = {
  last_met: sql`last_met_on DESC NULLS LAST, name_key, id`,
  first_met: sql`first_met_on ASC NULLS LAST, name_key, id`,
  updated: sql`updated_at DESC, name_key, id`,
  kana: sql`name_key, id`,
  likelihood: sql`likelihood DESC NULLS LAST, last_met_on DESC NULLS LAST, name_key, id`,
};

/**
 * 値の一覧を SQL の並びにする。
 * @param values - 値
 * @returns `$1, $2, …`
 */
function list(values: readonly string[]): SQL {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
}

/**
 * 人の一覧（最後に会った日の新しい順・同じなら名前の順・100人ずつ。R22）。
 * @param db - データベース
 * @param userId - 作り手
 * @param query - 探す言葉と絞り込み
 * @returns 人と全体の数
 */
export async function listPersons(db: Db, userId: string, query: PersonListQuery): Promise<PersonList> {
  const { total, persons } = await queryPersons(db, userId, query, []);
  return { total, persons: persons.map(({ birthdayMd: _, ...p }) => p) };
}

/**
 * 人の一覧の問い合わせ（誘う候補も使う。R22）。足した条件は、人（p）・数（st：last_met_on・own_count）・いちばん新しい回答（lr）の列で書く。
 * @param db - データベース
 * @param userId - 作り手
 * @param query - 探す言葉と絞り込み
 * @param extra - 足す条件（誘う候補の同意・前に来た）
 * @param options - limit・offset（省くと100人ずつ・クエリの offset）、orderBy（並べ方を上書きする。f の列で書く）
 * @returns 人と全体の数
 */
export async function queryPersons(
  db: Db,
  userId: string,
  query: PersonListQuery,
  extra: SQL[],
  options: { limit?: number; offset?: number; orderBy?: SQL } = {},
): Promise<{ total: number; persons: PersonRow[] }> {
  const conds: SQL[] = [sql`p.user_id = ${userId}`, ...extra];
  const q = query.q?.normalize("NFKC").trim() ?? "";
  if (q !== "") {
    // メモは、保存した側も NFKC にそろえて比べる（全角の「ＡＢＣ」と半角の「ABC」を同じに見る）
    const memo = likePattern(q);
    // 002：連絡の記録と自由な項目の値も探す（FR-106・FR-109）
    const memoCond = sql`normalize(coalesce(p.memo_appearance, ''), NFKC) ILIKE ${memo} OR normalize(coalesce(p.memo_talk, ''), NFKC) ILIKE ${memo}
      OR EXISTS (SELECT 1 FROM ${peopleContactLogs} c WHERE c.person_id = p.id AND normalize(c.note, NFKC) ILIKE ${memo})
      OR EXISTS (SELECT 1 FROM ${peoplePersonFieldValues} v WHERE v.person_id = p.id AND normalize(v.value, NFKC) ILIKE ${memo})`;
    // 見えない文字だけの言葉は nameKey で空になる。そのときは名前で比べない（'%%' ですべての人に当たらないように）
    const key = nameKey(q);
    if (key === "") conds.push(sql`(${memoCond})`);
    else {
      const pattern = likePattern(key);
      conds.push(sql`(p.real_name_key LIKE ${pattern} OR p.line_name_key LIKE ${pattern} OR p.entered_line_name_key LIKE ${pattern}
        OR EXISTS (SELECT 1 FROM ${peopleResponses} r WHERE r.person_id = p.id AND r.line_name_key LIKE ${pattern})
        OR ${memoCond})`);
    }
  }
  if (query.eventId) conds.push(sql`EXISTS (SELECT 1 FROM att WHERE att.person_id = p.id AND att.event_id = ${query.eventId})`);
  if (query.next.length > 0) conds.push(sql`lr.next_attendance IN (${list(query.next)})`);
  if (query.wanted.length > 0) conds.push(sql`lr.wanted_connections && ARRAY[${list(query.wanted)}]::text[]`);
  if (query.career.length > 0) conds.push(sql`lr.career_interests && ARRAY[${list(query.career)}]::text[]`);
  if (query.lastMetFrom) conds.push(sql`st.last_met_on >= ${query.lastMetFrom}::date`);
  if (query.lastMetTo) conds.push(sql`st.last_met_on <= ${query.lastMetTo}::date`);
  // 002：タグ（どれかを持つ）・来てくれそう度（none は付けていない人。FR-102）
  if (query.tag.length > 0) {
    if (!query.tag.every(isUuid)) throw new AppError("VALIDATION_FAILED", 400, "invalid query", undefined, ["tag"]);
    conds.push(sql`EXISTS (SELECT 1 FROM ${peoplePersonTags} pt WHERE pt.person_id = p.id AND pt.tag_id IN (${list(query.tag)}))`);
  }
  if (query.likelihood.length > 0) {
    if (!query.likelihood.every((v) => ["1", "2", "3", "none"].includes(v))) throw new AppError("VALIDATION_FAILED", 400, "invalid query", undefined, ["likelihood"]);
    const levels = query.likelihood.filter((v) => v !== "none").map(Number);
    const parts: SQL[] = [];
    if (levels.length > 0) parts.push(sql`p.likelihood IN (${sql.join(levels.map((n) => sql`${n}`), sql`, `)})`);
    if (query.likelihood.includes("none")) parts.push(sql`p.likelihood IS NULL`);
    conds.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  const limit = options.limit ?? PERSONS_PAGE_SIZE;
  const offset = options.offset ?? query.offset;

  const res = await db.execute<{ total: number; rows: Row[] }>(sql`
    WITH att AS (${attendanceSql(userId)}),
      st AS (${personStatsSql(userId, sql`att`)}),
      lr AS (${latestResponseSql(userId)}),
      f AS (
        SELECT p.id, p.real_name, p.line_name, p.consent_invite, p.consent_work, st.last_met_on, st.first_met_on, st.own_count,
          (lr.person_id IS NOT NULL) AS has_response, lr.next_attendance, lr.wanted_connections, lr.career_interests,
          p.likelihood, p.next_action_on, p.next_action_note, p.birthday_md, p.updated_at,
          coalesce(p.real_name_key, p.line_name_key, '') AS name_key
        FROM ${peoplePersons} p
        LEFT JOIN st ON st.person_id = p.id
        LEFT JOIN lr ON lr.person_id = p.id
        WHERE ${sql.join(conds, sql` AND `)}
      )
    SELECT (SELECT count(*) FROM f)::int AS total,
      (SELECT coalesce(json_agg(y), '[]'::json) FROM (
        -- タグは、そのページの人の分だけ組み立てる（全員の分を作らない）
        SELECT x.*, (SELECT coalesce(json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name_key), '[]'::json)
            FROM ${peoplePersonTags} pt JOIN ${peopleTags} t ON t.id = pt.tag_id WHERE pt.person_id = x.id) AS tags
        FROM (SELECT * FROM f ORDER BY ${options.orderBy ?? SORT_SQL[query.sort ?? "last_met"]} LIMIT ${limit} OFFSET ${offset}) x
      ) y) AS rows`);
  const [out] = res.rows;
  return {
    total: Number(out?.total ?? 0),
    persons: (out?.rows ?? []).map((r) => ({
      id: r.id,
      displayName: displayNameOf({ realName: r.real_name, lineName: r.line_name }),
      realName: r.real_name,
      lineName: r.line_name,
      lastMetOn: r.last_met_on,
      ownEventCount: r.own_count ?? 0,
      latestAnswers: r.has_response
        ? { nextAttendance: r.next_attendance, wantedConnections: r.wanted_connections ?? [], careerInterests: r.career_interests ?? [] }
        : null,
      consent: { invite: r.consent_invite, work: r.consent_work },
      tags: r.tags ?? [],
      likelihood: r.likelihood,
      nextAction: r.next_action_on && r.next_action_note ? { on: r.next_action_on, note: r.next_action_note } : null,
      firstMetOn: r.first_met_on,
      birthdayMd: r.birthday_md,
    })),
  };
}

/**
 * 選べる値（作り手の人のいちばん新しい回答に出てくる値。項目ごとに多い順、同じなら値の順。R22）。
 * @param db - データベース
 * @param userId - 作り手
 * @returns 項目ごとの値と人数
 */
export async function listFacets(db: Db, userId: string): Promise<PeopleFacets> {
  const res = await db.execute<{ field: keyof PeopleFacets; value: string; n: number }>(sql`
    WITH lr AS (${latestResponseSql(userId)})
    SELECT 'nextAttendance' AS field, next_attendance AS value, count(*)::int AS n FROM lr WHERE next_attendance IS NOT NULL GROUP BY next_attendance
    UNION ALL SELECT 'wantedConnections', v, count(*)::int FROM lr, unnest(lr.wanted_connections) AS v GROUP BY v
    UNION ALL SELECT 'careerInterests', v, count(*)::int FROM lr, unnest(lr.career_interests) AS v GROUP BY v`);
  const out: PeopleFacets = { nextAttendance: [], wantedConnections: [], careerInterests: [] };
  for (const r of res.rows) out[r.field].push({ value: r.value, count: Number(r.n) });
  const order = (a: FacetValue, b: FacetValue) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);
  for (const k of Object.keys(out) as (keyof PeopleFacets)[]) out[k].sort(order);
  return out;
}
