// ホーム：今日やること・過ぎたもの・近い誕生日（specs/people/002-sales-list plan.md 3、FR-104・FR-105）。
import { BIRTHDAY_WINDOW_DAYS, jstDate, type HomeItem, type PeopleHome, type PersonListQuery } from "@meguru/shared/people";
import { sql } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { queryPersons } from "../persons/person-list";

/** 絞り込みのない一覧のクエリ。 */
const NO_FILTER: PersonListQuery = { next: [], wanted: [], career: [], tag: [], likelihood: [], offset: 0 };
/** ホームに出す人数の上限（それぞれ）。 */
const HOME_LIMIT = 200;

/**
 * 今日から誕生日（MM-DD）まで、あと何日か（年をまたぐ。2月29日は、うるう年でない年は3月1日として数える）。
 * @param today - 今日（YYYY-MM-DD）
 * @param md - 誕生日の月日
 * @returns 日数
 */
export function daysUntilBirthday(today: string, md: string): number {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const [bm, bd] = md.split("-").map(Number) as [number, number];
  const base = Date.UTC(y, m - 1, d);
  let next = Date.UTC(y, bm - 1, bd);
  if (next < base) next = Date.UTC(y + 1, bm - 1, bd);
  return Math.round((next - base) / 86_400_000);
}

/**
 * ホームの3つの並び。
 * @param db - データベース
 * @param userId - 作り手
 * @param now - 今の時刻
 * @returns 今日やること・過ぎたもの（日付の順）・近い誕生日（近い順）
 */
export async function getHome(db: Db, userId: string, now = new Date()): Promise<PeopleHome> {
  const today = jstDate(now);
  const [todayRows, overdueRows, birthdayRows] = await Promise.all([
    queryPersons(db, userId, NO_FILTER, [sql`p.next_action_on = ${today}::date`], { limit: HOME_LIMIT, offset: 0, orderBy: sql`name_key, id` }),
    queryPersons(db, userId, NO_FILTER, [sql`p.next_action_on < ${today}::date`], { limit: HOME_LIMIT, offset: 0, orderBy: sql`next_action_on, name_key, id` }),
    queryPersons(db, userId, NO_FILTER, [sql`p.birthday_md IS NOT NULL`], { limit: 5000, offset: 0, orderBy: sql`name_key, id` }),
  ]);
  const birthdays: HomeItem[] = birthdayRows.persons
    .map((p) => ({ p, days: daysUntilBirthday(today, p.birthdayMd!) }))
    .filter((x) => x.days < BIRTHDAY_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days)
    .map((x) => x.p);
  return { today: todayRows.persons, overdue: overdueRows.persons, birthdays };
}
